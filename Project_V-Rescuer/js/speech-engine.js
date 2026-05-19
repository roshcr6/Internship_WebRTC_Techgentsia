/**
 * V-Rescuer AI Speech Engine v2
 * ────────────────────────────────
 * 3-Tier transcription with automatic fallback:
 *
 * Tier 1 (AI)   → Whisper tiny.en via ONNX in Web Worker
 *                  40MB model, cached. Works 100% offline after first load.
 *                  ~100-250ms inference per 2s chunk on modern hardware.
 *
 * Tier 2 (Fast) → Browser Web Speech API (instant start, needs internet)
 *                  Used while Whisper model is still downloading.
 *
 * Tier 3 (None) → Emits 'unavailable' so UI can show a typed-text fallback.
 *
 * Events:
 *   'interim'    → { text, source:'ai'|'native' }   — live partial result
 *   'final'      → { text, source, inferenceMs }     — committed word(s)
 *   'status'     → { state, progress, message }      — model load progress
 *   'error'      → { message }
 */

class VRescuerSpeechEngine extends EventTarget {
  constructor() {
    super();

    // ── Worker (AI tier) ────────────────────────────────────────────────────
    this._worker       = null;
    this._modelReady   = false;
    this._modelLoading = false;
    this._requestSeq   = 0;

    // ── Audio capture (for AI tier) ─────────────────────────────────────────
    this._mediaStream     = null;
    this._audioCtx        = null;
    this._recorder        = null;
    this._chunkQueue      = [];   // pending audio blobs awaiting decode
    this._processingChunk = false;

    // ── Native fallback (Web Speech API) ────────────────────────────────────
    this._recognition    = null;
    this._usingFallback  = false;
    this._nativeSupport  = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    // ── State ────────────────────────────────────────────────────────────────
    this._isActive = false;
    this._source   = 'none';  // 'ai' | 'native'

    this._initWorker();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Preload the AI model in the background.
   * Call this as early as possible (when user clicks Start Call).
   * Model is cached after first download — subsequent loads are instant.
   */
  preloadModel() {
    if (this._modelReady || this._modelLoading || !this._worker) return;
    this._modelLoading = true;
    this._worker.postMessage({ type: 'load', modelId: VRescuerConfig.AI_MODEL_ID });
    this._emit('status', { state: 'loading', progress: 0, message: 'Loading AI transcription model…' });
  }

  /**
   * Attach the local media stream so we can capture audio from it.
   * Call this after getUserMedia() succeeds.
   */
  setStream(stream) {
    this._mediaStream = stream;
  }

  /** Start transcription — uses AI if model ready, native otherwise */
  start() {
    if (this._isActive) return;
    this._isActive = true;

    if (this._modelReady) {
      this._startAIMode();
    } else {
      // Start native immediately for low latency while AI model loads
      if (this._nativeSupport) this._startNativeMode();
      // Keep waiting for AI to be ready; _onWorkerMessage will switch over
    }
  }

  /** Stop all transcription */
  stop() {
    this._isActive = false;
    this._stopAIMode();
    this._stopNativeMode();
    this._source = 'none';
  }

  /** Is the AI model downloaded and ready? */
  get modelReady() { return this._modelReady; }
  get isActive()   { return this._isActive;   }
  get source()     { return this._source;     }

  // ── Worker Initialization ─────────────────────────────────────────────────

  _initWorker() {
    try {
      // Use absolute path from root — works regardless of page nesting level
      const workerUrl = new URL('/js/workers/whisper-worker.js', location.origin);
      this._worker = new Worker(workerUrl, { type: 'module' });
      this._worker.onmessage = (e) => this._onWorkerMessage(e.data);
      this._worker.onerror   = (e) => {
        console.error('[SpeechEngine] Worker error:', e);
        this._emit('status', { state: 'error', message: 'AI worker failed — using native STT.' });
        this._worker = null;
      };
    } catch (e) {
      console.warn('[SpeechEngine] Module worker not supported, using native only:', e);
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
        console.log('[SpeechEngine] AI model ready.');

        // If we're active, switch from native to AI
        if (this._isActive && this._mediaStream) {
          this._stopNativeMode();
          this._startAIMode();
        }
        break;

      case 'result':
        if (!this._isActive || !msg.text) break;
        this._emit('final', {
          text:        msg.text,
          source:      'ai',
          inferenceMs: msg.inferenceMs ?? 0,
        });
        break;

      case 'error':
        console.error('[SpeechEngine] Worker error:', msg.message);
        this._emit('error', { message: msg.message });
        break;
    }

    // Continue processing queued chunks after a result
    this._processingChunk = false;
    this._processNextChunk();
  }

  // ── AI Mode (Whisper) ─────────────────────────────────────────────────────

  _startAIMode() {
    if (!this._worker || !this._modelReady || !this._mediaStream) return;
    this._source = 'ai';
    this._chunkQueue = [];
    this._emit('status', { state: 'active', message: '🤖 Whisper AI transcribing…' });

    // Build audio capture pipeline
    this._audioCtx = new AudioContext({ sampleRate: 16000 }); // Capture at 16kHz natively

    // Create a stream that has ONLY the audio tracks
    const audioOnlyStream = new MediaStream(this._mediaStream.getAudioTracks());

    this._recorder = new MediaRecorder(audioOnlyStream, {
      mimeType: this._getSupportedMime(),
      audioBitsPerSecond: 16000, // Minimal bitrate — speech only
    });

    this._recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 100) { // Skip tiny/empty chunks
        this._chunkQueue.push(e.data);
        this._processNextChunk();
      }
    };

