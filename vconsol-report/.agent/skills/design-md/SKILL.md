---
name: design-md
description: Analyzes Stitch projects and generates comprehensive DESIGN.md files documenting design systems in natural, semantic language optimized for Stitch screen generation.
allowed-tools:
  - "StitchMCP"
  - "Read"
  - "Write"
---

# Stitch DESIGN.md Skill

## Overview
This skill creates `DESIGN.md` files that serve as the "source of truth" for prompting Stitch to generate new screens that align perfectly with existing design language. Stitch interprets design through "Visual Descriptions" supported by specific color values.

## Prerequisites
- Access to the Stitch MCP Server
- A Stitch project with at least one designed screen
- Reference: https://stitch.withgoogle.com/docs/learn/prompting/

## The Goal
The `DESIGN.md` file will serve as the "source of truth" for prompting Stitch to generate new screens that align perfectly with the existing design language.

## Retrieval and Networking

1. **Namespace discovery**: Run `list_tools` to find the Stitch MCP prefix.
2. **Project lookup**: Call `list_projects` with `filter: "view=owned"` to find the target project.
3. **Screen lookup**: Call `list_screens` with the `projectId` to find representative screens.
4. **Metadata fetch**: Call `get_screen` with `projectId` and `screenId` to retrieve:
   - `screenshot.downloadUrl` — visual reference
   - `htmlCode.downloadUrl` — full HTML/CSS source
   - `width`, `height`, `deviceType`
5. **Asset download**: Use `read_url_content` to fetch the HTML, then parse Tailwind classes and custom CSS.
6. **Project metadata**: Call `get_project` to get `designTheme` (color mode, fonts, roundness, custom colors).

---

## Analysis & Synthesis Instructions

### 1. Extract Project Identity
- Capture Project Title and Project ID from the JSON.

### 2. Define the Atmosphere
Evaluate the screenshot and HTML to capture the overall "vibe." Use evocative adjectives (e.g., "Airy," "Dense," "Minimalist," "Utilitarian").

### 3. Map the Color Palette
For each key color, provide:
- A descriptive natural-language name (e.g., "Deep Muted Teal-Navy")
- The specific hex code in parentheses (e.g., "#294056")
- Its functional role (e.g., "Used for primary actions")

### 4. Translate Geometry & Shape
Convert technical `border-radius` values into physical descriptions:
- `rounded-full` → "Pill-shaped"
- `rounded-lg` → "Subtly rounded corners"
- `rounded-none` → "Sharp, squared-off edges"

### 5. Describe Depth & Elevation
Explain how the UI handles layers: "Flat," "Whisper-soft diffused shadows," or "Heavy, high-contrast drop shadows."

---

## Output Format (DESIGN.md Structure)

```markdown
# Design System: [Project Title]
**Project ID:** [Insert Project ID Here]

## 1. Visual Theme & Atmosphere
(Description of mood, density, and aesthetic philosophy.)

## 2. Color Palette & Roles
(List colors by Descriptive Name + Hex Code + Functional Role.)

## 3. Typography Rules
(Font family, weight usage for headers vs. body, letter-spacing.)

## 4. Component Stylings
* **Buttons:** Shape, color, behavior
* **Cards/Containers:** Corner roundness, background color, shadow depth
* **Inputs/Forms:** Stroke style, background

## 5. Layout Principles
(Whitespace strategy, margins, grid alignment.)
```

---

## Best Practices
- **Be Descriptive:** Avoid generic terms. Use "Ocean-deep Cerulean (#0077B6)" not "blue."
- **Be Functional:** Explain what each element is used for.
- **Be Consistent:** Use the same terminology throughout.
- **Be Precise:** Include hex codes in parentheses after natural language descriptions.

## Common Pitfalls to Avoid
- ❌ Using technical jargon without translation (`rounded-xl` instead of "generously rounded corners")
- ❌ Omitting color codes or using only descriptive names
- ❌ Forgetting to explain functional roles of design elements
- ❌ Being too vague in atmosphere descriptions
- ❌ Ignoring subtle design details like shadows or spacing patterns
