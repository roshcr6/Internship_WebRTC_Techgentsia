/**
 * V-Rescuer Stats Monitor v3
 * ────────────────────────────
 * Polls RTCPeerConnection.getStats() with ADAPTIVE intervals.
 * Adds quality score (0–100) and ICE candidate type tracking.
 *
 * Emits:
 *   'state-change'  → { from, to, ts }
 *   'stats-update'  → { bitrateBps, packetLossRatio, roundTripTime, jitter,
 *                        bytesSent, packetsSent, qualityScore, iceType }
 */

class VRescuerStatsMonitor extends EventTarget {
  constructor(peerConnection) {
    super();
    this._pc              = peerConnection;
    this._timeoutId       = null;
    this._active          = false;
    this._currentState    = 'good';
    this._stableStartTime = null;

    // Delta tracking for bitrate
    this._lastBytesSent  = 0;
    this._lastStatsTime  = 0;

    // Rolling averages for quality score smoothing
    this._qualityHistory = [];
    this._stabilityHistory = [];
    this._pendingState = null;
    this._pendingSince = 0;
    this._dyn = {
      audioOnly: VRescuerConfig.BITRATE_THRESHOLD_AUDIO_ONLY,
      low:       VRescuerConfig.BITRATE_THRESHOLD_LOW,
      critical:  VRescuerConfig.BITRATE_THRESHOLD_FULL_FALLBACK,
    };
  }

