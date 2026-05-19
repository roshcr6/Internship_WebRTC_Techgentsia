/**
 * V-Rescuer Configuration v2
 * ────────────────────────────
 * Central source of truth for all thresholds, model IDs, and timing.
 */

const VRescuerConfig = {

  // ── WebRTC ─────────────────────────────────────────────────────────────────
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }, // Extra reliable STUN
  ],

  // ── DataChannel ─────────────────────────────────────────────────────────────
  DATA_CHANNEL_LABEL: 'v-rescuer-captions',
  DATA_CHANNEL_OPTIONS: {
    ordered: false,       // UDP-like: speed over delivery guarantee
    maxRetransmits: 0,    // Fire and forget — latency << reliability for captions
  },
  // Binary message type codes
  DC_MSG_PING:    0,
  DC_MSG_INTERIM: 1,
  DC_MSG_FINAL:   2,
  DC_MSG_STATUS:  3,

  // ── AI Model ────────────────────────────────────────────────────────────────
  // Whisper tiny.en — quantized int8, ~40MB, cached in browser after first load
  // Accuracy: ~96% WER on English speech. Inference: ~100-250ms per 2s chunk.
  // Works 100% OFFLINE after first download (same approach as Samsung on-device AI)
  AI_MODEL_ID:   'Xenova/whisper-tiny.en',
  AI_CHUNK_MS:   2000,   // Capture 2-second audio chunks for Whisper
  AI_CHUNK_OVERLAP_S: 0.25, // 250ms overlap for word continuity

  // ── Network Thresholds ──────────────────────────────────────────────────────
  BITRATE_THRESHOLD_FULL_FALLBACK: 15_000,   // bps — kill media, use captions
  BITRATE_THRESHOLD_AUDIO_ONLY:   100_000,   // bps — disable video only
  BITRATE_THRESHOLD_RECOVERY:     200_000,   // bps — must exceed for 10s to recover
  PACKET_LOSS_THRESHOLD:           0.15,      // 15% loss → audio-only
  PACKET_LOSS_CRITICAL:            0.40,      // 40% loss → full fallback

  // ── Adaptive Stats Polling ──────────────────────────────────────────────────
  // Polls faster when near thresholds for quicker response
  STATS_POLL_GOOD_MS:     3000,   // Healthy: relaxed polling (saves CPU)
  STATS_POLL_WARN_MS:     1000,   // Near threshold: fast polling
  STATS_POLL_CRITICAL_MS:  500,   // Critical: very fast polling for recovery detection
  RECOVERY_STABLE_MS:    10_000,  // Must be stable this long before recovering

  // ── Signaling ───────────────────────────────────────────────────────────────
  BROADCAST_CHANNEL_NAME: 'v-rescuer-signal',

  // ── Legacy Speech (Web Speech API fallback) ─────────────────────────────────
  SPEECH_LANGUAGE:         'en-US',
  SPEECH_INTERIM_RESULTS:  true,
  SPEECH_MAX_ALTERNATIVES: 1,
};

window.VRescuerConfig = VRescuerConfig;
