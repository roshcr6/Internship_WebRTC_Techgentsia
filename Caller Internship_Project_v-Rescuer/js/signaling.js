/**
 * V-Rescuer Signaling Module
 * ──────────────────────────
 * Uses BroadcastChannel API for in-browser tab-to-tab signaling.
 * No server required — perfect for demo & development.
 *
 * Message format: { type, payload, from, timestamp }
 */

class VRescuerSignaling extends EventTarget {
  constructor() {
    super();
    this._channel     = null;
    this._role        = null;
    this._channelName = VRescuerConfig.BROADCAST_CHANNEL_NAME;
  }

  /** Initialize as 'caller' or 'callee' */
  init(role) {
    this._role    = role;
    this._channel = new BroadcastChannel(this._channelName);
    this._channel.onmessage = (event) => this._handleMessage(event.data);
    console.log(`[Signaling] Initialized as ${role}`);
  }

  send(type, payload) {
    if (!this._channel) throw new Error('[Signaling] Not initialized.');
    this._channel.postMessage({ type, payload, from: this._role, timestamp: Date.now() });
    console.log(`[Signaling] Sent: ${type}`);
  }

  _handleMessage(message) {
    if (message.from === this._role) return; // Ignore own messages
    console.log(`[Signaling] Received: ${message.type} from ${message.from}`);
    switch (message.type) {
      case 'description':  this._emit('description',  message.payload); break;
      case 'offer':         this._emit('offer',       message.payload); break;
      case 'answer':        this._emit('answer',      message.payload); break;
      case 'ice-candidate': this._emit('ice-candidate', message.payload); break;
      case 'bye':           this._emit('bye',         {}); break;
      case 'ready':         this._emit('peer-ready',  {}); break;
      default: console.warn(`[Signaling] Unknown type: ${message.type}`);
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  destroy() {
    this._channel?.close();
    this._channel = null;
  }
}

window.VRescuerSignaling = VRescuerSignaling;
