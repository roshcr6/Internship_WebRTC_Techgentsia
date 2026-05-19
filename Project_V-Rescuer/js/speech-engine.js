/**
 * V-Rescuer Speech Engine
 * ────────────────────────
 * Wraps the browser's native Web Speech API (SpeechRecognition).
 * Emits:
 *   - 'interim' → { text } — partial recognized text (update in-place)
 *   - 'final'   → { text } — committed word(s), send over DataChannel
 *   - 'error'   → { message }
 *   - 'stopped' → engine stopped
 */

class VRescuerSpeechEngine extends EventTarget {
  constructor() {
    super();
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[SpeechEngine] Web Speech API not supported in this browser.');
      this._supported = false;
      return;
    }
    this._supported = true;
    this._recognition = new SpeechRecognition();
    this._isActive = false;
    this._configureRecognition();
  }

  _configureRecognition() {
    const r = this._recognition;
    const cfg = VRescuerConfig;

    r.lang = cfg.SPEECH_LANGUAGE;
    r.interimResults = cfg.SPEECH_INTERIM_RESULTS;
    r.maxAlternatives = cfg.SPEECH_MAX_ALTERNATIVES;
    r.continuous = true; // keep listening without restart

    r.onstart = () => {
      this._isActive = true;
      console.log('[SpeechEngine] Listening...');
    };

    r.onresult = (event) => {
      let interimText = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (interimText) {
        this._emit('interim', { text: interimText });
      }
      if (finalText) {
        this._emit('final', { text: finalText.trim() });
      }
    };

    r.onerror = (event) => {
      // 'no-speech' is not critical — just silence
      if (event.error === 'no-speech') return;
      console.error('[SpeechEngine] Error:', event.error);
      this._emit('error', { message: event.error });
    };

    r.onend = () => {
      // Auto-restart if we didn't intentionally stop
      if (this._isActive) {
        console.log('[SpeechEngine] Auto-restarting...');
        try { r.start(); } catch (e) { /* already started */ }
      } else {
        this._emit('stopped', {});
      }
    };
  }

  /** Begin speech recognition */
  start() {
    if (!this._supported) return;
    if (this._isActive) return;
    this._isActive = true;
    try {
      this._recognition.start();
      console.log('[SpeechEngine] Started.');
    } catch (e) {
      console.warn('[SpeechEngine] Start error:', e);
    }
  }

  /** Stop speech recognition */
  stop() {
    if (!this._supported) return;
    this._isActive = false;
    try {
      this._recognition.stop();
      console.log('[SpeechEngine] Stopped.');
    } catch (e) { /* ignore */ }
  }

  get isSupported() { return this._supported; }
  get isActive() { return this._isActive; }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

window.VRescuerSpeechEngine = VRescuerSpeechEngine;
