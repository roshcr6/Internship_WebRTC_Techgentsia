/**
 * V-Rescuer — Main Application Orchestrator
 * ─────────────────────────────────────────────
 * Ties together:
 *   Signaling ↔ PeerConnection ↔ DataChannel ↔ StatsMonitor ↔ SpeechEngine ↔ UI
 *
 * Network State Machine:
 *   good  →  degraded  →  critical
 *              ↑               ↑
 *              └───────────────┘  (recovery after 10s stable)
 */

class VRescuerApp {
  constructor() {
    // Core modules
    this._signaling = new VRescuerSignaling();
    this._peerConn = new VRescuerPeerConnection(this._signaling);
    this._dataChannel = new VRescuerDataChannel();
    this._speechEngine = new VRescuerSpeechEngine();
    this._statsMonitor = null;

    // State
    this._role = null;          // 'caller' | 'callee'
    this._networkState = 'good';
    this._inCall = false;
    this._captionBuffer = '';   // Accumulates final transcripts
    this._interimBuffer = '';   // Current interim text

    // ─── Bind UI update method ────────────────────────────────────────────
    this._ui = new VRescuerUI(this);

    // ─── Speech → DataChannel bridge ─────────────────────────────────────
    this._speechEngine.addEventListener('interim', (e) => {
      if (this._networkState !== 'critical') return;
      this._interimBuffer = e.detail.text;
      this._dataChannel.sendInterim(e.detail.text);
      this._ui.updateLocalCaption(this._captionBuffer, this._interimBuffer);
    });

    this._speechEngine.addEventListener('final', (e) => {
      if (this._networkState !== 'critical') return;
      this._captionBuffer += e.detail.text + ' ';
      this._interimBuffer = '';
      this._dataChannel.sendFinal(e.detail.text);
      this._ui.updateLocalCaption(this._captionBuffer, '');
    });

    // ─── DataChannel → Remote caption display ────────────────────────────
    this._dataChannel.addEventListener('message', (e) => {
      const msg = e.detail;
      if (msg.type === 'interim') {
        this._ui.updateRemoteCaption(null, msg.text);
      } else if (msg.type === 'final') {
        this._ui.appendRemoteCaption(msg.text);
      }
    });

    this._dataChannel.addEventListener('open', () => {
      this._ui.setDataChannelStatus(true);
    });
    this._dataChannel.addEventListener('close', () => {
      this._ui.setDataChannelStatus(false);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CALL SETUP
  // ─────────────────────────────────────────────────────────────────────────

  async startCall(role) {
    if (this._inCall) return;
    this._role = role;
    this._inCall = true;

    this._ui.setPhase('connecting');
    this._ui.log(`Initializing as ${role === 'caller' ? '📡 Caller' : '📻 Callee'}...`);

    try {
      // 1. Get local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: 30 },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this._ui.setLocalStream(stream);
      this._ui.log('✓ Camera & microphone acquired.');

      // 2. Init signaling
      this._signaling.init(role);

      // 3. Init peer connection
      await this._peerConn.init(stream);

      // 4. Wire remote stream
      this._peerConn.onRemoteStream = (remoteStream) => {
        this._ui.setRemoteStream(remoteStream);
        this._ui.log('✓ Remote stream connected.');
        this._ui.setPhase('connected');
        this._startStatsMonitor();
      };

      // 5. Wire connection state
      this._peerConn.onConnectionStateChange = (state) => {
        this._ui.setConnectionState(state);
        if (state === 'disconnected' || state === 'failed') {
          this._ui.log('⚠ Peer disconnected.');
        }
        if (state === 'closed') {
          this.endCall();
        }
      };
      this._peerConn.onIceStateChange = (state) => {
        this._ui.setIceState(state);
      };

      // 6. DataChannel setup
      if (role === 'caller') {
        // Caller creates the DataChannel before the offer
        const ch = this._dataChannel.create(this._peerConn.pc);
        this._ui.log('✓ DataChannel created.');

        // Signal readiness, then offer
        this._signaling.send('ready', {});
        this._ui.log('Waiting for callee to join...');

        this._signaling.addEventListener('peer-ready', async () => {
          this._ui.log('✓ Callee is ready. Creating offer...');
          await this._peerConn.createOffer();
          this._ui.log('✓ Offer sent — waiting for answer...');
        });

      } else {
        // Callee: receive DataChannel via ondatachannel
        this._peerConn.onDataChannel = (ch) => {
          this._dataChannel.attach(ch);
          this._ui.log('✓ DataChannel connected.');
        };

        // Signal readiness so caller starts negotiation
        this._signaling.send('ready', {});
        this._ui.log('✓ Ready. Waiting for offer from caller...');
      }

    } catch (err) {
      console.error('[App] Call setup failed:', err);
      this._ui.log(`✗ Error: ${err.message}`);
      this._ui.setPhase('idle');
      this._inCall = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  STATS MONITOR & NETWORK STATE MACHINE
  // ─────────────────────────────────────────────────────────────────────────

  _startStatsMonitor() {
    this._statsMonitor = this._peerConn.startStatsMonitor();

    this._statsMonitor.addEventListener('stats-update', (e) => {
      this._ui.updateStats(e.detail);
    });

    this._statsMonitor.addEventListener('state-change', (e) => {
      const { from, to } = e.detail;
      this._networkState = to;
      console.log(`[App] Network state: ${from} → ${to}`);
      this._applyNetworkState(to, from);
    });
  }

  /** Central state transition handler — the core fallback logic */
  async _applyNetworkState(newState, prevState) {
    const pc = this._peerConn;

    switch (newState) {

      // ── GOOD: Full A/V restored ──────────────────────────────────────────
      case 'good':
        if (prevState === 'critical') {
          this._ui.log('📶 Network recovered. Restoring full A/V...');
          pc.setVideoEnabled(true);
          pc.setAudioEnabled(true);
          this._speechEngine.stop();
          this._ui.hideCaptionOverlay();
          this._ui.setNetworkMode('good');
          this._captionBuffer = '';
        } else if (prevState === 'degraded') {
          this._ui.log('📶 Network stabilized. Restoring video...');
          pc.setVideoEnabled(true);
          this._ui.setNetworkMode('good');
        }
        break;

      // ── DEGRADED: Audio only ─────────────────────────────────────────────
      case 'degraded':
        this._ui.log('⚠ Network degraded. Switching to audio-only mode...');
        pc.setVideoEnabled(false);
        if (prevState === 'critical') {
          pc.setAudioEnabled(true);
          this._speechEngine.stop();
          this._ui.hideCaptionOverlay();
        }
        this._ui.setNetworkMode('degraded');
        break;

      // ── CRITICAL: Full fallback — kill media, start captions ────────────
      case 'critical':
        this._ui.log('🚨 CRITICAL: Bandwidth < 15 kbps. Activating DataChannel fallback...');

        // Kill both media streams to free bandwidth
        pc.setVideoEnabled(false);
        pc.setAudioEnabled(false);

        // Activate speech-to-text → DataChannel captions
        this._speechEngine.start();
        this._ui.showCaptionOverlay();
        this._ui.setNetworkMode('critical');

        this._ui.log('💬 DataChannel captions are LIVE. Voice is being transcribed.');
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MANUAL SIMULATION (for demo/testing)
  // ─────────────────────────────────────────────────────────────────────────

  simulateNetworkState(state) {
    if (!this._inCall) {
      this._ui.log('⚠ Start a call first to simulate network states.');
      return;
    }
    const prevState = this._networkState;
    this._networkState = state;
    this._ui.log(`🧪 SIMULATING: Network → ${state.toUpperCase()}`);
    this._applyNetworkState(state, prevState);
    if (this._statsMonitor) {
      this._statsMonitor._currentState = state; // sync monitor state
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  END CALL
  // ─────────────────────────────────────────────────────────────────────────

  endCall() {
    if (!this._inCall) return;
    this._signaling.send('bye', {});
    this._speechEngine.stop();
    this._dataChannel.destroy();
    this._peerConn.close();
    this._signaling.destroy();
    this._inCall = false;
    this._networkState = 'good';
    this._captionBuffer = '';
    this._ui.setPhase('idle');
    this._ui.hideCaptionOverlay();
    this._ui.setNetworkMode('good');
    // Reset remote panel to idle state
    const remotePanel = document.getElementById('remote-panel');
    if (remotePanel) remotePanel.setAttribute('data-state', 'idle');
    const remotePlaceholder = document.getElementById('remote-placeholder');
    if (remotePlaceholder) remotePlaceholder.style.display = '';
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = 'none'; }
    this._ui.log('📴 Call ended.');
    console.log('[App] Call ended.');
  }

  get role() { return this._role; }
  get inCall() { return this._inCall; }
  get networkState() { return this._networkState; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI CONTROLLER  (keeps app logic clean)
// ─────────────────────────────────────────────────────────────────────────────

class VRescuerUI {
  constructor(app) {
    this._app = app;
    this._remoteCaption = '';     // accumulated remote caption text
    this._statsHistory = [];      // for sparkline
    this._initElements();
    this._bindButtons();
  }

  _initElements() {
    this.localVideo    = document.getElementById('local-video');
    this.remoteVideo   = document.getElementById('remote-video');
    this.captionBox    = document.getElementById('caption-overlay');
    this.captionText   = document.getElementById('caption-text');
    this.localCaption  = document.getElementById('local-caption');
    this.logPanel      = document.getElementById('log-panel');
    this.bitrateEl     = document.getElementById('stat-bitrate');
    this.packetLossEl  = document.getElementById('stat-packetloss');
    this.rttEl         = document.getElementById('stat-rtt');
    this.modeEl        = document.getElementById('network-mode-badge');
    this.connStateEl   = document.getElementById('connection-state');
    this.iceStateEl    = document.getElementById('ice-state');
    this.dcStateEl     = document.getElementById('dc-state');
    this.bitrateBar    = document.getElementById('bitrate-bar');
    this.bitrateBarFill= document.getElementById('bitrate-bar-fill');
    this.callTimer     = document.getElementById('call-timer');
    this._timerInterval= null;
    this._callStart    = null;
  }

  _bindButtons() {
    document.getElementById('btn-caller').addEventListener('click', () =>
      this._app.startCall('caller'));
    document.getElementById('btn-callee').addEventListener('click', () =>
      this._app.startCall('callee'));
    document.getElementById('btn-end').addEventListener('click', () =>
      this._app.endCall());

    // Simulation buttons
    document.getElementById('sim-good').addEventListener('click', () =>
      this._app.simulateNetworkState('good'));
    document.getElementById('sim-degraded').addEventListener('click', () =>
      this._app.simulateNetworkState('degraded'));
    document.getElementById('sim-critical').addEventListener('click', () =>
      this._app.simulateNetworkState('critical'));
  }

  setLocalStream(stream) {
    this.localVideo.srcObject = stream;
  }

  setRemoteStream(stream) {
    this.remoteVideo.srcObject = stream;
    document.getElementById('remote-placeholder').style.display = 'none';
    this.remoteVideo.style.display = 'block';
    // Mark remote panel as connected so green dot lights up
    document.getElementById('remote-panel').setAttribute('data-state', 'connected');
  }

  setPhase(phase) {
    document.body.setAttribute('data-phase', phase);

    // Timer
    if (phase === 'connected') {
      this._callStart = Date.now();
      this._timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this._callStart) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        this.callTimer.textContent = `${m}:${s}`;
      }, 1000);
    } else if (phase === 'idle') {
      clearInterval(this._timerInterval);
      this.callTimer.textContent = '00:00';
    }

    // Button states
    const isIdle = phase === 'idle';
    document.getElementById('btn-caller').disabled = !isIdle;
    document.getElementById('btn-callee').disabled = !isIdle;
    document.getElementById('btn-end').disabled = isIdle;
  }

  setNetworkMode(mode) {
    const badge = this.modeEl;
    badge.setAttribute('data-mode', mode);
    // CSS ::before handles the dot — just set text without emoji prefix
    const labels = {
      good:     'Network: Healthy',
      degraded: 'Audio Only Mode',
      critical: 'DataChannel Fallback',
    };
    badge.textContent = labels[mode] || mode;

    // Map network mode to remote-panel data-state for CSS effects
    const remotePanel = document.getElementById('remote-panel');
    if (mode === 'good') {
      // Only set 'connected' if we actually have a remote stream
      const remoteVideo = document.getElementById('remote-video');
      const panelState = remoteVideo.srcObject ? 'connected' : 'idle';
      remotePanel.setAttribute('data-state', panelState);
      if (remoteVideo.srcObject) {
        document.getElementById('remote-placeholder').style.display = 'none';
      }
    } else {
      remotePanel.setAttribute('data-state', mode); // 'degraded' | 'critical'
    }
  }

  showCaptionOverlay() {
    this.captionBox.classList.add('active');
    this._remoteCaption = '';
    // Clear text — the caption-header-bar is already in HTML, just clear text area
    this.captionText.innerHTML = '';
  }

  hideCaptionOverlay() {
    this.captionBox.classList.remove('active');
  }

  updateRemoteCaption(finalText, interimText) {
    const final  = this._remoteCaption
      ? `<span class="caption-final">${this._remoteCaption}</span>`
      : '';
    const interim = interimText
      ? `<span class="caption-interim">${interimText}</span>`
      : '';
    this.captionText.innerHTML = final + interim;
    this.captionText.scrollTop = this.captionText.scrollHeight;
  }

  appendRemoteCaption(text) {
    this._remoteCaption += text + ' ';
    this.updateRemoteCaption(null, '');
  }

  updateLocalCaption(finalText, interimText) {
    const parts = [];
    if (finalText) parts.push(`<span class="lc-final">${finalText}</span>`);
    if (interimText) parts.push(`<span class="lc-interim">${interimText}…</span>`);
    this.localCaption.innerHTML = parts.length
      ? `🎤 ${parts.join('')}`
      : '🎤 Listening…';
    this.localCaption.style.opacity = '1';
  }

  setConnectionState(state) {
    this.connStateEl.textContent = state;
    this.connStateEl.setAttribute('data-state', state);
  }

  setIceState(state) {
    this.iceStateEl.textContent = state;
  }

  setDataChannelStatus(open) {
    this.dcStateEl.textContent = open ? 'open' : 'closed';
    this.dcStateEl.setAttribute('data-open', open);
  }

  updateStats(stats) {
    const { bitrateBps, packetLossRatio, roundTripTime } = stats;
    const kbps = (bitrateBps / 1000).toFixed(1);
    this.bitrateEl.textContent = `${kbps} kbps`;
    this.packetLossEl.textContent = `${(packetLossRatio * 100).toFixed(1)}%`;
    this.rttEl.textContent = `${Math.round(roundTripTime)} ms`;

    // Color the bitrate stat by threshold — skip coloring if no data yet (bps=0)
    const threshold = VRescuerConfig.BITRATE_THRESHOLD_FULL_FALLBACK;
    const audioThreshold = VRescuerConfig.BITRATE_THRESHOLD_AUDIO_ONLY;
    if (bitrateBps === 0) {
      this.bitrateEl.setAttribute('data-level', '');
    } else if (bitrateBps < threshold) {
      this.bitrateEl.setAttribute('data-level', 'critical');
    } else if (bitrateBps < audioThreshold) {
      this.bitrateEl.setAttribute('data-level', 'degraded');
    } else {
      this.bitrateEl.setAttribute('data-level', 'good');
    }

    // Bitrate bar (max 2 Mbps for display)
    const pct = Math.min(100, (bitrateBps / 2_000_000) * 100);
    this.bitrateBarFill.style.width = `${pct}%`;
    if (window._updateBitrateLabel) window._updateBitrateLabel(bitrateBps);
    this.bitrateBarFill.style.background = bitrateBps < threshold
      ? 'var(--color-critical)'
      : bitrateBps < audioThreshold
        ? 'var(--color-warning)'
        : 'var(--color-success)';
  }

  log(message) {
    const ts = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg">${message}</span>`;
    this.logPanel.appendChild(entry);
    this.logPanel.scrollTop = this.logPanel.scrollHeight;
    console.log(`[UI Log] ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  window.vRescuer = new VRescuerApp();
  console.log('[V-Rescuer] Application initialized. Open two tabs and click Caller / Callee.');
});
