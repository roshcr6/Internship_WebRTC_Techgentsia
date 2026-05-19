/**
 * V-Rescuer Admin Bridge
 * ──────────────────────
 * Broadcasts all stats, state changes, and log entries from the call page
 * to the admin dashboard via BroadcastChannel.
 *
 * Admin page listens on the same channel name and renders the data.
 * Zero impact on call performance — fire-and-forget, non-blocking.
 */

class VRescuerAdminBridge {
  constructor() {
    this._ch     = new BroadcastChannel('v-rescuer-admin');
    this._active = true;
  }

  sendStats(stats) {
    if (!this._active) return;
    this._post({ type: 'stats', data: stats });
  }

  sendStateChange(from, to) {
    if (!this._active) return;
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

  destroy() {
    this._active = false;
    this._ch.close();
  }

  _post(msg) {
    try { this._ch.postMessage(msg); } catch (e) { /* ignore */ }
  }
}

window.VRescuerAdminBridge = VRescuerAdminBridge;
