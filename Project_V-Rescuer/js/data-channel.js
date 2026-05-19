/**
 * V-Rescuer DataChannel Manager
 * ──────────────────────────────
 * Wraps RTCDataChannel for ultra-low-latency caption transmission.
 * Configured as UDP-like (ordered:false, maxRetransmits:0).
 *
 * Message Protocol (JSON):
 *   { type: 'interim'|'final'|'ping', text?: string, ts: number }
 */

class VRescuerDataChannel extends EventTarget {
  constructor() {
    super();
    this._channel = null;
  }

  /**
   * Called by the caller side — creates the channel on the PeerConnection.
   * Must be called BEFORE creating the offer.
   */
  create(peerConnection) {
    this._channel = peerConnection.createDataChannel(
      VRescuerConfig.DATA_CHANNEL_LABEL,
      VRescuerConfig.DATA_CHANNEL_OPTIONS
    );
    this._bindEvents(this._channel);
    console.log('[DataChannel] Channel created (caller side).');
    return this._channel;
  }

  /**
   * Called by the callee side — receives the channel via ondatachannel.
   * Must be wired up before ICE completes.
   */
  attach(channel) {
    this._channel = channel;
    this._bindEvents(this._channel);
    console.log('[DataChannel] Channel attached (callee side).');
  }

  _bindEvents(channel) {
    channel.onopen = () => {
      console.log('[DataChannel] ✓ Open and ready.');
      this._emit('open', {});
    };
    channel.onclose = () => {
      console.log('[DataChannel] Closed.');
      this._emit('close', {});
    };
    channel.onerror = (err) => {
      console.error('[DataChannel] Error:', err);
      this._emit('error', { error: err });
    };
    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._emit('message', msg);
      } catch (e) {
        // Legacy plain-text fallback
        this._emit('message', { type: 'final', text: event.data, ts: Date.now() });
      }
    };
  }

  /**
   * Send an interim (still-being-spoken) transcript fragment.
   * Fire-and-forget — loss is acceptable.
   */
  sendInterim(text) {
    this._send({ type: 'interim', text, ts: Date.now() });
  }

  /**
   * Send a committed final transcript segment.
   */
  sendFinal(text) {
    this._send({ type: 'final', text, ts: Date.now() });
  }

  sendPing() {
    this._send({ type: 'ping', ts: Date.now() });
  }

  _send(payload) {
    if (!this._channel || this._channel.readyState !== 'open') return;
    try {
      this._channel.send(JSON.stringify(payload));
    } catch (e) {
      console.warn('[DataChannel] Send failed:', e);
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get isOpen() {
    return this._channel?.readyState === 'open';
  }

  get channel() {
    return this._channel;
  }

  destroy() {
    if (this._channel) {
      try { this._channel.close(); } catch (e) { /* ignore */ }
      this._channel = null;
    }
  }
}

window.VRescuerDataChannel = VRescuerDataChannel;
