/**
 * V-Rescuer PeerConnection Manager
 * ──────────────────────────────────
 * Manages the RTCPeerConnection lifecycle:
 *   - ICE negotiation via Signaling module
 *   - Media track management (add, enable/disable)
 *   - DataChannel wiring
 *   - Stats monitor integration
 *
 * Events emitted (via callbacks set on the instance):
 *   onRemoteStream(stream)
 *   onDataChannel(channel)
 *   onConnectionStateChange(state)
 *   onIceStateChange(state)
 */

class VRescuerPeerConnection {
  constructor(signaling) {
    this._signaling = signaling;
    this._pc = null;
    this._localStream = null;
    this._statsMonitor = null;

    // Public callbacks
    this.onRemoteStream = null;
    this.onDataChannel = null;
    this.onConnectionStateChange = null;
    this.onIceStateChange = null;
  }

  /** Create the RTCPeerConnection and wire up all event handlers */
  _createPC() {
    const pc = new RTCPeerConnection({
      iceServers: VRescuerConfig.ICE_SERVERS,
    });
    this._remoteStreamFired = false; // guard: only fire onRemoteStream once

    // ICE candidate → send via signaling
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._signaling.send('ice-candidate', candidate.toJSON());
      }
    };

    // Remote tracks arrive — may fire once per track (audio + video separately)
    pc.ontrack = (event) => {
      console.log('[PeerConnection] Remote track received:', event.track.kind);
      if (this.onRemoteStream && event.streams[0] && !this._remoteStreamFired) {
        this._remoteStreamFired = true;
        this.onRemoteStream(event.streams[0]);
      }
    };

    // DataChannel from remote (callee side)
    pc.ondatachannel = (event) => {
      console.log('[PeerConnection] DataChannel received.');
      if (this.onDataChannel) {
        this.onDataChannel(event.channel);
      }
    };

    // Connection state
    pc.onconnectionstatechange = () => {
      console.log('[PeerConnection] Connection state:', pc.connectionState);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(pc.connectionState);
      }
    };

    // ICE state
    pc.oniceconnectionstatechange = () => {
      console.log('[PeerConnection] ICE state:', pc.iceConnectionState);
      if (this.onIceStateChange) {
        this.onIceStateChange(pc.iceConnectionState);
      }
    };

    // Negotiation needed (re-offer on track change)
    pc.onnegotiationneeded = async () => {
      console.log('[PeerConnection] Negotiation needed.');
    };

    return pc;
  }

  /**
   * Initialize with local media stream.
   * Creates the PeerConnection and adds tracks.
   */
  async init(localStream) {
    this._localStream = localStream;
    this._pc = this._createPC();

    // Add all local tracks to the peer connection
    localStream.getTracks().forEach((track) => {
      this._pc.addTrack(track, localStream);
      console.log(`[PeerConnection] Added local track: ${track.kind}`);
    });

    // Wire signaling events to local handlers
    this._signaling.addEventListener('ice-candidate', (e) => {
      this._addIceCandidate(e.detail);
    });
    this._signaling.addEventListener('offer', (e) => {
      this._handleOffer(e.detail);
    });
    this._signaling.addEventListener('answer', (e) => {
      this._handleAnswer(e.detail);
    });

    return this._pc;
  }

  /** CALLER: Create and send offer */
  async createOffer() {
    const offer = await this._pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this._pc.setLocalDescription(offer);
    this._signaling.send('offer', offer);
    console.log('[PeerConnection] Offer sent.');
  }

  /** CALLEE: Handle incoming offer, create & send answer */
  async _handleOffer(offer) {
    console.log('[PeerConnection] Received offer, creating answer...');
    await this._pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    this._signaling.send('answer', answer);
    console.log('[PeerConnection] Answer sent.');
  }

  /** CALLER: Handle incoming answer */
  async _handleAnswer(answer) {
    console.log('[PeerConnection] Received answer, setting remote description...');
    await this._pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async _addIceCandidate(candidateData) {
    try {
      await this._pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (e) {
      console.warn('[PeerConnection] Failed to add ICE candidate:', e);
    }
  }

  // ─── Media Track Controls ─────────────────────────────────────────────────

  /** Enable or disable the local video track */
  setVideoEnabled(enabled) {
    this._localStream?.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
      console.log(`[PeerConnection] Video track ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  /** Enable or disable the local audio track */
  setAudioEnabled(enabled) {
    this._localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
      console.log(`[PeerConnection] Audio track ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  // ─── Stats Monitor ────────────────────────────────────────────────────────

  startStatsMonitor() {
    if (!this._pc) return null;
    this._statsMonitor = new VRescuerStatsMonitor(this._pc);
    this._statsMonitor.start();
    return this._statsMonitor;
  }

  stopStatsMonitor() {
    this._statsMonitor?.stop();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  close() {
    this.stopStatsMonitor();
    if (this._pc && this._pc.signalingState !== 'closed') {
      this._pc.close();
    }
    this._pc = null;
    this._localStream?.getTracks().forEach((t) => t.stop());
    this._localStream = null;
    console.log('[PeerConnection] Closed.');
  }

  get pc() { return this._pc; }
  get localStream() { return this._localStream; }
  get statsMonitor() { return this._statsMonitor; }
}

window.VRescuerPeerConnection = VRescuerPeerConnection;
