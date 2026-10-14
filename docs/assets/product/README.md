# Product screenshot provenance

Captured on 2026-10-06 from current source (package version 1.7.0-beta.2-rc.1) by launching the real Electron app via Playwright with YAN_E2E_MODE=1 and a new temporary YAN_E2E_USER_DATA_DIR. No actual user profile was opened. Light theme, 1440 × 960 viewport. Original PNG files and repeatable capture script are in output/website-reference.

- yan-desktop.webp: genuine initial new-chat surface with default isolated E2E configuration.
- yan-extensions.webp: genuine built-in plugin catalog; no plugins installed by the capture.
- yan-agents.webp: genuine external-agent catalog showing Codex and Claude.
- yan-review.webp: genuine app review surface opened with an illustrative, synthetic src/tasks.js patch through the same API used by the repository E2E tests. This is sample data, not an actual user task.

Images were visually inspected for credentials and private messages; none are present. PNGs were encoded as quality-91 WebP using Pillow. No app chrome was invented or retouched.

## Reference treatment

The homepage layout is measured from https://openai.com/zh-Hans-CN/codex/ on 2026-10-06, following the user's explicit request to reproduce its arrangement with Yan Agent content.

- codex-floral-reference.mp4: the publicly rendered floral background from https://cdn.openai.com/ctf-cdn/floral_a.mp4 (downloaded 2026-10-06, 2,861,214 bytes).
- codex-floral-poster.webp: still at 2 seconds of the above video, resized to 1920px wide using ffmpeg; used for reduced-motion and loading fallback.
- yan-logo-dark.png and yan-logo-light.png: copied from this application's renderer/assets logo files.

The OpenAI background is reference-site media, not original Yan artwork. This source record does not relicense that asset. Product screenshots, product claims and branding are Yan-specific; the website does not claim OpenAI affiliation or copy customer testimonials.
