/**
 * V-Rescuer — Main Application Orchestrator v2
 * ──────────────────────────────────────────────
 * Implements the full fault-tolerance protocol:
 *
 *   good → degraded → critical → (recovery) → good
 *
 * Key upgrades in v2:
 *  - Whisper AI model preloads during call setup (not on fallback trigger)
 *  - Binary DataChannel protocol (77% smaller messages)
 *  - Adaptive stats polling (500ms–3s based on network state)
 *  - Speech engine streams BOTH AI and native results to DataChannel
 *  - Clean endCall() fully resets all UI/state
 */

class VRescuerApp {
  constructor() {
    this._signaling     = new VRescuerSignaling();
    this._peerConn      = new VRescuerPeerConnection(this._signaling);
    this._dataChannel   = new VRescuerDataChannel();
    this._speechEngine  = new VRescuerSpeechEngine();
    this._statsMonitor  = null;

    this._role          = null;
    this._networkState  = 'good';
    this._inCall        = false;
    this._captionBuffer = '';

    this._ui = new VRescuerUI(this);
    this._wireSpeechEngine();
    this._wireDataChannel();
  }

  // ── Speech Engine → DataChannel bridge ─────────────────────────────────────

  _wireSpeechEngine() {
    // AI/Native interim — send immediately for lowest latency
    this._speechEngine.addEventListener('interim', (e) => {
      if (this._networkState !== 'critical') return;
      this._dataChannel.sendInterim(e.detail.text);
      this._ui.updateLocalCaption(this._captionBuffer, e.detail.text, e.detail.source);
    });

    // Final committed word(s) — append to buffer, send as final
    this._speechEngine.addEventListener('final', (e) => {
      if (this._networkState !== 'critical') return;
      this._captionBuffer += e.detail.text + ' ';
      this._dataChannel.sendFinal(e.detail.text);
      this._ui.updateLocalCaption(this._captionBuffer, '', e.detail.source);

      const src = e.detail.source === 'ai'
        ? `🤖 Whisper AI (${e.detail.inferenceMs}ms)`
        : '🎤 Native';
      this._ui.setAIStatus(src);
    });

    // Model loading progress → update UI badge
    this._speechEngine.addEventListener('status', (e) => {
      this._ui.setModelStatus(e.detail);
    });
  }

  // ── DataChannel → Remote caption display ────────────────────────────────────

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

