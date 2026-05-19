/**
 * V-Rescuer Stats Monitor v2
 * ────────────────────────────
 * Polls RTCPeerConnection.getStats() with ADAPTIVE intervals:
 *   - Healthy  (>500kbps): poll every 3s   — minimal CPU impact
 *   - Warning  (<200kbps): poll every 1s   — fast threshold detection
 *   - Critical (<15kbps):  poll every 500ms — rapid recovery detection
 *
 * Uses recursive setTimeout (not setInterval) to prevent timer drift and
 * allow true dynamic interval adjustment mid-poll.
 *
 * Emits:
 *   'state-change' → { from, to }
 *   'stats-update' → { bitrateBps, packetLossRatio, roundTripTime, ... }
 */

class VRescuerStatsMonitor extends EventTarget {
  constructor(peerConnection) {
    super();
    this._pc              = peerConnection;
    this._timeoutId       = null;
    this._active          = false;
    this._currentState    = 'good';
    this._stableStartTime = null;

    // Delta tracking for bitrate calculation
    this._lastBytesSent  = 0;
    this._lastStatsTime  = 0;
  }

  start() {
    if (this._active) return;
    this._active = true;
    console.log('[StatsMonitor] Heartbeat started (adaptive).');
    this._scheduleNext(0); // immediate first poll
  }

  stop() {
    this._active = false;
    clearTimeout(this._timeoutId);
    this._timeoutId = null;
    console.log('[StatsMonitor] Heartbeat stopped.');
  }

  // ── Adaptive Scheduler ────────────────────────────────────────────────────

  _scheduleNext(delayMs) {
    this._timeoutId = setTimeout(async () => {
      if (!this._active) return;
      await this._poll();
      if (this._active) {
        this._scheduleNext(this._getAdaptiveInterval());
      }
    }, delayMs);
  }

  _getAdaptiveInterval() {
    const cfg = VRescuerConfig;
    switch (this._currentState) {
      case 'critical':  return cfg.STATS_POLL_CRITICAL_MS;  // 500ms
      case 'degraded':  return cfg.STATS_POLL_WARN_MS;      // 1000ms
      default:          return cfg.STATS_POLL_GOOD_MS;      // 3000ms
    }
  }

  // ── Core Poll ─────────────────────────────────────────────────────────────

  async _poll() {
    if (!this._pc || this._pc.connectionState === 'closed') return;

    let statsMap;
    try {
      statsMap = await this._pc.getStats();
    } catch (e) {
      console.warn('[StatsMonitor] getStats() failed:', e.message);
      return;
    }

    const report = this._parseStats(statsMap);
    this._emit('stats-update', report);
    this._evaluateState(report);
  }

  // ── Stats Parser ──────────────────────────────────────────────────────────

  _parseStats(statsMap) {
    const report = {
      bitrateBps:             0,
      packetLossRatio:        0,
      roundTripTime:          0,
      availableOutgoingBitrate: 0,
      bytesSent:              0,
      packetsLost:            0,
      packetsSent:            0,
      jitter:                 0,
      timestamp:              performance.now(),
    };

    statsMap.forEach((stat) => {
      // ICE Candidate Pair — best source for available outgoing bitrate
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
        if (stat.availableOutgoingBitrate > report.availableOutgoingBitrate) {
          report.availableOutgoingBitrate = stat.availableOutgoingBitrate;
        }
      }

      // Outbound RTP — actual bytes/packets sent
      if (stat.type === 'outbound-rtp') {
        report.bytesSent    += stat.bytesSent    || 0;
        report.packetsSent  += stat.packetsSent  || 0;
      }

      // Remote Inbound — packet loss and RTT
      if (stat.type === 'remote-inbound-rtp') {
        report.packetsLost  += stat.packetsLost  || 0;
        report.jitter       += stat.jitter       || 0;
        if (stat.roundTripTime) {
          report.roundTripTime = Math.max(report.roundTripTime, stat.roundTripTime * 1000);
        }
      }
    });

    // Calculate bitrate from bytes delta using performance.now() for accuracy
    const now     = performance.now();
    const deltaMs = now - this._lastStatsTime;
    if (this._lastStatsTime > 0 && deltaMs > 0) {
      const deltaBytes    = report.bytesSent - this._lastBytesSent;
      report.bitrateBps   = Math.max(0, (deltaBytes * 8 * 1000) / deltaMs);
    }
    this._lastBytesSent = report.bytesSent;
    this._lastStatsTime = now;

    // Fall back to availableOutgoingBitrate if actual bitrate is 0
    if (report.bitrateBps === 0 && report.availableOutgoingBitrate > 0) {
      report.bitrateBps = report.availableOutgoingBitrate;
    }

    // Packet loss ratio
    const total = report.packetsSent + report.packetsLost;
    report.packetLossRatio = total > 0 ? report.packetsLost / total : 0;

    return report;
  }

  // ── Network State Machine ─────────────────────────────────────────────────

  _evaluateState(report) {
    const { bitrateBps, packetLossRatio } = report;
    const cfg = VRescuerConfig;

    // Determine desired state from current metrics
    let desiredState = 'good';
    if (
      (bitrateBps > 0 && bitrateBps < cfg.BITRATE_THRESHOLD_FULL_FALLBACK) ||
      packetLossRatio > cfg.PACKET_LOSS_CRITICAL
    ) {
      desiredState = 'critical';
    } else if (
      (bitrateBps > 0 && bitrateBps < cfg.BITRATE_THRESHOLD_AUDIO_ONLY) ||
      packetLossRatio > cfg.PACKET_LOSS_THRESHOLD
    ) {
      desiredState = 'degraded';
    }

    // ── Recovery guard: must be stable for RECOVERY_STABLE_MS before 'good' ──
    if (desiredState !== 'good') {
      this._stableStartTime = null; // Reset stability timer

    } else if (this._currentState !== 'good') {
      // Recovering: start or continue stability timer
      if (!this._stableStartTime) {
        this._stableStartTime = performance.now();
        console.log('[StatsMonitor] Network stabilising… recovery timer started.');
      }
      const stableMs = performance.now() - this._stableStartTime;
      if (stableMs < cfg.RECOVERY_STABLE_MS) return; // Not stable long enough yet
      this._stableStartTime = null;
    }

    // ── Transition if state changed ───────────────────────────────────────
    if (desiredState !== this._currentState) {
      const from = this._currentState;
      this._currentState = desiredState;
      console.log(`[StatsMonitor] State: ${from} → ${desiredState}`);
      this._emit('state-change', { from, to: desiredState });
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get currentState() { return this._currentState; }
}

window.VRescuerStatsMonitor = VRescuerStatsMonitor;
