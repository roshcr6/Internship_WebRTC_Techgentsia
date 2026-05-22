# V-Rescuer — Edge-AI WebRTC Fallback

> Fault-tolerant WebRTC that adapts video quality and survives catastrophic bandwidth loss with live captions.

---

## What it does

V-Rescuer monitors connection quality in real time. When bandwidth drops:

- **Degraded**: video stays on, but bitrate, resolution, and FPS are reduced.
- **Critical**: video and audio pause; speech is transcribed locally and sent as captions over the DataChannel.

Speech runs **in-browser** using Whisper tiny.en (ONNX/WebAssembly). If unavailable, it falls back to the native Web Speech API.

---

## Architecture (high level)

```
Signaling (BroadcastChannel)
        |
        v
RTCPeerConnection <-> StatsMonitor (getStats each 1s)
        |
        +--> Adaptive video params (setParameters + constraints fallback)
        |
        +--> DataChannel captions (binary, unordered, no retransmits)
        |
        +--> Speech Engine (Whisper -> Native fallback)
```

---

## Network state machine

```
GOOD      -> DEGRADED  -> LOW        -> CRITICAL
(>200kbps)  (<100kbps)   (<50kbps)    (<15kbps)

GOOD:     full quality
DEGRADED: reduced video bitrate/resolution/fps
LOW:      very low video bitrate/resolution/fps
CRITICAL: video+audio off, captions on
```

---

## File structure

```
Caller Internship_Project_v-Rescuer/
├── index.html                 # Call UI
├── admin.html                 # Admin dashboard
├── css/
│   ├── call.css               # Call UI styles
│   └── admin.css              # Admin UI styles
├── js/
│   ├── config.js              # Thresholds, profiles, timings
│   ├── signaling.js           # BroadcastChannel signaling
│   ├── stats-monitor.js       # getStats polling + state machine
│   ├── speech-engine.js       # Whisper AI + native fallback
│   ├── data-channel.js        # Caption transport + backpressure
│   ├── peer-connection.js     # RTCPeerConnection manager
│   ├── admin.js               # Admin dashboard logic
│   ├── admin-bridge.js        # Call -> Admin bridge
│   └── app.js                 # App orchestrator + UI
└── workers/
    └── whisper-worker.js       # Whisper model worker
```

---

## How to run

Serve over HTTP (WebRTC requires a secure context; localhost is OK).

### Option A — VS Code Live Server
1) Right-click index.html -> Open with Live Server
2) Open a second tab at the same URL

### Option B — npx serve
```bash
cd "Caller Internship_Project_v-Rescuer"
npx serve .
```

### Option C — Python
```bash
cd "Caller Internship_Project_v-Rescuer"
python -m http.server 8080
```

---

## Test flow

1) Open two tabs to the call page.
2) Tab 1: Start as Caller.
3) Tab 2: Join as Callee.
4) (Optional) Open admin.html in a third tab.

---

## Key technical decisions

- **Perfect negotiation**: polite/impolite roles and rollback to avoid glare.
- **1s stats cadence**: live quality updates for adaptive control.
- **Adaptive video scaling**: setParameters + degradationPreference + constraints fallback.
- **Auto-tuned thresholds**: adapt to observed availableOutgoingBitrate (toggle in call UI).
- **DataChannel backpressure**: drop interim captions if bufferedAmount is high.
- **In-browser STT**: Whisper tiny.en (offline after first load), native fallback.

---

Built for Techgentsia Internship — May 2026
