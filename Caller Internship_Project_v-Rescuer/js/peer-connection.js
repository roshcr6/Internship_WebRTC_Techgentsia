/**
 * V-Rescuer PeerConnection Manager v3
 * ─────────────────────────────────────
 * Manages RTCPeerConnection lifecycle + screen share track replacement.
 *
 * New in v3:
 *   - replaceVideoTrack(newTrack) — swap camera ↔ screen share mid-call
 *   - getConnectionStats() — quick snapshot for quality badge
 *   - Improved _remoteStreamFired guard to handle late audio tracks
 */

class VRescuerPeerConnection {
  constructor(signaling) {
    this._signaling  = signaling;
    this._pc         = null;
    this._localStream = null;
    this._statsMonitor = null;
    this._remoteStreamFired = false;
    this._sendersByKind = { audio: null, video: null };
    this._polite = false;
    this._makingOffer = false;
    this._ignoreOffer = false;
    this._isSettingRemoteAnswerPending = false;
    this._canNegotiate = false;

    // Callbacks
    this.onRemoteStream          = null;
    this.onDataChannel           = null;
    this.onConnectionStateChange = null;
    this.onIceStateChange        = null;
  }

  // ── RTCPeerConnection Factory ──────────────────────────────────────────────

  _createPC() {
    const cfg = VRescuerConfig;
    const pc = new RTCPeerConnection({
      iceServers: cfg.ICE_SERVERS,
      iceCandidatePoolSize: cfg.ICE_CANDIDATE_POOL_SIZE ?? 0,
      bundlePolicy: cfg.BUNDLE_POLICY ?? 'max-bundle',
      rtcpMuxPolicy: cfg.RTCP_MUX_POLICY ?? 'require',
    });
    this._remoteStreamFired = false;

    pc.onnegotiationneeded = async () => {
      if (!this._canNegotiate) return;
      try {
        this._makingOffer = true;
        await pc.setLocalDescription();
        this._signaling.send('description', pc.localDescription);
      } catch (e) {
        console.warn('[PeerConnection] Negotiation failed:', e);
      } finally {
        this._makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this._signaling.send('ice-candidate', candidate.toJSON());
    };

    // Remote tracks — guard fires onRemoteStream once, but re-fire if we get both tracks
    const pendingStreams = new Map();
    pc.ontrack = (event) => {
      console.log('[PeerConnection] Remote track:', event.track.kind);
      if (!event.streams[0]) return;
      const streamId = event.streams[0].id;
      if (!pendingStreams.has(streamId)) {
        pendingStreams.set(streamId, event.streams[0]);
        // Small debounce — give the second track a tick to arrive
        setTimeout(() => {
          if (this.onRemoteStream && !this._remoteStreamFired) {
            this._remoteStreamFired = true;
            this.onRemoteStream(event.streams[0]);
          }
        }, 100);
      }
    };

    pc.ondatachannel = (event) => {
      console.log('[PeerConnection] DataChannel received.');
      if (this.onDataChannel) this.onDataChannel(event.channel);
    };

    pc.onconnectionstatechange = () => {
      console.log('[PeerConnection] Connection state:', pc.connectionState);
      if (this.onConnectionStateChange) this.onConnectionStateChange(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[PeerConnection] ICE state:', pc.iceConnectionState);
      if (this.onIceStateChange) this.onIceStateChange(pc.iceConnectionState);
    };

    return pc;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(localStream) {
    this._localStream = localStream;
    this._pc = this._createPC();

    localStream.getTracks().forEach((track) => {
      const sender = this._pc.addTrack(track, localStream);
      if (track.kind === 'audio' || track.kind === 'video') {
        this._sendersByKind[track.kind] = sender;
      }
      const transceiver = this._pc.getTransceivers().find(t => t.sender === sender);
      if (transceiver) this._setCodecPreferences(track.kind, transceiver);
      console.log(`[PeerConnection] Added: ${track.kind}`);
    });

    this._applySenderPreferences();

    this._signaling.addEventListener('ice-candidate', (e) => this._addIceCandidate(e.detail));
    this._signaling.addEventListener('description',  (e) => this._handleDescription(e.detail));
    this._signaling.addEventListener('offer',         (e) => this._handleDescription(e.detail));
    this._signaling.addEventListener('answer',        (e) => this._handleDescription(e.detail));

    return this._pc;
  }

  // ── Offer / Answer ─────────────────────────────────────────────────────────

  async createOffer() {
    await this._pc.setLocalDescription();
    this._signaling.send('description', this._pc.localDescription);
  }

  async _handleDescription(desc) {
    if (!desc) return;
    const pc = this._pc;
    const readyForOffer =
      !this._makingOffer &&
      (pc.signalingState === 'stable' || this._isSettingRemoteAnswerPending);
    const offerCollision = desc.type === 'offer' && !readyForOffer;

    this._ignoreOffer = !this._polite && offerCollision;
    if (this._ignoreOffer) return;

    try {
      this._isSettingRemoteAnswerPending = desc.type === 'answer';
      if (offerCollision && this._polite) {
        await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription(desc);
      this._isSettingRemoteAnswerPending = false;

      if (desc.type === 'offer') {
        await pc.setLocalDescription();
        this._signaling.send('description', pc.localDescription);
      }
    } catch (e) {
      console.warn('[PeerConnection] Description handling failed:', e);
    }
  }

  async _addIceCandidate(data) {
    try { await this._pc.addIceCandidate(new RTCIceCandidate(data)); }
    catch (e) { if (!this._ignoreOffer) console.warn('[PeerConnection] ICE candidate failed:', e); }
  }

  // ── Media Track Controls ──────────────────────────────────────────────────

  setVideoEnabled(enabled) {
    this._localStream?.getVideoTracks().forEach((t) => { t.enabled = enabled; });
  }

  setAudioEnabled(enabled) {
    this._localStream?.getAudioTracks().forEach((t) => { t.enabled = enabled; });
  }

  // Adaptive video scaling via RTCRtpSender parameters.
  async setVideoQuality(profileName) {
    if (!this._pc) return false;
    const sender = this._pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender || !sender.setParameters) return false;

    const profile = VRescuerConfig.VIDEO_QUALITY_PROFILES?.[profileName];
    if (!profile) return false;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const enc = params.encodings[0];

      if (profile.maxBitrate != null) enc.maxBitrate = profile.maxBitrate;
      else delete enc.maxBitrate;

      if (profile.scaleResolutionDownBy != null) enc.scaleResolutionDownBy = profile.scaleResolutionDownBy;
      else delete enc.scaleResolutionDownBy;

      if (profile.maxFramerate != null) enc.maxFramerate = profile.maxFramerate;
      else delete enc.maxFramerate;

      if (profile.degradationPreference) {
        params.degradationPreference = profile.degradationPreference;
      }

      if (profile.priority) enc.priority = profile.priority;
      if (profile.networkPriority) enc.networkPriority = profile.networkPriority;

      await sender.setParameters(params);

      if (profile.targetHeight) {
        const applied = sender.getParameters();
        const appliedScale = applied.encodings?.[0]?.scaleResolutionDownBy ?? 1;
        if (appliedScale === 1) {
          try { await sender.track.applyConstraints({ height: profile.targetHeight }); }
          catch (e) { console.warn('[PeerConnection] applyConstraints failed:', e); }
        }
      }
      return true;
    } catch (e) {
      console.warn('[PeerConnection] setVideoQuality failed:', e);
      return false;
    }
  }

  applyVideoSenderParams({ maxBitrate, maxFramerate }) {
    if (!this._pc) return false;
    const sender = this._sendersByKind.video || this._pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender || !sender.setParameters) return false;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const enc = params.encodings[0];
      if (typeof maxBitrate === 'number') enc.maxBitrate = maxBitrate;
      if (typeof maxFramerate === 'number') enc.maxFramerate = maxFramerate;
      sender.setParameters(params);
      return true;
    } catch (e) {
      console.warn('[PeerConnection] applyVideoSenderParams failed:', e);
      return false;
    }
  }

