/**
 * V-Rescuer Configuration
 * Central configuration for all thresholds, STUN servers, and behavioral settings
 */

const VRescuerConfig = {
  // ─── WebRTC ───────────────────────────────────────────────────────────────
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],

  // ─── DataChannel ─────────────────────────────────────────────────────────
  DATA_CHANNEL_LABEL: 'v-rescuer-captions',
  DATA_CHANNEL_OPTIONS: {
    ordered: false,       // UDP-like: prioritize speed over guaranteed delivery
    maxRetransmits: 0,    // Fire and forget — latency << reliability for live captions
  },

  // ─── Network Thresholds ───────────────────────────────────────────────────
  BITRATE_THRESHOLD_FULL_FALLBACK: 15_000,   // bps — below this: kill media, use captions
  BITRATE_THRESHOLD_AUDIO_ONLY:   100_000,   // bps — below this: disable video only
  BITRATE_THRESHOLD_RECOVERY:     200_000,   // bps — above this for recovery period: restore
  PACKET_LOSS_THRESHOLD:          0.15,      // 15% packet loss triggers audio-only mode
  PACKET_LOSS_CRITICAL:           0.40,      // 40% packet loss triggers full fallback

  // ─── Timing ──────────────────────────────────────────────────────────────
  STATS_POLL_INTERVAL_MS:  2_000,   // How often to poll RTCPeerConnection.getStats()
  RECOVERY_STABLE_MS:     10_000,   // How long network must be stable before recovery

  // ─── Signaling Channel ───────────────────────────────────────────────────
  BROADCAST_CHANNEL_NAME: 'v-rescuer-signal',

  // ─── Speech ──────────────────────────────────────────────────────────────
  SPEECH_LANGUAGE: 'en-US',
  SPEECH_INTERIM_RESULTS: true,
  SPEECH_MAX_ALTERNATIVES: 1,
};

// Export as global (no bundler – vanilla script load)
window.VRescuerConfig = VRescuerConfig;
