/**
 * V-Rescuer — Main Application Orchestrator v3
 * ──────────────────────────────────────────────
 * Fault-tolerance protocol:  good → degraded → critical → (recovery) → good
 *
 * FIXES in v3:
 *  1. Admin simulation channel listener added (was completely missing)
 *  2. sendStateChange() now takes only `to`; bridge tracks `from` internally
 *  3. DC_MSG_STATUS / CRITICAL_FALLBACK now handled on the CALLEE side
 *     (data-channel.js emits 'status' event; wired here to show overlay)
 *
 * NEW in v3:
 *  - Screen share with one-click camera toggle-back
 *  - Audio level meter (real-time AnalyserNode)
 *  - Composite quality score (0–100) displayed on badge
 *  - Full session transcript accumulator + one-click export
 *  - Keyboard shortcuts: M=mic, C=cam, S=screenshare, E=end
 *  - Toast notification system for state transitions
 */

class VRescuerApp {
  constructor() {
    this._signaling    = new VRescuerSignaling();
    this._peerConn     = new VRescuerPeerConnection(this._signaling);
    this._dataChannel  = new VRescuerDataChannel();
    this._speechEngine = new VRescuerSpeechEngine();
    this._statsMonitor = null;

    this._videoCtrl = new VRescuerVideoController(this._peerConn);
    this._audioCtrl = new VRescuerAudioController(this._peerConn);
    this._aiCtrl    = new VRescuerAIController(this._speechEngine);

    this._role          = null;
    this._networkState  = 'good';
    this._inCall        = false;
    this._captionBuffer = '';
    this._transcript    = [];       // { ts, source, text }[]
    this._screenStream  = null;     // active screen share stream (if any)
    this._readyInterval = null;
    this._peerReady     = false;
    this._ruralMode     = false;
    this._ruralBackup   = null;

    this._ui = new VRescuerUI(this);

    this._wireSpeechEngine();
    this._wireDataChannel();
    this._wireAdminSim();          // ← FIX: was missing entirely
  }

  // ── Admin Simulation Channel ──────────────────────────────────────────────
  // FIX: Listen for simulation commands from the admin panel.
  // The original code had the simCh broadcaster in admin.js but no receiver.

  _wireAdminSim() {
    const simCh = new BroadcastChannel(VRescuerConfig.ADMIN_SIM_CHANNEL_NAME);
    simCh.onmessage = ({ data: msg }) => {
      if (msg.type === 'simulate' && msg.mode) {
        this.simulateNetworkState(msg.mode);
      }
    };
    this._simChannel = simCh; // keep reference for destroy
  }

  // ── Speech Engine → DataChannel bridge ────────────────────────────────────

  _wireSpeechEngine() {
    this._speechEngine.addEventListener('interim', (e) => {
      if (!['low','audio','critical'].includes(this._networkState)) return;
      this._dataChannel.sendInterim(e.detail.text);
      this._ui.updateLocalCaption(this._captionBuffer, e.detail.text, e.detail.source);
    });

    this._speechEngine.addEventListener('final', (e) => {
      if (!['low','audio','critical'].includes(this._networkState)) return;
      this._captionBuffer += e.detail.text + ' ';
      this._dataChannel.sendFinal(e.detail.text);
      this._ui.updateLocalCaption(this._captionBuffer, '', e.detail.source);
      // Accumulate session transcript
      this._transcript.push({ ts: Date.now(), source: e.detail.source, text: e.detail.text });
      const src = e.detail.source === 'ai'
        ? `🤖 Whisper AI (${e.detail.inferenceMs}ms)` : '🎤 Native';
      this._ui.setAIStatus(src);
    });

    this._speechEngine.addEventListener('status', (e) => {
      this._ui.setModelStatus(e.detail);
    });
  }

  // ── DataChannel → Remote caption display ──────────────────────────────────

