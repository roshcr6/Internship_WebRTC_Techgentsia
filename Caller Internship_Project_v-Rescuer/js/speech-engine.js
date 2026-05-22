/**
 * V-Rescuer AI Speech Engine v3
 * ────────────────────────────────
 * 3-Tier transcription with automatic fallback:
 *
 * Tier 1 (AI)     → Whisper tiny.en via ONNX Web Worker (offline after first download)
 * Tier 2 (Native) → Web Speech API (instant start, needs internet)
 * Tier 3 (None)   → Emits 'unavailable'
 *
 * FIX v3:
 *   - Worker URL now uses relative path (was absolute, broke in subdirs)
 *   - Worker onerror now falls back to native gracefully without crashing
 *   - Added 'status' emit when model becomes unavailable
 *
 * Events:
 *   'interim'     → { text, source:'ai'|'native' }
 *   'final'       → { text, source, inferenceMs }
 *   'status'      → { state, progress, message }
 *   'error'       → { message }
 */

class VRescuerSpeechEngine extends EventTarget {
  constructor() {
    super();

    // AI tier
    this._worker       = null;
    this._modelReady   = false;
    this._modelLoading = false;
    this._requestSeq   = 0;

    // Audio capture
    this._mediaStream     = null;
    this._recorder        = null;
    this._chunkQueue      = [];
    this._processingChunk = false;
    this._decodeCtx       = null;

    // Native fallback
    this._recognition   = null;
    this._nativeSupport = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    // State
    this._isActive = false;
    this._source   = 'none';

    this._initWorker();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  preloadModel() {
    if (this._modelReady || this._modelLoading || !this._worker) return;
    this._modelLoading = true;
    this._worker.postMessage({ type: 'load', modelId: VRescuerConfig.AI_MODEL_ID });
    this._emit('status', { state: 'loading', progress: 0, message: 'Loading AI transcription model…' });
  }

  setStream(stream) {
    this._mediaStream = stream;
  }

  start() {
    if (this._isActive) return;
    this._isActive = true;
    if (this._modelReady) {
      this._startAIMode();
    } else {
      if (this._nativeSupport) this._startNativeMode();
      // AI will take over once ready via _onWorkerMessage → 'ready'
    }
  }

  stop() {
    this._isActive = false;
    this._stopAIMode();
    this._stopNativeMode();
    this._source = 'none';
  }

  get modelReady() { return this._modelReady; }
  get isActive()   { return this._isActive;   }
  get source()     { return this._source;     }

  // ── Worker Init ──────────────────────────────────────────────────────────

  _initWorker() {
    try {
      // FIX: Use relative URL so it works from any path depth.
      // document.currentScript won't work in deferred/module context; compute from location.
      const base      = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
      const workerUrl = `${base}js/workers/whisper-worker.js`;
      this._worker = new Worker(workerUrl, { type: 'module' });
      this._worker.onmessage = (e) => this._onWorkerMessage(e.data);
      this._worker.onerror   = (e) => {
        console.error('[SpeechEngine] Worker error:', e.message ?? e);
        this._emit('status', { state: 'error', progress: 0, message: 'AI worker failed — using native STT only.' });
        this._worker      = null;
        this._modelReady  = false;
        // If we were waiting, fall back to native now
        if (this._isActive && this._nativeSupport && !this._recognition) {
          this._startNativeMode();
        }
      };
      console.log('[SpeechEngine] Worker created from:', workerUrl);
    } catch (e) {
      console.warn('[SpeechEngine] Module worker not supported:', e);
      this._worker = null;
    }
  }

  _onWorkerMessage(msg) {
    switch (msg.type) {

      case 'loading_progress':
        this._emit('status', {
          state:    'loading',
          progress: msg.progress,
          message:  `AI Model: ${msg.file ? msg.file.split('/').pop() : msg.status} (${msg.progress}%)`,
        });
        break;

      case 'ready':
        this._modelReady   = true;
        this._modelLoading = false;
        this._emit('status', { state: 'ready', progress: 100, message: '✓ Whisper AI ready — offline capable' });
        // Upgrade from native → AI if active
        if (this._isActive && this._mediaStream) {
          this._stopNativeMode();
          this._startAIMode();
        }
        break;

      case 'result':
        if (!this._isActive || !msg.text) break;
        this._emit('final', { text: msg.text, source: 'ai', inferenceMs: msg.inferenceMs ?? 0 });
        break;

      case 'error':
        console.error('[SpeechEngine] Worker inference error:', msg.message);
        this._emit('error', { message: msg.message });
        break;
    }

    this._processingChunk = false;
    this._processNextChunk();
  }

  // ── AI Mode ───────────────────────────────────────────────────────────────

  _startAIMode() {
    if (!this._worker || !this._modelReady || !this._mediaStream) return;
    this._source     = 'ai';
    this._chunkQueue = [];
    this._emit('status', { state: 'active', message: '🤖 Whisper AI transcribing…' });

    const audioOnlyStream = new MediaStream(this._mediaStream.getAudioTracks());
    this._recorder = new MediaRecorder(audioOnlyStream, {
      mimeType:            this._getSupportedMime(),
      audioBitsPerSecond:  16000,
    });
    this._recorder.ondataavailable = (e) => {
      if (e.data?.size > 100) {
        this._chunkQueue.push(e.data);
        const maxQueue = VRescuerConfig.AI_MAX_QUEUE ?? 3;
        if (this._chunkQueue.length > maxQueue) this._chunkQueue.shift();
        this._processNextChunk();
      }
    };
    this._recorder.start(VRescuerConfig.AI_CHUNK_MS);
    console.log('[SpeechEngine] AI mode started.');
  }

  _stopAIMode() {
    try { this._recorder?.stop(); }   catch (e) { /* ignore */ }
    this._recorder    = null;
    this._chunkQueue  = [];
    try { this._decodeCtx?.close(); } catch (e) { /* ignore */ }
    this._decodeCtx = null;
  }

  async _processNextChunk() {
    if (this._processingChunk || !this._chunkQueue.length) return;
    if (!this._worker || !this._modelReady || !this._isActive) return;

    this._processingChunk = true;
    const blob = this._chunkQueue.shift();
    try {
      const arrayBuf = await blob.arrayBuffer();
      if (!this._decodeCtx) this._decodeCtx = new AudioContext({ sampleRate: 16000 });
      const audioBuf = await this._decodeCtx.decodeAudioData(arrayBuf);
      const float32     = audioBuf.getChannelData(0);
      const transferable = float32.buffer.slice(0);
      this._worker.postMessage(
        { type: 'transcribe', id: ++this._requestSeq, audio: new Float32Array(transferable), sampleRate: 16000 },
        [transferable],
      );
    } catch (err) {
      console.warn('[SpeechEngine] Chunk decode failed:', err);
      this._processingChunk = false;
      this._processNextChunk();
    }
  }

  _getSupportedMime() {
    return ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  // ── Native Mode ───────────────────────────────────────────────────────────

  _startNativeMode() {
    if (!this._nativeSupport || this._recognition) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r  = new SR();
    this._recognition = r;
    this._source      = 'native';

    r.lang            = VRescuerConfig.SPEECH_LANGUAGE;
    r.interimResults  = true;
    r.maxAlternatives = 1;
    r.continuous      = true;

    r.onresult = (event) => {
      if (this._source === 'ai') return; // AI has taken over
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text   = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          this._emit('final',   { text, source: 'native', inferenceMs: 0 });
        } else {
          this._emit('interim', { text, source: 'native' });
        }
      }
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[SpeechEngine] Native error:', e.error);
    };

    r.onend = () => {
      if (this._isActive && this._source === 'native') {
        try { r.start(); } catch (e) { /* already started */ }
      }
    };

    try   { r.start(); }
    catch (e) { /* ignore */ }
    this._emit('status', { state: 'active', message: '🎤 Native speech recognition active…' });
    console.log('[SpeechEngine] Native mode started.');
  }

  _stopNativeMode() {
    if (!this._recognition) return;
    try   { this._recognition.stop(); } catch (e) { /* ignore */ }
    this._recognition = null;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// Expose for non-module scripts (app.js is not a module).
window.VRescuerSpeechEngine = VRescuerSpeechEngine;

window.VRescuerSpeechEngine = VRescuerSpeechEngine;
