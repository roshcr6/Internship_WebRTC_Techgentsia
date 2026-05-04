---
name: remotion
description: Generates walkthrough videos from Stitch projects using Remotion with smooth transitions, zooming, and text overlays to showcase app screens professionally.
allowed-tools:
  - "StitchMCP"
  - "Bash"
  - "Read"
  - "Write"
  - "web_fetch"
---

# Stitch to Remotion Walkthrough Videos

Generates professional walkthrough videos of Stitch-designed app screens using Remotion, with smooth transitions, zoom effects, and contextual text overlays.

## Prerequisites
- Access to the Stitch MCP Server
- Node.js and npm installed
- A Stitch project with designed screens

---

## Retrieval and Networking

### Step 1: Discover MCP Servers
Run `list_tools` to find prefixes for Stitch (`stitch:` / `mcp_stitch:`) and Remotion (`remotion:`) MCP servers.

### Step 2: Retrieve Stitch Project Information
1. Call `list_projects` with `filter: "view=owned"` to find the target project.
2. Call `list_screens` with the project ID to list all screens.
3. For each screen, call `get_screen` with `projectId` and `screenId` to retrieve:
   - `screenshot.downloadUrl` — visual asset for the video
   - `width`, `height` — screen dimensions
   - Screen title and description for text overlays
4. Download screenshots with `curl` or `web_fetch` → `assets/screens/{screen-name}.png`

### Step 3: Set Up Remotion Project
```bash
npm create video@latest -- --blank
cd video
npm install @remotion/transitions @remotion/animated-emoji
```

---

## Video Composition Strategy

### Architecture
- **`ScreenSlide.tsx`** — Individual screen with zoom + fade animations
  - Props: `imageSrc`, `title`, `description`, `width`, `height`
  - Duration: 3–5 seconds per screen
- **`WalkthroughComposition.tsx`** — Main composition with sequenced slides
- **`config.ts`** — Frame rate (30 fps), dimensions, total duration

### Transition Effects
```tsx
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
// Use spring() for smooth zoom animations
```

### Text Overlays
1. Screen titles — top/bottom of each frame
2. Feature callouts — animated pointers to UI elements
3. Descriptions — fade-in text per screen
4. Progress indicator — current position in walkthrough

---

## Execution Steps

### Step 1: Create Screen Manifest (`screens.json`)
```json
{
  "projectName": "My App",
  "screens": [
    {
      "id": "1",
      "title": "Home Screen",
      "description": "Main interface",
      "imagePath": "assets/screens/home.png",
      "width": 1200,
      "height": 800,
      "duration": 4
    }
  ]
}
```

### Step 2: Generate Remotion Components
1. Create `ScreenSlide.tsx` with `useCurrentFrame()` + `spring()` animations
2. Create `WalkthroughComposition.tsx` with `<Sequence>` components
3. Update `remotion.config.ts` with dimensions and duration

### Step 3: Preview and Refine
```bash
npm run dev
# Opens Remotion Studio for real-time preview and adjustment
```

### Step 4: Render Video
```bash
npx remotion render WalkthroughComposition output.mp4
# Optional flags:
# --quality 80
# --codec h264
# --concurrency 4
```

---

## Common Patterns

### Pattern 1: Simple Slide Show
Each screen displayed for 3 seconds with fade transitions.

### Pattern 2: Feature Highlight
Zoom into specific UI elements with callout text overlays.

### Pattern 3: User Flow
Sequence screens in the order of a typical user journey with arrows between screens.

---

## Troubleshooting
- **Screenshot quality**: Append `=w{width}` to Google CDN screenshot URLs for full resolution
- **Fetch errors**: Quote URLs in bash commands; use `curl -L` for redirects
- **Transition timing**: Adjust `durationInFrames` in `<TransitionSeries.Transition>` for smoother blends
