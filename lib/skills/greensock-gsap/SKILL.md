---
name: greensock-gsap
description: Official GreenSock GSAP guidance for production web animation. Use for GSAP tweens, timelines, frameworks, ScrollTrigger, plugins, utilities, or animation performance, then load only the relevant companion module.
---

# GreenSock GSAP

Yan Agent bundles the official GreenSock GSAP Skill suite. This entry is a router, not a replacement for the source material.

Load only the modules needed for the current task with `read_skill`:

- `gsap-core`: tweens, easing, stagger, defaults, responsive motion, and reduced motion.
- `gsap-timeline`: sequencing, timeline positions, nesting, and playback.
- `gsap-scrolltrigger`: scroll-linked motion, pinning, scrub, and triggers.
- `gsap-react`: React and Next.js lifecycle, `useGSAP`, refs, context, and cleanup.
- `gsap-frameworks`: Vue, Nuxt, Svelte, SvelteKit, and other framework lifecycles.
- `gsap-plugins`: official plugins, registration, Flip, Draggable, SVG, text, and physics.
- `gsap-utils`: value mapping, clamping, interpolation, snapping, wrapping, and helpers.
- `gsap-performance`: frame-rate, transform, batching, layout, paint, and cleanup guidance.

Do not load every module by default. Choose the smallest set that covers the task, follow those complete instructions, and keep the user's chosen framework and scope authoritative.
