# 🛡️ V-Rescuer — Edge-AI Codec Fallback System

> **A fault-tolerance WebRTC protocol that keeps rural & low-bandwidth meetings alive — automatically.**

---

## The Problem

When internet speeds drop in rural or low-connectivity areas, video freezes → audio becomes robotic → the call drops entirely. Traditional conferencing tools have no graceful degradation.

## The Solution

V-Rescuer monitors your WebRTC connection health in real-time. When it detects **catastrophic bandwidth loss (< 15 kbps)**, it:

1. **Kills the media streams** (freeing all bandwidth)
2. **Activates the browser's native Web Speech API** (transcribes your voice locally — no AI server needed)
3. **Fires the text over an RTCDataChannel** (uses ~100 bytes/utterance vs ~1,500,000 bytes/second for video)
4. **Displays live captions** on the receiver's screen with a "Network Critical: Live Transcript Active" banner

The meeting continues. Nobody types. Nobody disconnects.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        V-Rescuer App                         │
│                                                             │
│  ┌──────────────┐    ┌────────────────┐    ┌─────────────┐ │
│  │  Signaling   │    │ PeerConnection  │    │StatsMonitor │ │
│  │(BroadcastCh) │◄──►│  (WebRTC Core) │◄──►│(getStats()) │ │
│  └──────────────┘    └────────────────┘    └──────┬──────┘ │
│                              │                     │        │
│                    ┌─────────┴────────┐            │        │
│                    │                  │            ▼        │
│             ┌──────▼──────┐  ┌────────▼──────┐  State     │
│             │MediaTracks  │  │  DataChannel   │  Machine   │
│             │(Video+Audio)│  │(Captions/UDP-  │            │
│             └─────────────┘  │  like, fast)   │            │
│                              └────────┬───────┘            │
│                                       │                     │
│                              ┌────────▼───────┐            │
│                              │ Speech Engine   │            │
│                              │(Web Speech API) │            │
│                              └────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗂️ File Structure

```
Project_V-Rescuer/
├── index.html                 ← Main UI entry point
├── css/
│   └── styles.css             ← Premium dark glassmorphism UI
├── js/
│   ├── config.js              ← All thresholds & constants
│   ├── signaling.js           ← BroadcastChannel tab-to-tab signaling
│   ├── stats-monitor.js       ← RTCPeerConnection.getStats() heartbeat
│   ├── speech-engine.js       ← Web Speech API wrapper
│   ├── data-channel.js        ← RTCDataChannel caption transport
│   ├── peer-connection.js     ← RTCPeerConnection manager
│   └── app.js                 ← Main orchestrator + UI controller
└── README.md
```

---

## ⚙️ Network State Machine

```
          ┌────────────────────────────────────────┐
          ▼                                        │
      [ GOOD ]  ──── bitrate < 100kbps ──►  [ DEGRADED ]
          ▲               │                        │
          │               │                 bitrate < 15kbps
          │        10s stable              pktloss > 40%
          │               │                        │
          └───────────────┼────────────────────────┘
                          ▼
                    [ CRITICAL ]
                  Video OFF + Audio OFF
                  Speech API → DataChannel
```

| State | Trigger | Action |
|---|---|---|
| **Good** | Bitrate > 200 kbps for 10s | Restore all media |
| **Degraded** | Bitrate < 100 kbps OR loss > 15% | Disable video only |
| **Critical** | Bitrate < **15 kbps** OR loss > 40% | Kill all media → Speech→DataChannel captions |

---

## 🚀 How to Run

### Option A — VS Code Live Server (Recommended)
1. Install the **Live Server** extension in VS Code
2. Right-click `index.html` → **"Open with Live Server"**
3. Open a **second browser tab** at the same `localhost` URL

### Option B — npx serve
```bash
cd Project_V-Rescuer
npx serve .
```
Then open `http://localhost:3000` in **two tabs**.

### Option C — Python
```bash
cd Project_V-Rescuer
python -m http.server 8080
```
Then open `http://localhost:8080` in **two tabs**.

> ⚠️ **Must be served over HTTP/HTTPS**, not `file://` — WebRTC requires a secure context.  
> Chrome localhost is treated as secure, so `http://localhost` works fine.

---

## 🧪 Demo / Testing Guide

### Basic Call Test
1. Open two browser tabs at the same URL
2. **Tab 1**: Click **"📡 Start as Caller"** → allow camera/mic
3. **Tab 2**: Click **"📻 Join as Callee"** → allow camera/mic
4. Video call begins automatically

### Simulating Network Failure (Day 8 — Network Throttling)

**Method A — Simulation Buttons (instant)**
- Click **"⚠️ Simulate: Degraded"** → video cuts, audio-only mode
- Click **"🚨 Simulate: Critical"** → media kills, start speaking → captions appear on remote tab
- Click **"✅ Simulate: Healthy"** → full A/V restores

**Method B — Chrome DevTools Throttling (realistic)**
1. Open DevTools → **Network tab** → Throttle dropdown
2. Click **"Add..."** → Create profile:
   - Name: `Rural Edge`
   - Download: `20` kbps
   - Upload: `20` kbps
   - Latency: `500` ms
3. Apply throttle → watch V-Rescuer auto-detect and switch to captions

---

## 🔑 Key Technical Decisions

| Decision | Why |
|---|---|
| **BroadcastChannel signaling** | No server needed — perfect for same-browser demo |
| **DataChannel: `ordered:false, maxRetransmits:0`** | UDP-like — speed over reliability. Lost caption words are acceptable; latency is not |
| **`track.enabled = false` (not `track.stop()`)** | Preserves the track object so we can re-enable on recovery without renegotiation |
| **Speech API `continuous:true`** | Single recognition session — no gaps between utterances |
| **Stats polled every 2s** | Balance between responsiveness and CPU cost |
| **10s recovery timer** | Prevents flapping — network must be stable before restoring bandwidth-hungry video |

---

## 📅 10-Day Execution Map

| Day | Task | Status |
|---|---|---|
| 1 | Basic 1-on-1 WebRTC video call | ✅ |
| 2 | RTCDataChannel with UDP-like config | ✅ |
| 3 | Web Speech API integration | ✅ |
| 4 | Speech → DataChannel → Remote caption display | ✅ |
| 5 | `getStats()` heartbeat monitor | ✅ |
| 6 | Fallback trigger (< 15 kbps → captions) | ✅ |
| 7 | Recovery trigger (10s stable → restore A/V) | ✅ |
| 8 | Network throttling simulation panel | ✅ |
| 9 | Corporate UI/UX polish | ✅ |
| 10 | Record demo & write report | ⬜ |

---

## 🏆 Why This Is Impressive

- **Zero dependencies** — Pure HTML, CSS, JS. No npm, no frameworks, no AI APIs
- **Real-world problem solved** — Not a Zoom clone; a fault-tolerance *protocol*
- **Production architecture** — State machine, event-driven design, clean separation of concerns
- **Live-working demo** — Can be shown and throttled in real-time during an interview
- **Speaks to rural/government clients** — Techgentsia's actual use case

---

*Built for Techgentsia Internship — May 2026*
