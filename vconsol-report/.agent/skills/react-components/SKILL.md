---
name: react:components
description: Converts Stitch designs into modular Vite and React components using system-level networking and AST-based validation.
allowed-tools:
  - "stitch*:*"
  - "Bash"
  - "Read"
  - "Write"
  - "web_fetch"
---

# Stitch to React Components

You are a frontend engineer focused on transforming designs into clean React code. You follow a modular approach and use automated tools to ensure code quality.

## Retrieval and Networking

1. **Namespace discovery**: Run `list_tools` to find the Stitch MCP prefix.
2. **Metadata fetch**: Call `[prefix]:get_screen` to retrieve the design JSON.
3. **Check for existing designs**: Before downloading, check if `.stitch/designs/{page}.html` and `.stitch/designs/{page}.png` already exist:
   - **If files exist**: Ask the user whether to refresh or reuse the existing local files.
   - **If files do not exist**: Proceed to download.
4. **High-reliability download**:
   - **HTML**: `bash scripts/fetch-stitch.sh "[htmlCode.downloadUrl]" ".stitch/designs/{page}.html"`
   - **Screenshot**: Append `=w{width}` to the screenshot URL first, then run the same script.
5. **Visual audit**: Review the downloaded screenshot to confirm design intent and layout details.

---

## Architectural Rules

- **Modular components**: Break the design into independent files. Avoid large, single-file outputs.
- **Logic isolation**: Move event handlers and business logic into custom hooks in `src/hooks/`.
- **Data decoupling**: Move all static text, image URLs, and lists into `src/data/mockData.ts`.
- **Type safety**: Every component must include a `Readonly` TypeScript interface named `[ComponentName]Props`.
- **Style mapping**:
  - Extract the `tailwind.config` from the HTML `<head>`.
  - Sync these values with `resources/style-guide.json`.
  - Use theme-mapped Tailwind classes instead of arbitrary hex codes.

---

## Execution Steps

1. **Environment setup**: Run `npm install` if `node_modules` is missing.
2. **Data layer**: Create `src/data/mockData.ts` based on the design content.
3. **Component drafting**: Use `resources/component-template.tsx` as a base. Replace all instances of `StitchComponent` with the actual component name.
4. **Application wiring**: Update the project entry point (`App.tsx`) to render the new components.
5. **Quality check**:
   - Run `npm run validate <file_path>` for each component.
   - Verify against `resources/architecture-checklist.md`.
   - Start the dev server with `npm run dev` to verify the live result.

---

## File Structure

```
src/
├── components/
│   ├── Header/
│   │   ├── Header.tsx
│   │   └── Header.test.tsx
│   └── ...
├── hooks/
│   └── useFeature.ts
├── data/
│   └── mockData.ts
└── App.tsx
```

## Troubleshooting

- **Fetch errors**: Ensure the URL is quoted in bash commands to prevent shell errors.
- **Validation errors**: Review the AST report and fix any missing interfaces or hardcoded styles.
