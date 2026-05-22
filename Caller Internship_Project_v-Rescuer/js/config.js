/**
 * V-Rescuer Configuration v3
 * ────────────────────────────
 * Central source of truth for all thresholds, model IDs, timing, and features.
 */

const VRescuerConfig = {

  // ── WebRTC ─────────────────────────────────────────────────────────────────
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302'   },
    { urls: 'stun:stun1.l.google.com:19302'  },
    { urls: 'stun:stun2.l.google.com:19302'  },
    { urls: 'stun:stun.cloudflare.com:3478'  },
  ],
  ICE_CANDIDATE_POOL_SIZE: 2,
  BUNDLE_POLICY: 'max-bundle',
  RTCP_MUX_POLICY: 'require',

  // ── DataChannel ─────────────────────────────────────────────────────────────
  DATA_CHANNEL_LABEL: 'v-rescuer-captions',
  DATA_CHANNEL_OPTIONS: {
    ordered:       false,   // UDP-like: speed over delivery guarantee
    maxRetransmits: 0,      // Fire and forget — latency << reliability for captions
  },
  // Binary message type codes (1 byte)
  DC_MSG_PING:    0,
  DC_MSG_INTERIM: 1,
  DC_MSG_FINAL:   2,
  DC_MSG_STATUS:  3,  // control messages (CRITICAL_FALLBACK, RECOVERY, etc.)
  DC_MAX_BUFFERED_BYTES: 256 * 1024,
  DC_LOW_BUFFERED_BYTES: 64 * 1024,
  DC_DROP_INTERIM_ON_PRESSURE: true,

  // ── AI Model ────────────────────────────────────────────────────────────────
  AI_MODEL_POLICY:    'auto', // auto | best | balanced | fast
  AI_MODEL_BEST:      'Xenova/whisper-small.en',
  AI_MODEL_BALANCED:  'Xenova/whisper-base.en',
  AI_MODEL_FAST:      'Xenova/whisper-tiny.en',
  AI_LOW_LATENCY_MODE: true,
  AI_AUTO_SWITCH:      true,
  AI_MAX_INFER_MS:     900,   // Switch to fast model above this avg inference time
  AI_UPGRADE_MS:       650,   // Switch back to best/balanced below this avg
  AI_SWITCH_COOLDOWN_MS: 20_000,
  AI_CHUNK_MS:         1500,  // Default chunk interval
  AI_CHUNK_OVERLAP_S:  0.20,
  AI_CHUNK_LEN_S:      1.5,
  AI_STRIDE_S:         0.2,
  AI_LOW_LATENCY_CHUNK_MS: 900,
  AI_LOW_LATENCY_CHUNK_LEN_S: 1.0,
  AI_LOW_LATENCY_STRIDE_S:    0.12,
  AI_MAX_QUEUE:       3,
  AI_AUDIO_BPS:       24000,
  AI_AUDIO_LATENCY_HINT: 'interactive',

  // ── Network Thresholds ──────────────────────────────────────────────────────
  BITRATE_THRESHOLD_FULL_FALLBACK: 15_000,   // bps — kill media, use captions
  BITRATE_THRESHOLD_AUDIO_ONLY:   70_000,   // bps — disable video only
  BITRATE_THRESHOLD_LOW:          120_000,   // bps — very low video
  BITRATE_THRESHOLD_DEGRADED:     250_000,   // bps — reduced video
  BITRATE_THRESHOLD_RECOVERY:     200_000,   // bps — must exceed for 10s to recover
  PACKET_LOSS_THRESHOLD:            0.15,    // 15% loss → audio-only
  PACKET_LOSS_LOW:                  0.25,    // 25% loss → very low video
  PACKET_LOSS_CRITICAL:             0.40,    // 40% loss → full fallback

  // ── Auto-tune Thresholds ───────────────────────────────────────────────────
  AUTO_TUNE_THRESHOLDS: true,
  AUTO_TUNE_ALPHA:      0.15,
  AUTO_TUNE_MIN_AUDIO_ONLY: 80_000,
  AUTO_TUNE_MAX_AUDIO_ONLY: 250_000,
  AUTO_TUNE_MIN_LOW:        30_000,
  AUTO_TUNE_MAX_LOW:        120_000,
  AUTO_TUNE_MIN_CRITICAL:   12_000,
  AUTO_TUNE_MAX_CRITICAL:   40_000,

  // ── State Stability ───────────────────────────────────────────────────────
  STATE_CHANGE_HOLD_MS: 2000,
  STABILITY_WINDOW:     12,

  // ── Video Quality Profiles ─────────────────────────────────────────────────
  VIDEO_QUALITY_PROFILES: {
    good: {
      maxBitrate:            2_200_000,
      scaleResolutionDownBy: 1,
      maxFramerate:          30,
      degradationPreference: 'balanced',
      targetHeight:          720,
    },
    pro: {
      maxBitrate:            3_000_000,
      scaleResolutionDownBy: 1,
      maxFramerate:          60,
      degradationPreference: 'maintain-resolution',
      targetHeight:          1080,
      priority:              'high',
      networkPriority:       'high',
    },
    degraded: {
      maxBitrate:            250_000,
      scaleResolutionDownBy: 2,
      maxFramerate:          15,
      degradationPreference: 'maintain-framerate',
      targetHeight:          360,
    },
    low: {
      maxBitrate:            120_000,
      scaleResolutionDownBy: 3,
      maxFramerate:          10,
      degradationPreference: 'maintain-framerate',
      targetHeight:          240,
    },
    rural: {
      maxBitrate:            180_000,
      scaleResolutionDownBy: 2,
      maxFramerate:          12,
      degradationPreference: 'maintain-framerate',
      targetHeight:          360,
    },
  },

  // ── Dynamic Video Adaptation ──────────────────────────────────────────────
  VIDEO_DYNAMIC_MIN_BPS: 160_000,
  VIDEO_DYNAMIC_MAX_BPS: 3_000_000,
  VIDEO_DYNAMIC_EWMA_ALPHA: 0.25,
  VIDEO_DYNAMIC_APPLY_MS: 1500,

  // ── Pro Quality Auto Mode (admin-visible) ───────────────────────────────
  PRO_QUALITY_AUTO: true,
  PRO_QUALITY_MIN_BPS: 1_800_000,
  PRO_QUALITY_MAX_RTT_MS: 120,
  PRO_QUALITY_MAX_JITTER_MS: 20,
  PRO_QUALITY_MAX_LOSS: 0.02,
  PRO_QUALITY_HOLD_MS: 8000,

  // ── Rural Profile Preset ─────────────────────────────────────────────────
  RURAL_PROFILE: {
    modelPolicy: 'fast',
    lowLatency: true,
    forceProfile: 'rural',
  },

  // ── Adaptive Stats Polling ──────────────────────────────────────────────────
  STATS_POLL_GOOD_MS:      1000,
  STATS_POLL_WARN_MS:      1000,
  STATS_POLL_CRITICAL_MS:  1000,
  RECOVERY_STABLE_MS:     10_000,

  // ── Quality Score Weights (0–100 composite) ────────────────────────────────
  // Quality = 100 − (bitratePenalty + lossPenalty + rttPenalty + jitterPenalty)
  QUALITY_BITRATE_WEIGHT:  0.50,
  QUALITY_LOSS_WEIGHT:     0.25,
  QUALITY_RTT_WEIGHT:      0.15,
  QUALITY_JITTER_WEIGHT:   0.10,

  // ── Signaling ───────────────────────────────────────────────────────────────
  BROADCAST_CHANNEL_NAME:    'v-rescuer-signal',
  ADMIN_CHANNEL_NAME:        'v-rescuer-admin',
  ADMIN_SIM_CHANNEL_NAME:    'v-rescuer-admin-sim',  // Admin → Call page commands

  // ── Speech ──────────────────────────────────────────────────────────────────
  SPEECH_LANGUAGE:         'en-US',
  SPEECH_INTERIM_RESULTS:  true,
  SPEECH_MAX_ALTERNATIVES: 1,

  // ── Audio Sender Preferences ───────────────────────────────────────────────
  AUDIO_MAX_BITRATE_BPS: 96000,
  AUDIO_DTX:             true,
  AUDIO_PRIORITY:        'high',
  AUDIO_NETWORK_PRIORITY:'high',

  // ── Video Sender Preferences ───────────────────────────────────────────────
  VIDEO_PRIORITY:        'high',
  VIDEO_NETWORK_PRIORITY:'high',

  // ── Audio Level Meter ───────────────────────────────────────────────────────
  AUDIO_METER_INTERVAL_MS: 80,   // ~12fps update for the level bar
  AUDIO_METER_SMOOTHING:   0.8,  // AnalyserNode smoothingTimeConstant

  // ── Transcript ──────────────────────────────────────────────────────────────
  MAX_TRANSCRIPT_CHARS: 50_000,  // Cap rolling transcript to 50KB

  // ── Admin Dashboard ─────────────────────────────────────────────────────────
  ADMIN_HEARTBEAT_STALE_MS: 8_000,
  ADMIN_HISTORY_LEN:        60,  // sparkline data points
};

window.VRescuerConfig = VRescuerConfig;
