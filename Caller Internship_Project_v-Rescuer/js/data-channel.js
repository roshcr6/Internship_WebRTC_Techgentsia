/**
 * V-Rescuer DataChannel v3 — Binary Protocol
 * ────────────────────────────────────────────
 * Frame layout (7-byte header + UTF-8 payload):
 *   [0]     uint8   — type   (0=ping, 1=interim, 2=final, 3=status)
 *   [1-2]   uint16  — seqNum (out-of-order detection)
 *   [3-6]   uint32  — ts     (call-relative ms, wraps ~49 days)
 *   [7+]    utf-8   — payload text
 *
 * FIX v3: DC_MSG_STATUS now emits a 'status' event so the CALLEE correctly
 *         shows/hides the caption overlay when the caller signals CRITICAL_FALLBACK
 *         or RECOVERY. Previously this message type was decoded but silently dropped.
 *
 * Events:
 *   'open'    → DataChannel is ready
 *   'close'   → DataChannel closed
 *   'message' → { type, text, seqNum, timestamp }   (interim / final / ping)
 *   'status'  → { command }                          (CRITICAL_FALLBACK / RECOVERY)
 */

class VRescuerDataChannel extends EventTarget {
  constructor() {
    super();
    this._channel   = null;
    this._seqNum    = 0;
    this._callStart = 0;
    this._encoder   = new TextEncoder();
    this._decoder   = new TextDecoder();
  }

  // ── Channel Setup ─────────────────────────────────────────────────────────

  /** Caller: create channel BEFORE the offer so it's included in the SDP */
  create(peerConnection) {
    const ch = peerConnection.createDataChannel(
      VRescuerConfig.DATA_CHANNEL_LABEL,
      VRescuerConfig.DATA_CHANNEL_OPTIONS,
    );
    this._attach(ch);
    return ch;
  }

  /** Callee: receive the channel from ondatachannel */
  attach(channel) {
    this._attach(channel);
  }

  _attach(channel) {
    this._channel   = channel;
    this._callStart = performance.now();
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = VRescuerConfig.DC_LOW_BUFFERED_BYTES;

    channel.onopen  = () => { console.log('[DataChannel] Open.');   this._emit('open',  {}); };
    channel.onclose = () => { console.log('[DataChannel] Closed.'); this._emit('close', {}); };
    channel.onerror = (e) => { console.error('[DataChannel] Error:', e); };
    channel.onmessage = (e) => {
      const msg = this._decode(e.data);
      if (!msg) return;

      const cfg = VRescuerConfig;
      if (msg.type === cfg.DC_MSG_STATUS) {
        // ── FIX: emit 'status' so app.js can show/hide caption overlay ──────
        this._emit('status', { command: msg.text });
      } else {
        this._emit('message', msg);
      }
    };
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  sendInterim(text)  { this._send(VRescuerConfig.DC_MSG_INTERIM, text); }
  sendFinal(text)    { this._send(VRescuerConfig.DC_MSG_FINAL,   text); }
  sendPing()         { this._send(VRescuerConfig.DC_MSG_PING,    '');   }
  sendStatus(text)   { this._send(VRescuerConfig.DC_MSG_STATUS,  text); }

  _send(type, text) {
    if (!this._channel || this._channel.readyState !== 'open') return;
    const cfg = VRescuerConfig;
    if (
      this._channel.bufferedAmount > cfg.DC_MAX_BUFFERED_BYTES &&
      cfg.DC_DROP_INTERIM_ON_PRESSURE &&
      (type === cfg.DC_MSG_INTERIM || type === cfg.DC_MSG_PING)
    ) {
      return;
    }
    const textBytes = this._encoder.encode(text);
    const buf       = new ArrayBuffer(7 + textBytes.byteLength);
    const view      = new DataView(buf);
    const seq       = (this._seqNum++) & 0xFFFF;
    const ts        = Math.round(performance.now() - this._callStart) & 0xFFFFFFFF;
    view.setUint8(0, type);
    view.setUint16(1, seq, false);
    view.setUint32(3, ts,  false);
    new Uint8Array(buf, 7).set(textBytes);
    try { this._channel.send(buf); }
    catch (e) { console.warn('[DataChannel] Send failed:', e.message); }
  }

  // ── Receiving ──────────────────────────────────────────────────────────────

  _decode(data) {
    // Graceful legacy JSON fallback (older peer versions)
    if (typeof data === 'string') {
      try {
        const obj = JSON.parse(data);
        return { type: obj.type === 'interim' ? 1 : 2, text: obj.text ?? '', seqNum: 0, timestamp: 0 };
      } catch { return null; }
    }
    if (!(data instanceof ArrayBuffer) || data.byteLength < 7) return null;
    const view = new DataView(data);
    return {
      type:      view.getUint8(0),
      seqNum:    view.getUint16(1, false),
      timestamp: view.getUint32(3, false),
      text:      this._decoder.decode(new Uint8Array(data, 7)),
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy() {
    try { this._channel?.close(); } catch (e) { /* ignore */ }
    this._channel = null;
    this._seqNum  = 0;
  }

  get isOpen() { return this._channel?.readyState === 'open'; }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

window.VRescuerDataChannel = VRescuerDataChannel;
