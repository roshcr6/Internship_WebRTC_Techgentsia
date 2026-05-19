/**
 * V-Rescuer Whisper AI Worker
 * ────────────────────────────
 * Runs OpenAI Whisper tiny.en ENTIRELY in the browser via ONNX/WebAssembly.
 * No API keys. No server. Works offline after first 40MB model download (cached).
 *
 * This is equivalent to what Samsung Live Translation uses on-device —
 * but running in the browser via Hugging Face Transformers.js
 *
 * Message Protocol (main → worker):
 *   { type: 'load', modelId?: string }
 *   { type: 'transcribe', id: number, audio: Float32Array, sampleRate: 16000 }
 *
 * Message Protocol (worker → main):
 *   { type: 'loading_progress', progress: 0-100, status, file }
 *   { type: 'ready', modelId }
 *   { type: 'result', id, text, inferenceMs }
 *   { type: 'error', message }
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// ── Optimize transformers.js for browser ────────────────────────────────────
env.allowLocalModels = false;
env.useBrowserCache  = true;   // Persist model in Cache Storage across sessions
env.backends.onnx.wasm.wasmPaths =
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';

// ── State ────────────────────────────────────────────────────────────────────
let transcriber = null;
let isLoading   = false;

// ── Message Router ───────────────────────────────────────────────────────────
self.onmessage = async ({ data: msg }) => {
  switch (msg.type) {
    case 'load':
      await _loadModel(msg.modelId ?? 'Xenova/whisper-tiny.en');
      break;
    case 'transcribe':
      await _transcribe(msg.id, msg.audio, msg.sampleRate ?? 16000);
      break;
  }
};

// ── Model Loader ─────────────────────────────────────────────────────────────
async function _loadModel(modelId) {
  if (transcriber) { self.postMessage({ type: 'ready', modelId }); return; }
  if (isLoading) return;
  isLoading = true;

  self.postMessage({ type: 'loading_progress', status: 'Initializing…', progress: 0, file: '' });

  try {
    transcriber = await pipeline('automatic-speech-recognition', modelId, {
      quantized: true,          // int8 quantized: 40% smaller + 2× faster inference
      revision: 'main',
      progress_callback: ({ status, progress, file }) => {
        self.postMessage({
          type: 'loading_progress',
          status: status ?? 'downloading',
          progress: Math.min(99, Math.round(progress ?? 0)),
          file: file ?? '',
        });
      },
    });
    isLoading = false;
    self.postMessage({ type: 'ready', modelId });
    console.log(`[WhisperWorker] ✓ Model ready: ${modelId}`);
  } catch (err) {
    isLoading = false;
    self.postMessage({ type: 'error', message: `Model load failed: ${err.message}` });
  }
}

// ── Transcription Engine ─────────────────────────────────────────────────────
// Whisper hallucination patterns to suppress
const NOISE_PATTERN = /^\[.*?\]$|^(?:music|thank you\.?|you|bye)$/i;

async function _transcribe(id, audio, sampleRate) {
  if (!transcriber) {
    self.postMessage({ type: 'result', id, text: '', inferenceMs: 0, error: 'not_ready' });
    return;
  }

  // ── VAD: skip silent chunks (saves CPU on quiet pauses) ─────────────────
  const rms = _computeRMS(audio);
  if (rms < 0.008) {
    self.postMessage({ type: 'result', id, text: '', inferenceMs: 0, silent: true });
    return;
  }

  const t0 = performance.now();
  try {
    const out = await transcriber(audio, {
      sampling_rate:     sampleRate,
      language:          'english',
      task:              'transcribe',
      return_timestamps: false,   // Skip timestamps = faster inference
      chunk_length_s:    2,       // Match our 2s capture window
      stride_length_s:   0.25,   // 250ms overlap for word continuity
    });

    const raw  = (out.text ?? '').trim();
    const text = NOISE_PATTERN.test(raw) ? '' : raw;
    const ms   = Math.round(performance.now() - t0);

    self.postMessage({ type: 'result', id, text, inferenceMs: ms });
  } catch (err) {
    self.postMessage({ type: 'result', id, text: '', inferenceMs: 0, error: err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _computeRMS(float32Array) {
  let sum = 0;
  for (let i = 0; i < float32Array.length; i++) sum += float32Array[i] ** 2;
  return Math.sqrt(sum / float32Array.length);
}