  _wireDataChannel() {
    this._dataChannel.addEventListener('message', (e) => {
      const { type, text } = e.detail;
      const cfg = VRescuerConfig;
      if (type === cfg.DC_MSG_INTERIM) {
        this._ui.updateRemoteCaption(null, text);
      } else if (type === cfg.DC_MSG_FINAL) {
        this._ui.appendRemoteCaption(text);
      }
    });

    // FIX: Handle STATUS messages (CRITICAL_FALLBACK / RECOVERY) on the receiver side.
    // Previously dc-channel.js decoded these but silently dropped them (no listener).
    this._dataChannel.addEventListener('status', (e) => {
      const cmd = e.detail.command;
      if (cmd === 'CRITICAL_FALLBACK') {
        this._ui.showCaptionOverlay();
        this._ui.showToast('⚡ Peer switched to DataChannel captions', 'warn');
      } else if (cmd === 'RECOVERY') {
        this._ui.hideCaptionOverlay();
        this._ui.showToast('📶 Peer restored A/V stream', 'ok');
      }
    });

    this._dataChannel.addEventListener('open',  () => this._ui.setDataChannelStatus(true));
    this._dataChannel.addEventListener('close', () => this._ui.setDataChannelStatus(false));
  }

  // ── Call Setup ─────────────────────────────────────────────────────────────

