/**
 * V-Rescuer Signaling Module
 * Uses BroadcastChannel API for in-browser tab-to-tab signaling.
 * No server required — perfect for demo & development.
 *
 * Message format: { type: 'offer'|'answer'|'ice-candidate'|'bye', payload: ... }
 */

class VRescuerSignaling extends EventTarget {
  constructor() {
    super();
    this._channel = null;
    this._role = null; // 'caller' | 'callee'
    this._channelName = VRescuerConfig.BROADCAST_CHANNEL_NAME;
  }

  /** Initialize signaling as either 'caller' or 'callee' */
  init(role) {
    this._role = role;
    this._channel = new BroadcastChannel(this._channelName);
    this._channel.onmessage = (event) => this._handleMessage(event.data);
    console.log(`[Signaling] Initialized as ${role}`);
  }

  /**
   * Send a signaling message to the other peer.
   * @param {string} type - Message type
   * @param {*} payload - Message payload
   */
  send(type, payload) {
    if (!this._channel) throw new Error('[Signaling] Not initialized.');
    const message = { type, payload, from: this._role, timestamp: Date.now() };
    this._channel.postMessage(message);
    console.log(`[Signaling] Sent: ${type}`);
  }

  _handleMessage(message) {
    // Ignore messages sent by ourselves
    if (message.from === this._role) return;
    console.log(`[Signaling] Received: ${message.type} from ${message.from}`);

    switch (message.type) {
      case 'offer':
        this._emit('offer', message.payload);
        break;
      case 'answer':
        this._emit('answer', message.payload);
        break;
      case 'ice-candidate':
        this._emit('ice-candidate', message.payload);
        break;
      case 'bye':
        this._emit('bye', {});
        break;
      case 'ready':
        this._emit('peer-ready', {});
        break;
      default:
        console.warn(`[Signaling] Unknown message type: ${message.type}`);
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  destroy() {
    if (this._channel) {
      this._channel.close();
      this._channel = null;
    }
  }
}

window.VRescuerSignaling = VRescuerSignaling;