  start() {
    if (this._active) return;
    this._active = true;
    console.log('[StatsMonitor] Heartbeat started (adaptive).');
    this._scheduleNext(0);
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
      if (this._active) this._scheduleNext(this._getAdaptiveInterval());
    }, delayMs);
  }

  _getAdaptiveInterval() {
    const cfg = VRescuerConfig;
    switch (this._currentState) {
      case 'critical': return cfg.STATS_POLL_CRITICAL_MS;
      case 'degraded': return cfg.STATS_POLL_WARN_MS;
      default:         return cfg.STATS_POLL_GOOD_MS;
    }
  }

  // ── Core Poll ─────────────────────────────────────────────────────────────

  async _poll() {
    if (!this._pc || this._pc.connectionState === 'closed') return;
    let statsMap;
    try   { statsMap = await this._pc.getStats(); }
    catch (e) { console.warn('[StatsMonitor] getStats() failed:', e.message); return; }

    const report = this._parseStats(statsMap);
    this._emit('stats-update', report);
    this._evaluateState(report);
  }

  // ── Stats Parser ──────────────────────────────────────────────────────────

  _parseStats(statsMap) {
    const report = {
      bitrateBps:               0,
      packetLossRatio:          0,
      roundTripTime:            0,
      availableOutgoingBitrate: 0,
      bytesSent:                0,
      packetsLost:              0,
      packetsSent:              0,
      jitter:                   0,
      qualityScore:             100,
      iceType:                  'unknown',
      timestamp:                performance.now(),
      stabilityScore:           100,
    };

    const localCandidates = new Map();
    const candidatePairs  = [];

    statsMap.forEach((stat) => {
      if (stat.type === 'local-candidate') localCandidates.set(stat.id, stat);
      if (stat.type === 'candidate-pair') candidatePairs.push(stat);

      // Outbound RTP — bytes/packets sent
      if (stat.type === 'outbound-rtp') {
        report.bytesSent   += stat.bytesSent   || 0;
        report.packetsSent += stat.packetsSent || 0;
      }

      // Remote Inbound — packet loss, RTT, jitter
      if (stat.type === 'remote-inbound-rtp') {
        report.packetsLost += stat.packetsLost || 0;
        report.jitter      += stat.jitter      || 0;
        if (stat.roundTripTime) {
          report.roundTripTime = Math.max(report.roundTripTime, stat.roundTripTime * 1000);
        }
      }
    });

    // Prefer nominated, succeeded candidate pair for bitrate/RTT/ICE type
    const bestPair = candidatePairs
      .filter((p) => p.state === 'succeeded')
      .reduce((best, p) => {
        const pScore = (p.nominated ? 1 : 0) * 1_000_000_000 + (p.availableOutgoingBitrate ?? 0);
        const bScore = best
          ? (best.nominated ? 1 : 0) * 1_000_000_000 + (best.availableOutgoingBitrate ?? 0)
          : -1;
        return pScore > bScore ? p : best;
      }, null);

    if (bestPair) {
      report.availableOutgoingBitrate = bestPair.availableOutgoingBitrate ?? 0;
      if (bestPair.currentRoundTripTime) {
        report.roundTripTime = Math.max(report.roundTripTime, bestPair.currentRoundTripTime * 1000);
      }
      const local = localCandidates.get(bestPair.localCandidateId);
      if (local?.candidateType) report.iceType = local.candidateType;
    }

    // Bitrate from bytes delta
    const now     = performance.now();
    const deltaMs = now - this._lastStatsTime;
    if (this._lastStatsTime > 0 && deltaMs > 0) {
      const deltaBytes  = report.bytesSent - this._lastBytesSent;
      report.bitrateBps = Math.max(0, (deltaBytes * 8 * 1000) / deltaMs);
    }
    this._lastBytesSent = report.bytesSent;
    this._lastStatsTime = now;

    // Fallback to available bitrate if measured is 0
    if (report.bitrateBps === 0 && report.availableOutgoingBitrate > 0) {
      report.bitrateBps = report.availableOutgoingBitrate;
    }

    // Packet loss ratio
    const total = report.packetsSent + report.packetsLost;
    report.packetLossRatio = total > 0 ? report.packetsLost / total : 0;

    // Quality score (0–100)
    report.qualityScore = this._computeQuality(report);
    report.stabilityScore = this._computeStability(report.qualityScore);

    return report;
  }

  // ── Quality Score ─────────────────────────────────────────────────────────
  // Composite: higher is better. Each dimension contributes a penalty.

  _computeQuality({ bitrateBps, packetLossRatio, roundTripTime, jitter }) {
    const cfg = VRescuerConfig;

    // Bitrate: 0 bps → 0 pts, 2Mbps+ → full pts
    const brScore  = Math.min(1, bitrateBps / 2_000_000);

    // Packet loss: 0% → full, 30%+ → 0
    const plScore  = Math.max(0, 1 - (packetLossRatio / 0.30));

    // RTT: 0ms → full, 500ms+ → 0
    const rttScore = Math.max(0, 1 - (roundTripTime / 500));

    // Jitter: 0ms → full, 200ms+ → 0
    const jitScore = Math.max(0, 1 - ((jitter * 1000) / 200));

    const raw = (
      brScore  * cfg.QUALITY_BITRATE_WEIGHT +
      plScore  * cfg.QUALITY_LOSS_WEIGHT    +
      rttScore * cfg.QUALITY_RTT_WEIGHT     +
      jitScore * cfg.QUALITY_JITTER_WEIGHT
    ) * 100;

    // Smooth with rolling 5-sample average
    this._qualityHistory.push(raw);
    if (this._qualityHistory.length > 5) this._qualityHistory.shift();
    const avg = this._qualityHistory.reduce((s, v) => s + v, 0) / this._qualityHistory.length;
    return Math.round(Math.min(100, Math.max(0, avg)));
  }

  // ── Network State Machine ─────────────────────────────────────────────────

  _evaluateState(report) {
    const { bitrateBps, packetLossRatio } = report;
    const cfg = VRescuerConfig;
    const thresholds = this._getDynamicThresholds(report);

    let desired = 'good';
    if (
      (bitrateBps > 0 && bitrateBps < thresholds.critical) ||
      packetLossRatio > cfg.PACKET_LOSS_CRITICAL
    ) {
      desired = 'critical';
    } else if (
      (bitrateBps > 0 && bitrateBps < thresholds.audioOnly) ||
      packetLossRatio > cfg.PACKET_LOSS_LOW
    ) {
      desired = 'audio';
    } else if (
      (bitrateBps > 0 && bitrateBps < thresholds.low) ||
      packetLossRatio > cfg.PACKET_LOSS_THRESHOLD
    ) {
      desired = 'low';
    } else if (
      bitrateBps > 0 && bitrateBps < cfg.BITRATE_THRESHOLD_DEGRADED
    ) {
      desired = 'degraded';
    }

    // Recovery guard
    if (desired !== 'good') {
      this._stableStartTime = null;
    } else if (this._currentState !== 'good') {
      if (!this._stableStartTime) {
        this._stableStartTime = performance.now();
        console.log('[StatsMonitor] Stabilising — recovery timer started.');
      }
      if (performance.now() - this._stableStartTime < cfg.RECOVERY_STABLE_MS) return;
      this._stableStartTime = null;
    }

    if (desired === this._currentState) {
      this._pendingState = null;
      this._pendingSince = 0;
      return;
    }

    if (this._pendingState !== desired) {
      this._pendingState = desired;
      this._pendingSince = performance.now();
      return;
    }

    if (performance.now() - this._pendingSince < (cfg.STATE_CHANGE_HOLD_MS ?? 2000)) return;

    const from          = this._currentState;
    this._currentState  = desired;
    this._pendingState  = null;
    this._pendingSince  = 0;
    console.log(`[StatsMonitor] ${from} → ${desired}`);
    this._emit('state-change', { from, to: desired, ts: Date.now() });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _getDynamicThresholds(report) {
    const cfg = VRescuerConfig;
    if (!cfg.AUTO_TUNE_THRESHOLDS) return {
      audioOnly: cfg.BITRATE_THRESHOLD_AUDIO_ONLY,
      low:       cfg.BITRATE_THRESHOLD_LOW,
      critical:  cfg.BITRATE_THRESHOLD_FULL_FALLBACK,
    };

    const available = report.availableOutgoingBitrate ?? 0;
    if (available <= 0) return this._dyn;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const alpha = cfg.AUTO_TUNE_ALPHA ?? 0.15;

    const targetAudio = clamp(available * 0.08, cfg.AUTO_TUNE_MIN_AUDIO_ONLY, cfg.AUTO_TUNE_MAX_AUDIO_ONLY);
    const targetLow   = clamp(available * 0.04, cfg.AUTO_TUNE_MIN_LOW, cfg.AUTO_TUNE_MAX_LOW);
    const targetCrit  = clamp(available * 0.012, cfg.AUTO_TUNE_MIN_CRITICAL, cfg.AUTO_TUNE_MAX_CRITICAL);

    this._dyn.audioOnly = this._dyn.audioOnly * (1 - alpha) + targetAudio * alpha;
    this._dyn.low       = this._dyn.low       * (1 - alpha) + targetLow   * alpha;
    this._dyn.critical  = this._dyn.critical  * (1 - alpha) + targetCrit  * alpha;

    return this._dyn;
  }

  _computeStability(qualityScore) {
    const cfg = VRescuerConfig;
    this._stabilityHistory.push(qualityScore);
    const maxLen = cfg.STABILITY_WINDOW ?? 12;
    if (this._stabilityHistory.length > maxLen) this._stabilityHistory.shift();
    const avg = this._stabilityHistory.reduce((s, v) => s + v, 0) / this._stabilityHistory.length;
    const variance = this._stabilityHistory.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / this._stabilityHistory.length;
    const std = Math.sqrt(variance);
    return Math.round(Math.max(0, Math.min(100, 100 - std * 2)));
  }

  get currentState() { return this._currentState; }
}

window.VRescuerStatsMonitor = VRescuerStatsMonitor;