  async startCall(role) {
    if (this._inCall) return;
    this._role   = role;
    this._inCall = true;
    this._ui.setPhase('connecting');
    this._ui.log(`Initializing as ${role === 'caller' ? '📡 Caller' : '📻 Callee'}…`);
    this._peerReady = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          resizeMode: 'crop-and-scale',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
          sampleRate: 48000,
          sampleSize: 16,
        },
      });
      const camTrack = stream.getVideoTracks()[0];
      if (camTrack) camTrack.contentHint = 'motion';
      this._ui.setLocalStream(stream);
      this._ui.startAudioMeter(stream);
      this._ui.log('✓ Camera & microphone acquired.');

      // Preload AI model during call setup
      this._aiCtrl.setStream(stream);
      this._aiCtrl.preload();
      this._ui.log('⏳ Whisper AI model preloading in background…');

      this._signaling.init(role);
      this._peerConn.setPoliteRole(role === 'callee');
      this._peerConn.setSignalingReady(false);
      await this._peerConn.init(stream);
      await this._videoCtrl.setQuality('good');

      this._peerConn.onRemoteStream = (remoteStream) => {
        this._ui.setRemoteStream(remoteStream);
        this._ui.log('✓ Remote stream connected.');
        this._ui.setPhase('connected');
        this._startStatsMonitor();
        if (this._readyInterval) {
          clearInterval(this._readyInterval);
          this._readyInterval = null;
        }
      };

      this._peerConn.onConnectionStateChange = (state) => {
        this._ui.setConnectionState(state);
        if (state === 'disconnected' || state === 'failed') {
          this._ui.log('⚠ Peer connection lost.');
          this._ui.showToast('⚠ Peer connection lost', 'warn');
        }
        if (state === 'closed') this.endCall();
      };

      this._peerConn.onIceStateChange = (state) => this._ui.setIceState(state);

      const onPeerReady = async () => {
        if (this._peerReady) return;
        this._peerReady = true;
        if (this._readyInterval) {
          clearInterval(this._readyInterval);
          this._readyInterval = null;
        }
        if (role === 'caller') {
          this._peerConn.setSignalingReady(true);
          this._ui.log('✓ Callee ready — negotiating…');
          await this._peerConn.createOffer();
        } else {
          this._ui.log('✓ Caller ready — waiting for offer…');
        }
      };

      this._signaling.addEventListener('peer-ready', onPeerReady);

      const sendReady = () => {
        try { this._signaling.send('ready', {}); }
        catch (e) { console.warn('[App] Failed to send ready:', e); }
      };

      if (role === 'caller') {
        this._dataChannel.create(this._peerConn.pc);
        this._ui.log('Waiting for callee to join…');
        sendReady();
        this._readyInterval = setInterval(sendReady, 1000);
      } else {
        this._peerConn.onDataChannel = (ch) => {
          this._dataChannel.attach(ch);
          this._ui.log('✓ DataChannel connected.');
        };
        sendReady();
        this._readyInterval = setInterval(sendReady, 1000);
        this._peerConn.setSignalingReady(true);
        this._ui.log('✓ Ready — waiting for offer…');
      }

    } catch (err) {
      console.error('[App] Call setup failed:', err);
      this._ui.log(`✗ Error: ${err.message}`);
      this._ui.showToast(`✗ ${err.message}`, 'error');
      this._ui.setPhase('idle');
      this._inCall = false;
    }
  }

  // ── Stats Monitor ──────────────────────────────────────────────────────────

  _startStatsMonitor() {
    this._statsMonitor = this._peerConn.startStatsMonitor();

    this._statsMonitor.addEventListener('stats-update', (e) => {
      this._ui.updateStats(e.detail);
      this._ui.updateQualityBadge(e.detail.qualityScore);
      this._videoCtrl.adapt(e.detail, this._networkState);
      const perf = this._videoCtrl.getPerfState();
      this._ui.setPerfMode(perf);
      // Forward quality score to admin
      if (this._ui._adminBridge) this._ui._adminBridge.sendQuality(e.detail.qualityScore);
    });

    this._statsMonitor.addEventListener('state-change', (e) => {
      const { from, to } = e.detail;
      this._networkState = to;
      this._ui.log(`[Network] ${from.toUpperCase()} → ${to.toUpperCase()}`);
      this._applyNetworkState(to, from);
    });
  }

  // ── Network State Machine ──────────────────────────────────────────────────

  async _applyNetworkState(newState, prevState) {
    const pc = this._peerConn;

    switch (newState) {

      case 'good':
        if (prevState === 'critical') {
          this._ui.log('📶 Network recovered — restoring full A/V…');
          this._ui.showToast('📶 Network recovered — A/V restored', 'ok');
          await this._videoCtrl.setOutboundEnabled(true);
          await this._audioCtrl.setOutboundEnabled(true);
          await this._videoCtrl.setQuality('good');
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._captionBuffer = '';
          this._dataChannel.sendStatus('RECOVERY');
        } else if (prevState === 'audio') {
          this._ui.log('📶 Network stable — restoring video…');
          this._ui.showToast('📶 Video restored', 'ok');
          await this._videoCtrl.setOutboundEnabled(true);
          await this._videoCtrl.setQuality('good');
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._captionBuffer = '';
          this._dataChannel.sendStatus('RECOVERY');
        } else if (prevState === 'degraded') {
          this._ui.log('📶 Network stable — restoring video…');
          this._ui.showToast('📶 Video restored', 'ok');
          await this._videoCtrl.setOutboundEnabled(true);
          await this._videoCtrl.setQuality('good');
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._captionBuffer = '';
          this._dataChannel.sendStatus('RECOVERY');
        }
        this._ui.setNetworkMode('good');
        break;

      case 'degraded':
        this._ui.log('⚠ Bandwidth low — reducing video quality…');
        this._ui.showToast('⚠ Bandwidth low — video quality reduced', 'warn');
        await this._videoCtrl.setOutboundEnabled(true);
        await this._audioCtrl.setOutboundEnabled(true);
        await this._videoCtrl.setQuality('degraded');
        if (prevState === 'critical') {
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._dataChannel.sendStatus('RECOVERY');
        } else if (prevState === 'audio') {
          await this._videoCtrl.setOutboundEnabled(true);
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._captionBuffer = '';
          this._dataChannel.sendStatus('RECOVERY');
        }
        this._ui.setNetworkMode('degraded');
        break;

      case 'low':
        this._ui.log('⚠ Bandwidth very low — switching to low video…');
        this._ui.showToast('⚠ Bandwidth very low — low video mode', 'warn');
        await this._videoCtrl.setOutboundEnabled(true);
        await this._audioCtrl.setOutboundEnabled(true);
        await this._videoCtrl.setQuality('low');
        if (prevState === 'critical') {
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._dataChannel.sendStatus('RECOVERY');
        } else if (prevState === 'audio') {
          await this._videoCtrl.setOutboundEnabled(true);
          this._aiCtrl.stop();
          this._ui.hideCaptionOverlay();
          this._captionBuffer = '';
          this._dataChannel.sendStatus('RECOVERY');
        }
        this._aiCtrl.start();
        this._ui.showCaptionOverlay();
        this._ui.setNetworkMode('low');
        break;

      case 'audio':
        this._ui.log('🎧 Bandwidth very low — switching to audio only…');
        this._ui.showToast('🎧 Audio only mode', 'warn');
        await this._videoCtrl.setOutboundEnabled(false);
        await this._audioCtrl.setOutboundEnabled(true);
        this._aiCtrl.start();
        this._ui.showCaptionOverlay();
        this._ui.setNetworkMode('audio');
        break;

      case 'critical':
        this._ui.log('🚨 CRITICAL — activating DataChannel caption fallback…');
        this._ui.showToast('🚨 Critical — live captions active', 'error');
        await this._videoCtrl.setOutboundEnabled(false);
        await this._audioCtrl.setOutboundEnabled(false);
        this._dataChannel.sendStatus('CRITICAL_FALLBACK');
        this._aiCtrl.start();
        this._ui.showCaptionOverlay();
        this._ui.setNetworkMode('critical');
        this._ui.log('💬 Live captions active — voice is being transcribed.');
        break;
    }
  }

  setLowLatencyMode(enabled) {
    this._aiCtrl.setLowLatencyMode(enabled);
  }

  setRuralMode(enabled) {
    const cfg = VRescuerConfig;
    const rural = cfg.RURAL_PROFILE;
    this._ruralMode = !!enabled;
    this._videoCtrl.setRuralMode(this._ruralMode);

    if (this._ruralMode) {
      this._ruralBackup = {
        modelPolicy: cfg.AI_MODEL_POLICY,
        lowLatency: cfg.AI_LOW_LATENCY_MODE,
      };
      if (rural?.modelPolicy) this._aiCtrl.setModelPolicy(rural.modelPolicy);
      if (typeof rural?.lowLatency === 'boolean') this._aiCtrl.setLowLatencyMode(rural.lowLatency);
      if (this._inCall) this._videoCtrl.setQuality(rural?.forceProfile ?? 'rural');
    } else if (this._ruralBackup) {
      this._aiCtrl.setModelPolicy(this._ruralBackup.modelPolicy);
      this._aiCtrl.setLowLatencyMode(this._ruralBackup.lowLatency);
      if (this._inCall) this._videoCtrl.setQuality('good');
      this._ruralBackup = null;
    }
  }

  // ── Screen Share ───────────────────────────────────────────────────────────

  async toggleScreenShare() {
    if (!this._inCall) return;

    if (this._screenStream) {
      // Stop screen share → revert to camera
      this._screenStream.getTracks().forEach(t => t.stop());
      this._screenStream = null;
      // Re-acquire camera video track
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const camTrack = camStream.getVideoTracks()[0];
        if (camTrack) camTrack.contentHint = 'motion';
        const ok = await this._peerConn.replaceVideoTrack(camTrack);
        if (ok) {
          this._ui.setLocalVideoTrack(camTrack);
          this._ui.log('📷 Camera restored.');
          this._ui.setScreenShareActive(false);
        }
      } catch (e) {
        this._ui.log(`✗ Camera restore failed: ${e.message}`);
      }
    } else {
      // Start screen share
      try {
        this._screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screenTrack  = this._screenStream.getVideoTracks()[0];
        if (screenTrack) screenTrack.contentHint = 'detail';
        // Auto-revert when user stops sharing via browser UI
        screenTrack.onended = () => this.toggleScreenShare();
        const ok = await this._peerConn.replaceVideoTrack(screenTrack);
        if (ok) {
          this._ui.setLocalVideoTrack(screenTrack);
          this._ui.log('🖥 Screen share started.');
          this._ui.setScreenShareActive(true);
        }
      } catch (e) {
        if (e.name !== 'NotAllowedError') {
          this._ui.log(`✗ Screen share failed: ${e.message}`);
        }
        this._screenStream = null;
      }
    }
  }

  // ── Transcript Export ──────────────────────────────────────────────────────

  exportTranscript() {
    if (!this._transcript.length) {
      this._ui.showToast('No transcript to export yet', 'info');
      return;
    }
    const lines = this._transcript.map(({ ts, source, text }) => {
      const time = new Date(ts).toLocaleTimeString('en', { hour12: false });
      const tag  = source === 'ai' ? '[Whisper AI]' : '[Native STT]';
      return `[${time}] ${tag} ${text}`;
    });
    const header = `V-Rescuer Session Transcript\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(60)}\n\n`;
    const blob   = new Blob([header + lines.join('\n')], { type: 'text/plain' });
    const url    = URL.createObjectURL(blob);
    const a      = Object.assign(document.createElement('a'), {
      href:     url,
      download: `v-rescuer-transcript-${Date.now()}.txt`,
    });
    a.click();
    URL.revokeObjectURL(url);
    this._ui.showToast('📄 Transcript exported', 'ok');
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  simulateNetworkState(state) {
    if (!this._inCall) {
      this._ui.showToast('Start a call first to simulate', 'warn');
      return;
    }
    const prev = this._networkState;
    this._networkState = state;
    this._ui.log(`🧪 SIM → ${state.toUpperCase()}`);
    this._applyNetworkState(state, prev);
    if (this._statsMonitor) this._statsMonitor._currentState = state;
  }

  // ── End Call ───────────────────────────────────────────────────────────────

  endCall() {
    if (!this._inCall) return;
    if (this._readyInterval) {
      clearInterval(this._readyInterval);
      this._readyInterval = null;
    }
    if (this._screenStream) {
      this._screenStream.getTracks().forEach(t => t.stop());
      this._screenStream = null;
    }
    this._speechEngine.stop();
    this._dataChannel.destroy();
    this._peerConn.close();
    this._signaling.destroy();

    this._inCall        = false;
    this._networkState  = 'good';
    this._captionBuffer = '';

    this._ui.stopAudioMeter();
    this._ui.hideCaptionOverlay();
    this._ui.setNetworkMode('good');
    this._ui.setPhase('idle');
    this._ui.resetRemotePanel();
    this._ui.setScreenShareActive(false);
    this._ui.log('📴 Call ended.');
  }

  get role()         { return this._role;         }
  get inCall()       { return this._inCall;        }
  get networkState() { return this._networkState;  }
  get transcript()   { return this._transcript;    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI Controller
// ─────────────────────────────────────────────────────────────────────────────

class VRescuerUI {
  constructor(app) {
    this._app             = app;
    this._remoteCaption   = '';
    this._timerInterval   = null;
    this._callStart       = null;
    this._adminBridge     = new VRescuerAdminBridge();
    this._meterCtx        = null;  // AudioContext for level meter
    this._meterAnalyser   = null;
    this._meterRAF        = null;
    this._toastQueue      = [];
    this._toastActive     = false;

    this._initElements();
    this._bindButtons();
    this._bindKeyboard();
  }

  _initElements() {
    this.localVideo   = document.getElementById('video-local');
    this.remoteVideo  = document.getElementById('video-remote');
    this.captionBox   = document.getElementById('caption-overlay');
    this.captionText  = document.getElementById('caption-text');
    this.localCaption = document.getElementById('local-caption');
    this.modeEl       = document.getElementById('network-badge');
    this.callTimer    = document.getElementById('call-timer');
    this.qualityEl    = document.getElementById('quality-score');
    this.stabilityEl  = document.getElementById('stability-score');
    this.netStats     = document.getElementById('net-stats');
    this.netMini      = document.getElementById('net-mini');
    this.autoTuneBtn  = document.getElementById('btn-auto-tune');
    this.meterFill    = document.getElementById('meter-fill');
    this._netHistory  = [];
    this._lossHistory = [];
    this._rttHistory  = [];
  }

  _bindButtons() {
    document.getElementById('btn-caller')?.addEventListener('click', () => this._app.startCall('caller'));
    document.getElementById('btn-callee')?.addEventListener('click', () => this._app.startCall('callee'));
    document.getElementById('btn-end')?.addEventListener('click',   () => this._app.endCall());
    document.getElementById('btn-screen')?.addEventListener('click', () => this._app.toggleScreenShare());
    document.getElementById('btn-export')?.addEventListener('click', () => this._app.exportTranscript());

    if (this.autoTuneBtn) {
      this.autoTuneBtn.classList.toggle('active', !!VRescuerConfig.AUTO_TUNE_THRESHOLDS);
      this.autoTuneBtn.addEventListener('click', () => {
        VRescuerConfig.AUTO_TUNE_THRESHOLDS = !VRescuerConfig.AUTO_TUNE_THRESHOLDS;
        this.autoTuneBtn.classList.toggle('active', !!VRescuerConfig.AUTO_TUNE_THRESHOLDS);
        this.showToast(
          VRescuerConfig.AUTO_TUNE_THRESHOLDS ? 'Auto-tune enabled' : 'Auto-tune disabled',
          'info'
        );
      });
    }

    const lowLatencyBtn = document.getElementById('btn-low-latency');
    if (lowLatencyBtn) {
      lowLatencyBtn.classList.toggle('active', !!VRescuerConfig.AI_LOW_LATENCY_MODE);
      lowLatencyBtn.addEventListener('click', () => {
        VRescuerConfig.AI_LOW_LATENCY_MODE = !VRescuerConfig.AI_LOW_LATENCY_MODE;
        lowLatencyBtn.classList.toggle('active', !!VRescuerConfig.AI_LOW_LATENCY_MODE);
        this._app.setLowLatencyMode(VRescuerConfig.AI_LOW_LATENCY_MODE);
        this.showToast(
          VRescuerConfig.AI_LOW_LATENCY_MODE ? 'Low latency enabled' : 'Low latency disabled',
          'info'
        );
      });
    }


    // Mic toggle
    document.getElementById('btn-mic')?.addEventListener('click', () => {
      const stream = this._app._peerConn?.localStream;
      if (!stream) return;
      const btn   = document.getElementById('btn-mic');
      const on    = stream.getAudioTracks().some(t => t.enabled);
      stream.getAudioTracks().forEach(t => t.enabled = !on);
      btn.classList.toggle('off', on);
      btn.title = on ? 'Unmute mic' : 'Mute mic';
      this.showToast(on ? '🔇 Mic muted' : '🎤 Mic on', 'info');
    });

    // Camera toggle
    document.getElementById('btn-camera')?.addEventListener('click', () => {
      const stream = this._app._peerConn?.localStream;
      if (!stream) return;
      const btn   = document.getElementById('btn-camera');
      const on    = stream.getVideoTracks().some(t => t.enabled);
      stream.getVideoTracks().forEach(t => t.enabled = !on);
      btn.classList.toggle('off', on);
      btn.title = on ? 'Show camera' : 'Hide camera';
      this.showToast(on ? '📷 Camera off' : '📷 Camera on', 'info');
    });
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't fire in input elements
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      switch (e.key.toLowerCase()) {
        case 'm': document.getElementById('btn-mic')?.click(); break;
        case 'c': document.getElementById('btn-camera')?.click(); break;
        case 's': if (this._app.inCall) this._app.toggleScreenShare(); break;
        case 'e': if (this._app.inCall) this._app.endCall(); break;
        case 'x': if (this._app.inCall) this._app.exportTranscript(); break;
      }
    });
  }

  // ── Stream Setters ────────────────────────────────────────────────────────

  setLocalStream(stream) {
    if (this.localVideo) this.localVideo.srcObject = stream;
  }

  setLocalVideoTrack(track) {
    if (!this.localVideo) return;
    const stream = new MediaStream([track]);
    this.localVideo.srcObject = stream;
  }

  setRemoteStream(stream) {
    if (this.remoteVideo) {
      this.remoteVideo.srcObject = stream;
      this.remoteVideo.style.display = 'block';
    }
    document.getElementById('remote-placeholder')?.style.setProperty('display','none');
  }

  resetRemotePanel() {
    if (this.remoteVideo) { this.remoteVideo.srcObject = null; this.remoteVideo.style.display = 'none'; }
    const ph = document.getElementById('remote-placeholder');
    if (ph) ph.style.removeProperty('display');
    const txt = document.getElementById('ph-text');
    if (txt) txt.textContent = 'Waiting for peer to join…';
  }

  // ── Audio Meter ───────────────────────────────────────────────────────────

  startAudioMeter(stream) {
    if (!this.meterFill) return;
    try {
      this._meterCtx      = new AudioContext();
      this._meterAnalyser = this._meterCtx.createAnalyser();
      this._meterAnalyser.fftSize = 256;
      this._meterAnalyser.smoothingTimeConstant = VRescuerConfig.AUDIO_METER_SMOOTHING;
      const src = this._meterCtx.createMediaStreamSource(stream);
      src.connect(this._meterAnalyser);
      const buf = new Uint8Array(this._meterAnalyser.frequencyBinCount);
      const tick = () => {
        this._meterAnalyser.getByteFrequencyData(buf);
        const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
        const pct = Math.min(100, (avg / 128) * 100);
        if (this.meterFill) this.meterFill.style.width = `${pct}%`;
        this._meterRAF = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn('[UI] Audio meter failed:', e);
    }
  }

  stopAudioMeter() {
    cancelAnimationFrame(this._meterRAF);
    try { this._meterCtx?.close(); } catch (e) { /* ignore */ }
    this._meterCtx = this._meterAnalyser = null;
    if (this.meterFill) this.meterFill.style.width = '0%';
  }

  // ── Phase & Timer ─────────────────────────────────────────────────────────

  setPhase(phase) {
    document.body.setAttribute('data-phase', phase);
    this._adminBridge.sendPhase(phase);

    const isIdle = phase === 'idle';
    document.getElementById('btn-caller')?.toggleAttribute('disabled', !isIdle);
    document.getElementById('btn-callee')?.toggleAttribute('disabled', !isIdle);
    document.getElementById('btn-end')?.toggleAttribute('disabled',    isIdle);
    document.getElementById('btn-screen')?.toggleAttribute('disabled', isIdle);
    document.getElementById('btn-export')?.toggleAttribute('disabled', isIdle);

    if (phase === 'idle' || phase === 'connecting') {
      const micBtn = document.getElementById('btn-mic');
      const camBtn = document.getElementById('btn-camera');
      micBtn?.classList.remove('off');
      camBtn?.classList.remove('off');
      if (micBtn) micBtn.title = 'Toggle microphone';
      if (camBtn) camBtn.title = 'Toggle camera';
    }

    if (phase === 'connected') {
      this._callStart     = performance.now();
      this._timerInterval = setInterval(() => {
        const s = Math.floor((performance.now() - this._callStart) / 1000);
        if (this.callTimer) {
          this.callTimer.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
        }
      }, 1000);
    } else if (phase === 'idle') {
      clearInterval(this._timerInterval);
      if (this.callTimer)   this.callTimer.textContent   = '00:00';
      if (this.qualityEl)   { this.qualityEl.textContent = '—'; this.qualityEl.dataset.level = ''; }
    }

    const txt = document.getElementById('ph-text');
    if (txt) txt.textContent = phase === 'connecting' ? 'Connecting…' : 'Waiting for peer to join…';
  }

  // ── Network Mode Badge ────────────────────────────────────────────────────

  setNetworkMode(mode) {
    if (this.modeEl) {
      this.modeEl.setAttribute('data-mode', mode);
      this.modeEl.textContent = {
        good: 'Healthy',
        degraded: 'Reduced Video',
        low: 'Low Video',
        audio: 'Audio Only',
        critical: 'Captions',
      }[mode] ?? mode;
    }
    // FIX: pass only 'to' — bridge derives 'from' internally
    this._adminBridge.sendStateChange(mode);
  }

  // ── Quality Badge ─────────────────────────────────────────────────────────

  updateQualityBadge(score) {
    if (!this.qualityEl) return;
    this.qualityEl.textContent = `Q:${score}`;
    this.qualityEl.dataset.level =
      score >= 80 ? 'good' :
      score >= 50 ? 'warn' : 'critical';
  }

  updateStabilityBadge(score) {
    if (!this.stabilityEl) return;
    this.stabilityEl.textContent = `S:${score}`;
    this.stabilityEl.dataset.level =
      score >= 80 ? 'good' :
      score >= 50 ? 'warn' : 'critical';
  }

  // ── Screen Share Badge ────────────────────────────────────────────────────

  setScreenShareActive(active) {
    document.getElementById('btn-screen')?.classList.toggle('active', active);
    document.getElementById('screen-badge')?.classList.toggle('visible', active);
  }

  // ── Captions ──────────────────────────────────────────────────────────────

  showCaptionOverlay() {
    this.captionBox?.classList.add('active');
    this._remoteCaption = '';
    if (this.captionText) this.captionText.innerHTML = '';
  }

  hideCaptionOverlay() {
    this.captionBox?.classList.remove('active');
  }

  updateRemoteCaption(finalText, interimText) {
    if (!this.captionText) return;
    const final   = this._remoteCaption
      ? `<span class="caption-final">${this._escHtml(this._remoteCaption)}</span>` : '';
    const interim = interimText
      ? `<span class="caption-interim">${this._escHtml(interimText)}</span>` : '';
    this.captionText.innerHTML = final + interim;
    this.captionText.scrollTop = this.captionText.scrollHeight;
  }

  appendRemoteCaption(text) {
    this._remoteCaption += text + ' ';
    // Trim to prevent unbounded growth
    if (this._remoteCaption.length > VRescuerConfig.MAX_TRANSCRIPT_CHARS) {
      this._remoteCaption = this._remoteCaption.slice(-VRescuerConfig.MAX_TRANSCRIPT_CHARS / 2);
    }
    this.updateRemoteCaption(null, '');
  }

  updateLocalCaption(finalText, interimText, source) {
    if (!this.localCaption) return;
    const tag   = source === 'ai' ? '🤖' : '🎤';
    const parts = [];
    if (finalText)   parts.push(`<span class="lc-final">${this._escHtml(finalText)}</span>`);
    if (interimText) parts.push(`<span class="lc-interim">${this._escHtml(interimText)}…</span>`);
    this.localCaption.innerHTML = parts.length ? `${tag} ${parts.join('')}` : `${tag} Listening…`;
    this.localCaption.style.opacity = '1';
    const src = document.getElementById('caption-source-tag');
    if (src) src.textContent = source === 'ai' ? 'Whisper AI · DataChannel' : 'Native STT · DataChannel';
  }

  // ── Toast Notifications ───────────────────────────────────────────────────

  showToast(message, level = 'info') {
    this._toastQueue.push({ message, level });
    if (!this._toastActive) this._nextToast();
  }

  _nextToast() {
    if (!this._toastQueue.length) { this._toastActive = false; return; }
    this._toastActive = true;
    const { message, level } = this._toastQueue.shift();
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent   = message;
    el.dataset.level = level;
    el.classList.remove('out');
    el.classList.add('in');
    setTimeout(() => {
      el.classList.replace('in', 'out');
      setTimeout(() => this._nextToast(), 350);
    }, 2800);
  }

  // ── Connection Status (→ Admin only) ──────────────────────────────────────

  setConnectionState(state) { this._adminBridge.sendLog(`[ICE] Connection → ${state}`); }
  setIceState(state)        { this._adminBridge.sendLog(`[ICE] ICE → ${state}`); }
  setDataChannelStatus(open){ this._adminBridge.sendDCStats({ open, ts: Date.now() }); }
  setModelStatus(detail)    { this._adminBridge.sendAIStatus(detail); }
  setAIStatus(text)         { this._adminBridge.sendLog(`[AI] ${text}`); }
  setPerfMode(perf)          { this._adminBridge.sendPerfMode(perf); }
  updateStats(stats) {
    this._adminBridge.sendStats(stats);
    const bps   = stats.bitrateBps ?? 0;
    const loss  = stats.packetLossRatio ?? 0;
    const rttMs = stats.roundTripTime ?? 0;
    if (this.netStats) {
      this.netStats.textContent =
        `${(bps / 1000).toFixed(1)} kbps · ${(loss * 100).toFixed(1)}% · ${Math.round(rttMs)} ms`;
    }
    if (this.netMini) {
      this._netHistory.push(bps / 1000);
      this._lossHistory.push(loss * 100);
      this._rttHistory.push(rttMs);
      if (this._netHistory.length > 30) this._netHistory.shift();
      if (this._lossHistory.length > 30) this._lossHistory.shift();
      if (this._rttHistory.length > 30) this._rttHistory.shift();
      this._drawNetMini();
    }
    if (typeof stats.stabilityScore === 'number') this.updateStabilityBadge(stats.stabilityScore);
  }

  _drawNetMini() {
    if (!this.netMini) return;
    const canvas = this.netMini;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * devicePixelRatio;
    const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    if (this._netHistory.length < 2) return;

    const xStep = W / (this._netHistory.length - 1);
    const drawLine = (data, color) => {
      const max = Math.max(...data, 1);
      const toY = v => H - (v / max) * (H * 0.8) - H * 0.1;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i * xStep;
        const y = toY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * devicePixelRatio;
      ctx.stroke();
    };

    drawLine(this._netHistory,  'rgba(67,160,71,0.8)');
    drawLine(this._lossHistory, 'rgba(232,146,10,0.8)');
    drawLine(this._rttHistory,  'rgba(26,115,232,0.8)');
  }

  log(message) {
    this._adminBridge.sendLog(message);
    console.log(`[V-Rescuer] ${message}`);
  }

  _escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  window.vRescuer = new VRescuerApp();
  console.log('[V-Rescuer] v3 initialized. Tab 1: Caller · Tab 2: Callee.');
});