  /**
   * Replace the outgoing video track mid-call.
   * Used to swap camera ↔ screen share.
   * @param {MediaStreamTrack} newTrack
   * @returns {Promise<boolean>} true on success
   */
  async replaceVideoTrack(newTrack) {
    if (!this._pc) return false;
    const sender = this._sendersByKind.video || this._pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return false;
    try {
      await sender.replaceTrack(newTrack);
      this._sendersByKind.video = sender;
      // Swap in local stream reference
      const old = this._localStream.getVideoTracks()[0];
      if (old) this._localStream.removeTrack(old);
      this._localStream.addTrack(newTrack);
      return true;
    } catch (e) {
      console.error('[PeerConnection] replaceVideoTrack failed:', e);
      return false;
    }
  }

  // ── Stats Monitor ─────────────────────────────────────────────────────────

  startStatsMonitor() {
    if (!this._pc) return null;
    this._statsMonitor = new VRescuerStatsMonitor(this._pc);
    this._statsMonitor.start();
    return this._statsMonitor;
  }

  stopStatsMonitor() { this._statsMonitor?.stop(); }

  // ── Perfect Negotiation Controls ─────────────────────────────────────────

  setPoliteRole(polite) {
    this._polite = !!polite;
  }

  setSignalingReady(ready) {
    this._canNegotiate = !!ready;
  }

