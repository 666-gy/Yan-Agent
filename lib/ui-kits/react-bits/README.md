# React Bits (pre-installed)

Animated React UI components — **local registry only**.

## Agent rules
1. Call `read_ui_kit({ kit: "react-bits", component: "BlurText", variant: "JS-CSS" })` — never MCP-fetch GitHub.
2. Category folders: TextAnimations, Animations, Components, Backgrounds (no spaces).
3. For **static HTML** (.html): adapt JSX logic to vanilla HTML/CSS, or use `uiverse` kit.
4. Variants: JS-CSS (default), JS-TW, TS-CSS, TS-TW.

## Wrong path (404)
`src/content/Components/BlurText/BlurText.jsx` ❌

## Correct path
`src/content/TextAnimations/BlurText/BlurText.jsx` ✓