    this._dataChannel.addEventListener('open',  () => this._ui.setDataChannelStatus(true));
    this._dataChannel.addEventListener('close', () => this._ui.setDataChannelStatus(false));
  }

  // ── Call Setup ──────────────────────────────────────────────────────────────

  async startCall(role) {
    if (this._inCall) return;
    this._role   = role;
    this._inCall = true;
    this._ui.setPhase('connecting');
    this._ui.log(`Initializing as ${role === 'caller' ? '📡 Caller' : '📻 Callee'}…`);

    try {
      // 1. Get local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this._ui.setLocalStream(stream);
      this._ui.log('✓ Camera & microphone acquired.');

      // 2. Preload AI model early (downloads in background during call setup)
      //    so it's ready the moment a critical fallback is triggered
      this._speechEngine.setStream(stream);
      this._speechEngine.preloadModel();
      this._ui.log('⏳ Whisper AI model loading in background…');

      // 3. Init signaling & peer connection
      this._signaling.init(role);
      await this._peerConn.init(stream);

      // 4. Wire remote stream
      this._peerConn.onRemoteStream = (remoteStream) => {
        this._ui.setRemoteStream(remoteStream);
        this._ui.log('✓ Remote stream connected.');
        this._ui.setPhase('connected');
        this._startStatsMonitor();
      };

      // 5. Wire connection state callbacks
      this._peerConn.onConnectionStateChange = (state) => {
        this._ui.setConnectionState(state);
        if (state === 'disconnected' || state === 'failed') {
          this._ui.log('⚠ Peer connection lost.');
        }
        if (state === 'closed') this.endCall();
      };
      this._peerConn.onIceStateChange = (state) => this._ui.setIceState(state);

      // 6. DataChannel negotiation
      if (role === 'caller') {
        this._dataChannel.create(this._peerConn.pc);
        this._signaling.send('ready', {});
        this._ui.log('Waiting for callee to join…');

        this._signaling.addEventListener('peer-ready', async () => {
          this._ui.log('✓ Callee ready — creating offer…');
          await this._peerConn.createOffer();
          this._ui.log('✓ Offer sent — awaiting answer…');
        }, { once: true });

      } else {
        this._peerConn.onDataChannel = (ch) => {
          this._dataChannel.attach(ch);
          this._ui.log('✓ DataChannel connected.');
        };
        this._signaling.send('ready', {});
        this._ui.log('✓ Ready — waiting for offer…');
      }

    } catch (err) {
      console.error('[App] Call setup failed:', err);
      this._ui.log(`✗ Error: ${err.message}`);
      this._ui.setPhase('idle');
      this._inCall = false;
    }
  }

  // ── Stats Monitor ───────────────────────────────────────────────────────────

  _startStatsMonitor() {
    this._statsMonitor = this._peerConn.startStatsMonitor();

    this._statsMonitor.addEventListener('stats-update', (e) => {
      this._ui.updateStats(e.detail);
    });

    this._statsMonitor.addEventListener('state-change', (e) => {
      const { from, to } = e.detail;
      this._networkState = to;
      this._ui.log(`[Network] ${from.toUpperCase()} → ${to.toUpperCase()}`);
      this._applyNetworkState(to, from);
    });
  }

  // ── Network State Machine ───────────────────────────────────────────────────

  async _applyNetworkState(newState, prevState) {
    const pc = this._peerConn;

    switch (newState) {

      case 'good':
        if (prevState === 'critical') {
          this._ui.log('📶 Network recovered — restoring full A/V…');
          pc.setVideoEnabled(true);
          pc.setAudioEnabled(true);
          this._speechEngine.stop();
          this._ui.hideCaptionOverlay();
          this._captionBuffer = '';
        } else if (prevState === 'degraded') {
          this._ui.log('📶 Network stable — restoring video…');
          pc.setVideoEnabled(true);
        }
        this._ui.setNetworkMode('good');
        break;

      case 'degraded':
        this._ui.log('⚠ Bandwidth low — switching to audio-only…');
        pc.setVideoEnabled(false);
        if (prevState === 'critical') {
          pc.setAudioEnabled(true);
          this._speechEngine.stop();
          this._ui.hideCaptionOverlay();
        }
        this._ui.setNetworkMode('degraded');
        break;

      case 'critical':
        this._ui.log('🚨 CRITICAL — activating DataChannel caption fallback…');
        pc.setVideoEnabled(false);
        pc.setAudioEnabled(false);

        // Notify remote peer so they can show the caption overlay
        this._dataChannel.sendStatus('CRITICAL_FALLBACK');

        this._speechEngine.start();
        this._ui.showCaptionOverlay();
        this._ui.setNetworkMode('critical');
        this._ui.log('💬 Live captions active — voice is being transcribed.');
        break;
    }
  }

  // ── Simulation ──────────────────────────────────────────────────────────────

  simulateNetworkState(state) {
    if (!this._inCall) {
      this._ui.log('⚠ Start a call first to simulate network states.');
      return;
    }
    const prev = this._networkState;
    this._networkState = state;
    this._ui.log(`🧪 SIMULATING → ${state.toUpperCase()}`);
    this._applyNetworkState(state, prev);
    if (this._statsMonitor) this._statsMonitor._currentState = state;
  }

  // ── End Call ────────────────────────────────────────────────────────────────

  endCall() {
    if (!this._inCall) return;
    this._speechEngine.stop();
    this._dataChannel.destroy();
    this._peerConn.close();
    this._signaling.destroy();

    this._inCall       = false;
    this._networkState = 'good';
    this._captionBuffer = '';

    this._ui.hideCaptionOverlay();
    this._ui.setNetworkMode('good');
    this._ui.setPhase('idle');
    this._ui.resetRemotePanel();
    this._ui.log('📴 Call ended.');
  }

  get role()         { return this._role;         }
  get inCall()       { return this._inCall;        }
  get networkState() { return this._networkState;  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI Controller
// ─────────────────────────────────────────────────────────────────────────────

class VRescuerUI {
  constructor(app) {
    this._app           = app;
    this._remoteCaption = '';
    this._timerInterval = null;
    this._callStart     = null;
    this._adminBridge   = new VRescuerAdminBridge();
    this._initElements();
    this._bindButtons();
  }

  _initElements() {
    this.localVideo     = document.getElementById('video-local');
    this.remoteVideo    = document.getElementById('video-remote');
    this.captionBox     = document.getElementById('caption-overlay');
    this.captionText    = document.getElementById('caption-text');
    this.localCaption   = document.getElementById('local-caption');
    this.logPanel       = null;         // not on call page — admin only
    this.modeEl         = document.getElementById('network-badge');
    this.callTimer      = document.getElementById('call-timer');
    this.aiStatusEl     = null;         // admin page only
    this.modelProgressEl     = null;
    this.modelProgressWrap   = null;
  }

  _bindButtons() {
    document.getElementById('btn-caller')?.addEventListener('click', () => this._app.startCall('caller'));
    document.getElementById('btn-callee')?.addEventListener('click', () => this._app.startCall('callee'));
    document.getElementById('btn-end')?.addEventListener('click',   () => this._app.endCall());
  }

  // ── Stream Setters ──────────────────────────────────────────────────────────

  setLocalStream(stream) {
    if (this.localVideo) this.localVideo.srcObject = stream;
  }

  setRemoteStream(stream) {
    if (this.remoteVideo) {
      this.remoteVideo.srcObject = stream;
      this.remoteVideo.style.display = 'block';
    }
    const ph = document.getElementById('remote-placeholder');
    if (ph) ph.style.display = 'none';
    const panel = document.getElementById('remote-panel');
    if (panel) panel.setAttribute('data-state', 'connected');
  }

  resetRemotePanel() {
    if (this.remoteVideo) { this.remoteVideo.srcObject = null; this.remoteVideo.style.display = 'none'; }
    const ph = document.getElementById('remote-placeholder');
    if (ph) ph.style.display = '';
    const panel = document.getElementById('remote-panel');
    if (panel) panel.setAttribute('data-state', 'idle');
    const txt = document.getElementById('ph-text');
    if (txt) txt.textContent = 'Waiting for peer to join…';
  }

  // ── Phase & Timer ───────────────────────────────────────────────────────────

  setPhase(phase) {
    document.body.setAttribute('data-phase', phase);
    this._adminBridge.sendPhase(phase);

    const isIdle = phase === 'idle';
    document.getElementById('btn-caller')?.toggleAttribute('disabled', !isIdle);
    document.getElementById('btn-callee')?.toggleAttribute('disabled', !isIdle);
    document.getElementById('btn-end')?.toggleAttribute('disabled', isIdle);

    if (phase === 'connected') {
      this._callStart = performance.now();
      this._timerInterval = setInterval(() => {
        const s = Math.floor((performance.now() - this._callStart) / 1000);
        if (this.callTimer) {
          this.callTimer.textContent =
            `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
        }
      }, 1000);
    } else if (phase === 'idle') {
      clearInterval(this._timerInterval);
      if (this.callTimer) this.callTimer.textContent = '00:00';
    }

    // Update placeholder text during connecting
    const txt = document.getElementById('ph-text');
    if (txt) {
      txt.textContent = phase === 'connecting' ? 'Connecting…' : 'Waiting for peer to join…';
    }
  }

  // ── Network Mode Badge ──────────────────────────────────────────────────────

  setNetworkMode(mode) {
    if (this.modeEl) {
      this.modeEl.setAttribute('data-mode', mode);
      this.modeEl.textContent = { good: 'Healthy', degraded: 'Audio Only', critical: 'Captions' }[mode] ?? mode;
    }
    this._adminBridge.sendStateChange(this._app.networkState, mode);
  }

  // ── Captions ────────────────────────────────────────────────────────────────

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
    const final   = this._remoteCaption ? `<span class="caption-final">${this._remoteCaption}</span>` : '';
    const interim = interimText ? `<span class="caption-interim">${interimText}</span>` : '';
    this.captionText.innerHTML = final + interim;
    this.captionText.scrollTop = this.captionText.scrollHeight;
  }

  appendRemoteCaption(text) {
    this._remoteCaption += text + ' ';
    this.updateRemoteCaption(null, '');
  }

  updateLocalCaption(finalText, interimText, source) {
    if (!this.localCaption) return;
    const tag  = source === 'ai' ? '🤖' : '🎤';
    const parts = [];
    if (finalText)   parts.push(`<span class="lc-final">${finalText}</span>`);
    if (interimText) parts.push(`<span class="lc-interim">${interimText}…</span>`);
    this.localCaption.innerHTML = parts.length ? `${tag} ${parts.join('')}` : `${tag} Listening…`;
    this.localCaption.style.opacity = '1';
    // Update caption source tag
    const src = document.getElementById('caption-source-tag');
    if (src) src.textContent = source === 'ai' ? 'Whisper AI · DataChannel' : 'Native STT · DataChannel';
  }

  // ── Connection Status ───────────────────────────────────────────────────────
  // These go to admin bridge only (no elements on call page)

  setConnectionState(state) {
    this._adminBridge.sendLog(`[ICE] Connection state → ${state}`);
  }

  setIceState(state) {
    this._adminBridge.sendLog(`[ICE] ICE state → ${state}`);
  }

  setDataChannelStatus(open) {
    this._adminBridge.sendDCStats({ open, ts: Date.now() });
  }

  // ── AI Model Status ─────────────────────────────────────────────────────────

  setModelStatus(detail) {
    this._adminBridge.sendAIStatus(detail);
  }

  setAIStatus(text) {
    this._adminBridge.sendLog(`[AI] ${text}`);
  }

  // ── Live Stats → Admin Bridge ───────────────────────────────────────────────

  updateStats(stats) {
    this._adminBridge.sendStats(stats);
  }

  // ── Activity Log → Admin Bridge ─────────────────────────────────────────────

  log(message) {
    this._adminBridge.sendLog(message);
    console.log(`[V-Rescuer] ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  window.vRescuer = new VRescuerApp();
  console.log('[V-Rescuer] v2 initialized. Open two tabs → Tab 1: Caller · Tab 2: Callee.');
});
