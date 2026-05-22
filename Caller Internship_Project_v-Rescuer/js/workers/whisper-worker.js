/**
 * V-Rescuer Whisper AI Worker  ·  v3
 * ─────────────────────────────────────
 * Runs OpenAI Whisper tiny.en ENTIRELY in the browser via ONNX/WebAssembly.
 * No API keys. No server. Works offline after first ~40 MB model download.
 *
 * v3 improvements:
 *  - Adaptive VAD threshold (calibrates to room noise floor)
 *  - Pre-emphasis high-pass filter for WebRTC-compressed audio
 *  - Expanded hallucination filter
 *  - Worker stays resident; subsequent load messages are no-ops
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache  = true;
env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency ?? 2);
env.backends.onnx.wasm.wasmPaths  =
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';

let transcriber      = null;
let currentModelId   = '';
let isLoading        = false;
let noiseFloor       = 0;
let noiseCalibCount  = 0;
let noiseCalibSum    = 0;
const NOISE_CALIB_N  = 3;

let lastChunkLen = 2;
let lastStride   = 0.25;

self.onmessage = async ({ data: msg }) => {
  switch (msg.type) {
    case 'load':      await _loadModel(msg.modelId ?? 'Xenova/whisper-tiny.en'); break;
    case 'transcribe':
      if (typeof msg.chunkLengthS === 'number') lastChunkLen = msg.chunkLengthS;
      if (typeof msg.strideLengthS === 'number') lastStride = msg.strideLengthS;
      await _transcribe(msg.id, msg.audio, msg.sampleRate ?? 16000);
      break;
  }
};

async function _loadModel(modelId) {
  if (transcriber && currentModelId === modelId) {
    self.postMessage({ type: 'ready', modelId });
    return;
  }
  if (transcriber && currentModelId !== modelId) {
    transcriber = null;
  }
  if (isLoading)   return;
  isLoading = true;
  self.postMessage({ type: 'loading_progress', status: 'Initializing ONNX runtime…', progress: 0, file: '' });
  try {
    transcriber = await pipeline('automatic-speech-recognition', modelId, {
      quantized: true,
      revision:  'main',
      progress_callback: ({ status, progress, file }) => {
        self.postMessage({
          type: 'loading_progress',
          status:   status   ?? 'downloading',
          progress: Math.min(99, Math.round(progress ?? 0)),
          file:     file     ?? '',
        });
      },
    });
    isLoading = false;
    currentModelId = modelId;
    self.postMessage({ type: 'ready', modelId });
  } catch (err) {
    isLoading = false;
    self.postMessage({ type: 'error', message: `Model load failed: ${err.message}` });
  }
}

// Whisper hallucination patterns
const HALLUCINATION = /^\[.*?\]$|^\(.*?\)$|^\.{1,5}$|^(?:thank you\.?|you\.?|bye\.?|uh+\.?|um+\.?|hmm+\.?|okay\.?|music)$/i;

async function _transcribe(id, audio, sampleRate) {
  if (!transcriber) {
    self.postMessage({ type: 'result', id, text: '', inferenceMs: 0, error: 'not_ready' }); return;
  }

  // Adaptive VAD
  const rms = _rms(audio);
  if (noiseCalibCount < NOISE_CALIB_N) {
    noiseCalibSum += rms; noiseCalibCount++;
    noiseFloor = noiseCalibSum / noiseCalibCount;
  }
  const threshold = Math.max(0.006, noiseFloor * 2.2);
  if (rms < threshold) {
    self.postMessage({ type: 'result', id, text: '', inferenceMs: 0, silent: true }); return;
  }

  const processed = _preEmphasis(audio, 0.97);
  const t0 = performance.now();
  try {
    const out  = await transcriber(processed, {
      sampling_rate: sampleRate,
      language: 'english',
      task: 'transcribe',
      return_timestamps: false,
      chunk_length_s: lastChunkLen,
      stride_length_s: lastStride,
    });
    const raw  = (out.text ?? '').trim();
    const text = HALLUCINATION.test(raw) ? '' : raw;
    self.postMessage({ type: 'result', id, text, inferenceMs: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ type: 'result', id, text: '', inferenceMs: 0, error: err.message });
  }
}

function _rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function _preEmphasis(input, coeff) {
  const out = new Float32Array(input.length);
  out[0] = input[0];
  for (let i = 1; i < input.length; i++) out[i] = input[i] - coeff * input[i - 1];
  return out;
}
