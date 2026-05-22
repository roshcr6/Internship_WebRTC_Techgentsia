/**
 * V-Rescuer Media Pipeline Controllers
 * Splits video/audio/AI concerns for maintainability.
 */

class VRescuerVideoController {
  constructor(peerConn) {
    this._pc = peerConn;
    this._lastApplyTs = 0;
    this._lastParams = { maxBitrate: null, maxFramerate: null };
    this._ewmaBps = 0;
    this._ruralMode = false;
    this._proActive = false;
    this._lastProTs = 0;
  }

  setRuralMode(enabled) {
    this._ruralMode = !!enabled;
  }

  async setQuality(profileName) {
    const profile = this._ruralMode ? 'rural' : profileName;
    return this._pc.setVideoQuality(profile);
  }

  async setOutboundEnabled(enabled) {
    return this._pc.setOutboundEnabled('video', enabled);
  }

  adapt(stats, networkState) {
    if (!stats || !this._pc) return;
    if (['critical', 'audio'].includes(networkState)) return;

    const cfg = VRescuerConfig;
    const available = stats.availableOutgoingBitrate || stats.bitrateBps || 0;
    if (!available) return;

    // EWMA smoothing
    const alpha = cfg.VIDEO_DYNAMIC_EWMA_ALPHA ?? 0.2;
    this._ewmaBps = this._ewmaBps ? this._ewmaBps * (1 - alpha) + available * alpha : available;

    const rttMs = stats.roundTripTime ?? 0;
    const jitterMs = (stats.jitter ?? 0) * 1000;
    const loss = stats.packetLossRatio ?? 0;

    this._updateProMode({ available, rttMs, jitterMs, loss, networkState });

    let penalty = 1;
    if (rttMs > 300) penalty *= 0.8;
    if (rttMs > 600) penalty *= 0.6;
    if (jitterMs > 30) penalty *= 0.85;
    if (jitterMs > 80) penalty *= 0.65;
    if (loss > 0.10) penalty *= 0.7;
    if (loss > 0.20) penalty *= 0.5;

    const minBps = cfg.VIDEO_DYNAMIC_MIN_BPS ?? 160_000;
    const maxBps = cfg.VIDEO_DYNAMIC_MAX_BPS ?? 2_200_000;
    let target = Math.round(this._ewmaBps * 0.75 * penalty);
    target = Math.min(maxBps, Math.max(minBps, target));

    let fps = this._proActive ? 60 : 30;
    if (rttMs > 300 || jitterMs > 40) fps = 24;
    if (rttMs > 500 || jitterMs > 80) fps = 18;
    if (rttMs > 700 || jitterMs > 120 || loss > 0.2) fps = 12;
    if (this._ruralMode) fps = Math.min(fps, 12);

    const now = performance.now();
    if (now - this._lastApplyTs < (cfg.VIDEO_DYNAMIC_APPLY_MS ?? 1500)) return;

    const sameBitrate = this._lastParams.maxBitrate === target;
    const sameFps = this._lastParams.maxFramerate === fps;
    if (sameBitrate && sameFps) return;

    this._lastApplyTs = now;
    this._lastParams.maxBitrate = target;
    this._lastParams.maxFramerate = fps;

    this._pc.applyVideoSenderParams({ maxBitrate: target, maxFramerate: fps });
  }

  _updateProMode({ available, rttMs, jitterMs, loss, networkState }) {
    const cfg = VRescuerConfig;
    if (!cfg.PRO_QUALITY_AUTO || this._ruralMode) {
      this._setPro(false);
      return;
    }
    if (networkState !== 'good') {
      this._setPro(false);
      return;
    }

    const now = performance.now();
    const meets =
      available >= (cfg.PRO_QUALITY_MIN_BPS ?? 1_800_000) &&
      rttMs <= (cfg.PRO_QUALITY_MAX_RTT_MS ?? 120) &&
      jitterMs <= (cfg.PRO_QUALITY_MAX_JITTER_MS ?? 20) &&
      loss <= (cfg.PRO_QUALITY_MAX_LOSS ?? 0.02);

    if (meets && !this._proActive) {
      this._setPro(true);
      this._lastProTs = now;
      return;
    }

    if (this._proActive) {
      const hold = cfg.PRO_QUALITY_HOLD_MS ?? 8000;
      if (!meets && (now - this._lastProTs) > hold) {
        this._setPro(false);
        this._lastProTs = now;
      }
    }
  }

  _setPro(active) {
    if (this._proActive === active) return;
    this._proActive = active;
    this.setQuality(active ? 'pro' : 'good');
  }

  getPerfState() {
    return { proActive: this._proActive, rural: this._ruralMode };
  }
}

class VRescuerAudioController {
  constructor(peerConn) {
    this._pc = peerConn;
  }

  async setOutboundEnabled(enabled) {
    return this._pc.setOutboundEnabled('audio', enabled);
  }
}

class VRescuerAIController {
  constructor(engine) {
    this._engine = engine;
  }

  setStream(stream) {
    this._engine.setStream(stream);
  }

  preload() {
    this._engine.preloadModel();
  }

  start() {
    this._engine.start();
  }

  stop() {
    this._engine.stop();
  }

  setModelPolicy(policy) {
    if (this._engine.setModelPolicy) this._engine.setModelPolicy(policy);
  }

  setLowLatencyMode(enabled) {
    if (this._engine.setLowLatencyMode) this._engine.setLowLatencyMode(enabled);
  }
}

window.VRescuerVideoController = VRescuerVideoController;
window.VRescuerAudioController = VRescuerAudioController;
window.VRescuerAIController = VRescuerAIController;