  // ── Outbound Track Control (independent of local capture) ───────────────

  async setOutboundEnabled(kind, enabled) {
    if (!this._pc) return false;
    const sender = this._sendersByKind[kind] || this._pc.getSenders().find(s => s.track?.kind === kind || s.track === null);
    if (!sender) return false;
    try {
      if (enabled) {
        const track = this._localStream?.getTracks().find(t => t.kind === kind) || null;
        await sender.replaceTrack(track);
      } else {
        await sender.replaceTrack(null);
      }
      this._sendersByKind[kind] = sender;
      return true;
    } catch (e) {
      console.warn('[PeerConnection] setOutboundEnabled failed:', e);
      return false;
    }
  }

  _applySenderPreferences() {
    const cfg = VRescuerConfig;
    const audioSender = this._sendersByKind.audio;
    if (audioSender?.setParameters) {
      try {
        const params = audioSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        const enc = params.encodings[0];
        if (cfg.AUDIO_MAX_BITRATE_BPS) enc.maxBitrate = cfg.AUDIO_MAX_BITRATE_BPS;
        if (typeof cfg.AUDIO_DTX === 'boolean') enc.dtx = cfg.AUDIO_DTX;
        if (cfg.AUDIO_PRIORITY) enc.priority = cfg.AUDIO_PRIORITY;
        if (cfg.AUDIO_NETWORK_PRIORITY) enc.networkPriority = cfg.AUDIO_NETWORK_PRIORITY;
        audioSender.setParameters(params);
      } catch (e) {
        console.warn('[PeerConnection] Audio sender prefs failed:', e);
      }
    }

    const videoSender = this._sendersByKind.video;
    if (videoSender?.setParameters) {
      try {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        const enc = params.encodings[0];
        if (cfg.VIDEO_PRIORITY) enc.priority = cfg.VIDEO_PRIORITY;
        if (cfg.VIDEO_NETWORK_PRIORITY) enc.networkPriority = cfg.VIDEO_NETWORK_PRIORITY;
        videoSender.setParameters(params);
      } catch (e) {
        console.warn('[PeerConnection] Video sender prefs failed:', e);
      }
    }
  }

  _setCodecPreferences(kind, transceiver) {
    if (!transceiver?.setCodecPreferences) return;
    const caps = RTCRtpSender.getCapabilities(kind);
    if (!caps?.codecs?.length) return;

    const order = (codec) => {
      const mt = codec.mimeType.toLowerCase();
      if (kind === 'audio') return mt === 'audio/opus' ? 0 : 10;
      if (mt === 'video/vp8')  return 0;
      if (mt === 'video/h264') return 1;
      if (mt === 'video/vp9')  return 2;
      return 10;
    };

    const sorted = [...caps.codecs].sort((a, b) => order(a) - order(b));
    try { transceiver.setCodecPreferences(sorted); }
    catch (e) { console.warn('[PeerConnection] setCodecPreferences failed:', e); }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close() {
    this.stopStatsMonitor();
    if (this._pc && this._pc.signalingState !== 'closed') this._pc.close();
    this._pc = null;
    this._localStream?.getTracks().forEach((t) => t.stop());
    this._localStream = null;
    this._remoteStreamFired = false;
    console.log('[PeerConnection] Closed.');
  }

  get pc()          { return this._pc;          }
  get localStream() { return this._localStream; }
}

window.VRescuerPeerConnection = VRescuerPeerConnection;
