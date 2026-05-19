/**
 * V-Rescuer Stats Monitor (The Heartbeat)
 * ─────────────────────────────────────────
 * Polls RTCPeerConnection.getStats() every N seconds.
 * Emits network state change events:
 *   - 'state:good'       → Normal operation
 *   - 'state:degraded'   → Audio-only mode (video disabled)
 *   - 'state:critical'   → Full fallback (media off, DataChannel captions)
 *   - 'stats-update'     → Raw stats for UI display
 */

class VRescuerStatsMonitor extends EventTarget {
  constructor(peerConnection) {
    super();
    this._pc = peerConnection;
    this._intervalId = null;
    this._lastBytesSent = 0;
    this._lastStatsTime = 0;
    this._currentState = 'good'; // 'good' | 'degraded' | 'critical'
    this._stableStartTime = null; // When network became stable again

    // Bind
    this._poll = this._poll.bind(this);
  }

  start() {
    if (this._intervalId) return;
    console.log('[StatsMonitor] Starting heartbeat...');
    this._poll(); // immediate first poll
    this._intervalId = setInterval(this._poll, VRescuerConfig.STATS_POLL_INTERVAL_MS);
  }

  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    console.log('[StatsMonitor] Heartbeat stopped.');
  }

  async _poll() {
    if (!this._pc || this._pc.connectionState === 'closed') return;

    let stats;
    try {
      stats = await this._pc.getStats();
    } catch (e) {
      console.warn('[StatsMonitor] getStats() failed:', e);
      return;
    }

    const report = this._parseStats(stats);
    this._dispatchEvent('stats-update', report);
    this._evaluateNetworkState(report);
  }

  _parseStats(stats) {
    const report = {
      bitrateBps: 0,
      packetLossRatio: 0,
      roundTripTime: 0,
      availableOutgoingBitrate: 0,
      bytesSent: 0,
      packetsLost: 0,
      packetsSent: 0,
      timestamp: Date.now(),
    };

    stats.forEach((stat) => {
      // ─── ICE Candidate Pair (best source for available outgoing bitrate) ──
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
        if (stat.availableOutgoingBitrate) {
          report.availableOutgoingBitrate = Math.max(
            report.availableOutgoingBitrate,
            stat.availableOutgoingBitrate
          );
        }
      }

      // ─── Outbound RTP (bytes sent for actual bitrate calculation) ─────────
      if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
        report.bytesSent += stat.bytesSent || 0;
        report.packetsSent += stat.packetsSent || 0;
      }
      if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
        report.bytesSent += stat.bytesSent || 0;
        report.packetsSent += stat.packetsSent || 0;
      }

      // ─── Remote Inbound (packet loss) ─────────────────────────────────────
      if (stat.type === 'remote-inbound-rtp') {
        report.packetsLost += stat.packetsLost || 0;
        if (stat.roundTripTime) {
          report.roundTripTime = Math.max(report.roundTripTime, stat.roundTripTime * 1000); // convert to ms
        }
      }
    });

    // Calculate actual bitrate from bytes delta
    const now = Date.now();
    const deltaMs = now - this._lastStatsTime;
    if (this._lastStatsTime > 0 && deltaMs > 0) {
      const deltaBytes = report.bytesSent - this._lastBytesSent;
      report.bitrateBps = Math.max(0, (deltaBytes * 8 * 1000) / deltaMs);
    }
    this._lastBytesSent = report.bytesSent;
    this._lastStatsTime = now;

    // Use availableOutgoingBitrate if actual is 0 (before media flows)
    if (report.bitrateBps === 0 && report.availableOutgoingBitrate > 0) {
      report.bitrateBps = report.availableOutgoingBitrate;
    }

    // Compute packet loss ratio
    const totalPackets = report.packetsSent + report.packetsLost;
    report.packetLossRatio = totalPackets > 0 ? report.packetsLost / totalPackets : 0;

    return report;
  }

  _evaluateNetworkState(report) {
    const { bitrateBps, packetLossRatio } = report;
    const cfg = VRescuerConfig;

    let newState = 'good';

    // Critical: below 15 kbps OR extreme packet loss
    if (
      (bitrateBps > 0 && bitrateBps < cfg.BITRATE_THRESHOLD_FULL_FALLBACK) ||
      packetLossRatio > cfg.PACKET_LOSS_CRITICAL
    ) {
      newState = 'critical';
    }
    // Degraded: below 100 kbps OR significant packet loss
    else if (
      (bitrateBps > 0 && bitrateBps < cfg.BITRATE_THRESHOLD_AUDIO_ONLY) ||
      packetLossRatio > cfg.PACKET_LOSS_THRESHOLD
    ) {
      newState = 'degraded';
    }

    // ─── State transition logic ───────────────────────────────────────────
    if (newState !== 'good') {
      this._stableStartTime = null; // reset stability clock
    }

    if (newState === 'good' && this._currentState !== 'good') {
      // Start recovery timer
      if (!this._stableStartTime) {
        this._stableStartTime = Date.now();
        console.log('[StatsMonitor] Network stabilizing... starting recovery timer.');
      }
      // Only actually recover after RECOVERY_STABLE_MS
      if (Date.now() - this._stableStartTime >= cfg.RECOVERY_STABLE_MS) {
        this._transition('good');
        this._stableStartTime = null;
      }
      return; // Don't change state yet
    }

    if (newState !== this._currentState) {
      this._transition(newState);
    }
  }

  _transition(newState) {
    const prevState = this._currentState;
    this._currentState = newState;
    console.log(`[StatsMonitor] State: ${prevState} → ${newState}`);
    this._dispatchEvent('state-change', { from: prevState, to: newState });
  }

  _dispatchEvent(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get currentState() {
    return this._currentState;
  }
}

window.VRescuerStatsMonitor = VRescuerStatsMonitor;
