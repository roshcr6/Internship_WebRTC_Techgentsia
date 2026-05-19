/**
 * V-Rescuer DataChannel v2 — Binary Protocol
 * ────────────────────────────────────────────
 * Uses a compact binary wire format instead of JSON to minimize overhead.
 *
 * Frame layout (bytes):
 *   [0]     uint8   — message type  (0=ping, 1=interim, 2=final, 3=status)
 *   [1-2]   uint16  — sequence num  (for out-of-order detection)
 *   [3-6]   uint32  — ms timestamp  (call-relative, wraps ~49 days)
 *   [7+]    utf-8   — payload text
 *
 * Total overhead: 7 bytes vs ~30 bytes for JSON → 77% reduction.
 * For a 5-word caption: 12 bytes vs 65 bytes.
 *
 * Events:
 *   'open'    → DataChannel is ready
 *   'close'   → DataChannel closed
 *   'message' → { type, text, seqNum, timestamp }
 */

class VRescuerDataChannel extends EventTarget {
  constructor() {
    super();
    this._channel  = null;
    this._seqNum   = 0;
    this._callStart = 0;
    this._encoder  = new TextEncoder();
    this._decoder  = new TextDecoder();
  }

  // ── Channel Creation ───────────────────────────────────────────────────────

  /** Caller creates the channel before the offer */
  create(peerConnection) {
    const ch = peerConnection.createDataChannel(
      VRescuerConfig.DATA_CHANNEL_LABEL,
      VRescuerConfig.DATA_CHANNEL_OPTIONS
    );
    this._attach(ch);
    return ch;
  }

  /** Callee attaches to the channel received via ondatachannel */
  attach(channel) {
    this._attach(channel);
  }

  _attach(channel) {
    this._channel   = channel;
    this._callStart = performance.now();
    channel.binaryType = 'arraybuffer'; // Receive as ArrayBuffer for binary decode

    channel.onopen = () => {
      console.log('[DataChannel] Open.');
      this._emit('open', {});
    };
    channel.onclose = () => {
      console.log('[DataChannel] Closed.');
      this._emit('close', {});
    };
    channel.onerror = (e) => {
      console.error('[DataChannel] Error:', e);
    };
    channel.onmessage = (e) => {
      const msg = this._decode(e.data);
      if (msg) this._emit('message', msg);
    };
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  sendInterim(text) {
    this._send(VRescuerConfig.DC_MSG_INTERIM, text);
  }

  sendFinal(text) {
    this._send(VRescuerConfig.DC_MSG_FINAL, text);
  }

  sendPing() {
    this._send(VRescuerConfig.DC_MSG_PING, '');
  }

  sendStatus(text) {
    this._send(VRescuerConfig.DC_MSG_STATUS, text);
  }

  _send(type, text) {
    if (!this._channel || this._channel.readyState !== 'open') return;

    const textBytes = this._encoder.encode(text);
    const buf       = new ArrayBuffer(7 + textBytes.byteLength);
    const view      = new DataView(buf);
    const seq       = (this._seqNum++) & 0xFFFF;
    const ts        = Math.round(performance.now() - this._callStart) & 0xFFFFFFFF;

    view.setUint8(0, type);
    view.setUint16(1, seq,  false); // big-endian
    view.setUint32(3, ts,   false);
    new Uint8Array(buf, 7).set(textBytes);

    try {
      this._channel.send(buf);
    } catch (e) {
      // Channel may have closed mid-send — ignore
      console.warn('[DataChannel] Send failed:', e.message);
    }
  }

  // ── Receiving ──────────────────────────────────────────────────────────────

  _decode(data) {
    // Gracefully handle legacy JSON strings (from older peer versions)
    if (typeof data === 'string') {
      try {
        const obj = JSON.parse(data);
        return { type: obj.type === 'interim' ? 1 : 2, text: obj.text ?? '', seqNum: 0, timestamp: 0 };
      } catch { return null; }
    }

    if (!(data instanceof ArrayBuffer) || data.byteLength < 7) return null;

    const view      = new DataView(data);
    const type      = view.getUint8(0);
    const seqNum    = view.getUint16(1, false);
    const timestamp = view.getUint32(3, false);
    const text      = this._decoder.decode(new Uint8Array(data, 7));

    return { type, seqNum, timestamp, text };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy() {
    try { this._channel?.close(); } catch (e) { /* ignore */ }
    this._channel = null;
    this._seqNum  = 0;
  }

  get isOpen() {
    return this._channel?.readyState === 'open';
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

window.VRescuerDataChannel = VRescuerDataChannel;