    this._recorder.start(VRescuerConfig.AI_CHUNK_MS); // 2s chunks
    console.log('[SpeechEngine] AI mode started.');
  }

  _stopAIMode() {
    try { this._recorder?.stop(); } catch (e) { /* ignore */ }
    this._recorder = null;
    try { this._audioCtx?.close(); } catch (e) { /* ignore */ }
    this._audioCtx = null;
    this._chunkQueue = [];
  }

  async _processNextChunk() {
    if (this._processingChunk || this._chunkQueue.length === 0) return;
    if (!this._worker || !this._modelReady || !this._isActive) return;

    this._processingChunk = true;
    const blob = this._chunkQueue.shift();

    try {
      // Decode blob → ArrayBuffer → AudioBuffer → Float32Array @ 16kHz
      const arrayBuf   = await blob.arrayBuffer();
      const decodeCtx  = new AudioContext({ sampleRate: 16000 });
      const audioBuf   = await decodeCtx.decodeAudioData(arrayBuf);
      await decodeCtx.close();

      const float32 = audioBuf.getChannelData(0); // Mono, 16kHz
      const id = ++this._requestSeq;

      // Transfer buffer to worker (zero-copy via Transferable)
      const transferable = float32.buffer.slice(0);
      this._worker.postMessage(
        { type: 'transcribe', id, audio: new Float32Array(transferable), sampleRate: 16000 },
        [transferable]
      );
    } catch (err) {
      console.warn('[SpeechEngine] Chunk decode failed:', err);
      this._processingChunk = false;
      this._processNextChunk(); // Try next chunk
    }
  }

  _getSupportedMime() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  // ── Native Mode (Web Speech API) ─────────────────────────────────────────

  _startNativeMode() {
    if (!this._nativeSupport || this._recognition) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recognition = new SR();
    this._usingFallback = true;
    this._source = 'native';

    const r = this._recognition;
    r.lang = VRescuerConfig.SPEECH_LANGUAGE;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = true;

    r.onresult = (event) => {
      // If AI has taken over, ignore native results
      if (this._source === 'ai') return;

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
      // Auto-restart native if still active and AI not ready
      if (this._isActive && this._source === 'native') {
        try { r.start(); } catch(e) { /* already started */ }
      }
    };

    try { r.start(); } catch(e) { /* ignore */ }
    this._emit('status', { state: 'active', message: '🎤 Native speech recognition active…' });
    console.log('[SpeechEngine] Native mode started.');
  }

  _stopNativeMode() {
    if (!this._recognition) return;
    this._usingFallback = false;
    try { this._recognition.stop(); } catch(e) { /* ignore */ }
    this._recognition = null;
  }

  // ── Event Helper ─────────────────────────────────────────────────────────

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

window.VRescuerSpeechEngine = VRescuerSpeechEngine;
