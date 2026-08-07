---
name: liquid-glass-react
description: Reference and implementation guidance for rdev/liquid-glass-react, Apple's Liquid Glass effect for React.
license: MIT
---

# Liquid Glass React

This is a local reference package for the upstream `rdev/liquid-glass-react`
component. Use it only when the user asks for a Liquid Glass treatment or an
existing React interface needs this specific effect.

Before writing an import, inspect the target project's `package.json`. Do not
assume `liquid-glass-react` is installed and do not install it globally. If the
user has authorized dependency installation, install it in the selected
workspace and keep the existing React and bundler versions authoritative.

Read the bundled source files when implementation details are needed:

- `src/index.tsx`: component API, WebGL lifecycle, props, and rendering.
- `src/shader-utils.ts`: shader and displacement helpers.
- `src/utils.ts`: utility functions used by the component.
- `README.md`: usage, props, browser limitations, and examples.

Keep the effect optional and provide a non-WebGL fallback when the target
browser or project cannot support displacement. Respect reduced-motion and
existing performance requirements. Do not copy the demo application's build
configuration into the user's project.
