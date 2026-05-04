---
name: enhance-prompt
description: Transforms vague UI ideas into polished, Stitch-optimized prompts. Enhances specificity, adds UI/UX keywords, injects design system context, and structures output for better generation results.
allowed-tools:
  - "StitchMCP"
  - "Read"
  - "Write"
---

# Enhance Prompt for Stitch

Transforms vague UI ideas into polished, Stitch-optimized prompts with proper structure, keywords, and design system context.

## Prerequisites
Before enhancing prompts, consult the Stitch Effective Prompting Guide:
- https://stitch.withgoogle.com/docs/learn/prompting/

## When to Use This Skill
Activate when a user wants to:
- Polish a UI prompt before sending to Stitch
- Improve a prompt that produced poor results
- Add design system consistency to a simple idea
- Structure a vague concept into an actionable prompt

---

## Enhancement Pipeline

### Step 1: Assess the Input
Evaluate what's missing:

| Element | Check for | If missing... |
|---------|-----------|---------------|
| **Platform** | "web", "mobile", "desktop" | Add based on context or ask |
| **Page type** | "landing page", "dashboard", "form" | Infer from description |
| **Structure** | Numbered sections/components | Create logical page structure |
| **Visual style** | Adjectives, mood, vibe | Add appropriate descriptors |
| **Colors** | Specific values or roles | Add design system or suggest palette |
| **Components** | UI-specific terms | Translate to proper keywords |

### Step 2: Check for DESIGN.md
Look for a `DESIGN.md` file in the current project:

**If DESIGN.md exists:**
1. Read the file to extract the design system block
2. Include the color palette, typography, and component styles
3. Format as a "DESIGN SYSTEM (REQUIRED)" section in the output

**If DESIGN.md does not exist:**
Add this tip at the end:
```
💡 **Tip:** For consistent designs across multiple screens, create a DESIGN.md
file using the `design-md` skill.
```

### Step 3: Apply Enhancements

#### A. Add UI/UX Keywords
| Vague | Enhanced |
|-------|----------|
| "menu at the top" | "navigation bar with logo and menu items" |
| "button" | "primary call-to-action button" |
| "list of items" | "card grid layout" or "vertical list with thumbnails" |
| "form" | "form with labeled input fields and submit button" |
| "picture area" | "hero section with full-width image" |

#### B. Amplify the Vibe
| Basic | Enhanced |
|-------|----------|
| "modern" | "clean, minimal, with generous whitespace" |
| "professional" | "sophisticated, trustworthy, with subtle shadows" |
| "fun" | "vibrant, playful, with rounded corners and bold colors" |
| "dark mode" | "dark theme with high-contrast accents on deep backgrounds" |

#### C. Structure the Page
```markdown
**Page Structure:**
1. **Header:** Navigation with logo and menu items
2. **Hero Section:** Headline, subtext, and primary CTA
3. **Content Area:** [Describe the main content]
4. **Footer:** Links, social icons, copyright
```

#### D. Format Colors Properly
```
Descriptive Name (#hexcode) for functional role
```
Examples:
- "Deep Ocean Blue (#1a365d) for primary buttons and links"
- "Warm Cream (#faf5f0) for page background"
- "Soft Gray (#6b7280) for secondary text"

### Step 4: Format the Output
```markdown
[One-line description of the page purpose and vibe]

**DESIGN SYSTEM (REQUIRED):**
- Platform: [Web/Mobile], [Desktop/Mobile]-first
- Theme: [Light/Dark], [style descriptors]
- Background: [Color description] (#hex)
- Primary Accent: [Color description] (#hex) for [role]
- Text Primary: [Color description] (#hex)

**Page Structure:**
1. **[Section]:** [Description]
2. **[Section]:** [Description]
...
```

---

## Output Options

**Default:** Return the enhanced prompt as text for the user to copy.

**Optional file output:** If the user requests, write to:
- `next-prompt.md` — for use with the `stitch-loop` skill
- Custom filename specified by user

---

## Examples

### Example 1: Vague Input → Structured Prompt
**Input:** "Make a home page for my app"

**Output:**
```
A clean, modern home page for a productivity SaaS app. The design should feel
professional and trustworthy with a light theme and subtle elevation.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first
- Theme: Light, clean and minimal
- Background: Off-white (#f8fafc)
- Primary Accent: Indigo (#4f46e5) for buttons and links
- Text Primary: Slate (#0f172a)

**Page Structure:**
1. **Header:** Sticky navigation with logo, nav links, and Sign In / Get Started buttons
2. **Hero Section:** Bold headline, value proposition subtext, primary CTA button
3. **Features Grid:** 3-column card grid with icons, titles, and short descriptions
4. **Social Proof:** Testimonials carousel or logo strip
5. **Footer:** Links, social icons, copyright
```

### Example 2: Feature Request → Targeted Edit
**Input:** "Make the button bigger and blue"

**Output:**
```
Increase the size of the primary CTA button to be more prominent. Change its
background color to Royal Blue (#2563eb) and ensure it has a hover state
that darkens to (#1d4ed8). Maintain the current border radius and padding proportions.
```
