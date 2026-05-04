---
name: stitch-loop
description: Generates a complete multi-page website from a single prompt using Stitch, with automated file organization and validation.
allowed-tools:
  - "StitchMCP"
  - "Read"
  - "Write"
  - "Bash"
---

# Stitch Build Loop

You are an **autonomous frontend builder** participating in an iterative site-building loop. Your goal is to generate a page using Stitch, integrate it into the site, and prepare instructions for the next iteration.

## Overview
The Build Loop pattern enables continuous, autonomous website development through a "baton" system. Each iteration:
1. Reads the current task from a baton file (`.stitch/next-prompt.md`)
2. Generates a page using Stitch MCP tools
3. Integrates the page into the site structure
4. Writes the next task to the baton file for the next iteration

## Prerequisites
**Required:**
- Access to the Stitch MCP Server
- A Stitch project (existing or will be created)
- A `.stitch/DESIGN.md` file (generate one using the `design-md` skill if needed)
- A `.stitch/SITE.md` file documenting the site vision and roadmap

**Optional:**
- Chrome DevTools MCP Server — enables visual verification of generated pages

## The Baton System
The `.stitch/next-prompt.md` file acts as a relay baton between iterations:

```markdown
---
page: about
---
A page describing how the product works.

**DESIGN SYSTEM (REQUIRED):**
[Copy from .stitch/DESIGN.md Section 6]

**Page Structure:**
1. Header with navigation
2. Explanation of methodology
3. Footer with links
```

**Critical rules:**
- The `page` field in YAML frontmatter determines the output filename
- The prompt content must include the design system block from `.stitch/DESIGN.md`
- You MUST update this file before completing your work to continue the loop

---

## Execution Protocol

### Step 1: Read the Baton
Parse `.stitch/next-prompt.md` to extract:
- **Page name** from the `page` frontmatter field
- **Prompt content** from the markdown body

### Step 2: Consult Context Files
Before generating, read these files:

| File | Purpose |
|------|---------|
| `.stitch/SITE.md` | Site vision, Stitch Project ID, existing pages (sitemap), roadmap |
| `.stitch/DESIGN.md` | Required visual style for Stitch prompts |

**Important checks:**
- Section 4 (Sitemap) — Do NOT recreate pages that already exist
- Section 5 (Roadmap) — Pick tasks from here if backlog exists

### Step 3: Generate with Stitch
Use the Stitch MCP tools to generate the page:

1. **Get or create project**: Use `projectId` from `.stitch/metadata.json` or call `create_project`
2. **Generate screen**: Call `generate_screen_from_text` with the full baton prompt
3. **Retrieve assets**: Download `htmlCode.downloadUrl` → `.stitch/designs/{page}.html`

### Step 4: Integrate into Site
1. Move generated HTML from `.stitch/designs/{page}.html` to `site/public/{page}.html`
2. Fix any asset paths to be relative to the public folder
3. Update navigation — wire placeholder links to the new page
4. Ensure consistent headers/footers across all pages

### Step 5: Update Site Documentation
Modify `.stitch/SITE.md`:
- Add the new page to the Sitemap with `[x]`
- Update Roadmap if you completed a backlog item

### Step 6: Prepare the Next Baton (Critical)
**You MUST update `.stitch/next-prompt.md` before completing.**

```markdown
---
page: next-page-name
---
[Description of the next page to generate]

**DESIGN SYSTEM (REQUIRED):**
[Copy the entire design system block from .stitch/DESIGN.md]

**Page Structure:**
1. ...
2. ...
```

---

## File Structure Reference

```
project/
├── .stitch/
│   ├── metadata.json       # Stitch project & screen IDs
│   ├── DESIGN.md           # Visual design system
│   ├── SITE.md             # Site vision, sitemap, roadmap
│   ├── next-prompt.md      # The baton — current task
│   └── designs/            # Staging area for Stitch output
│       ├── {page}.html
│       └── {page}.png
└── site/public/            # Production pages
    ├── index.html
    └── {page}.html
```

### `.stitch/metadata.json` Schema
```json
{
  "projectId": "4044680601076201931",
  "projectTitle": "My Site",
  "screens": {
    "index": {
      "id": "screen-id-here",
      "dimensions": { "width": 1440, "height": 900 }
    }
  }
}
```

---

## Design System Integration
Always inject the design system block into every Stitch prompt. Copy it directly from `.stitch/DESIGN.md` Section 6 (or whichever section defines the token summary).

## Common Pitfalls
- **Forgetting to update the baton** — the loop dies if `.stitch/next-prompt.md` is not updated
- **Re-generating existing pages** — always check the sitemap first
- **Missing design system in prompt** — always include the full DESIGN.md token block
