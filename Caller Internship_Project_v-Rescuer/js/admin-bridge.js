/**
 * V-Rescuer Admin Bridge v3
 * ──────────────────────────
 * Broadcasts stats, state changes, and logs from the call page
 * to the admin dashboard via BroadcastChannel.
 *
 * FIX v3: sendStateChange now tracks `_prevState` internally so
 *         `from` is always the PREVIOUS state, not the current one.
 *         The original bug: app.js called sendStateChange(this._app.networkState, mode)
 *         AFTER networkState was already updated → from === to.
 */

class VRescuerAdminBridge {
  constructor() {
    this._ch        = new BroadcastChannel(VRescuerConfig.ADMIN_CHANNEL_NAME);
    this._active    = true;
    this._prevState = 'good'; // track last known state for correct 'from' value
  }

  sendStats(stats) {
    if (!this._active) return;
    this._post({ type: 'stats', data: stats });
  }

  /**
   * Record a network state transition.
   * @param {string} to - The new state
   * The 'from' is derived from the last known state stored in this bridge.
   */
  sendStateChange(to) {
    if (!this._active) return;
    const from      = this._prevState;
    this._prevState = to;
    this._post({ type: 'state-change', data: { from, to, ts: Date.now() } });
  }

  sendLog(message) {
    if (!this._active) return;
    this._post({ type: 'log', data: { message, ts: Date.now() } });
  }

  sendPhase(phase) {
    if (!this._active) return;
    this._post({ type: 'phase', data: { phase, ts: Date.now() } });
  }

  sendAIStatus(detail) {
    if (!this._active) return;
    this._post({ type: 'ai-status', data: detail });
  }

  sendDCStats(stats) {
    if (!this._active) return;
    this._post({ type: 'dc-stats', data: stats });
  }

  sendQuality(score) {
    if (!this._active) return;
    this._post({ type: 'quality', data: { score, ts: Date.now() } });
  }

  destroy() {
    this._active = false;
    try { this._ch.close(); } catch (e) { /* ignore */ }
  }

  _post(msg) {
    try { this._ch.postMessage(msg); } catch (e) { /* ignore */ }
  }
}

window.VRescuerAdminBridge = VRescuerAdminBridge;
