---
name: domml-creator
description: Create and install a Domml desktop companion for Yan Agent, including functional widgets and live data displays; works in Blank without a workspace.
---

# Domml-Creator

Create a pet the user can select in Yan Agent's 宠物 page. Use Yan's own media and pet tools; never install into Codex, another application's pet directory, or the source tree.

## Functional companions and live data

Pets can serve practical purposes: account balance, live counters, service status and similar displays. Do not reject a functional request as entertainment-only or claim that all pet networking is forbidden. Normal browser, search and network tools remain available when exposed and authorized for the task; use them to inspect the service's documentation and confirm its data API.

For a data-first companion, use `layout: "web"` when custom layout, icons, text, thresholds or interactions are requested. Use `layout: "widget"` only when the fixed built-in value display meets the request. Neither needs an image model, PNG or sprite sheet. Artwork is optional when the user's primary goal is functionality.

`yan_skills_install_pet` accepts `data_source` with a verified HTTPS JSON GET `url`, `value_path` (an array of field names), optional `label`, `prefix`, `suffix`, `decimals`, and `interval_seconds` (15–86400, default 60). It works with widget, static and sprite layouts. The host polls the endpoint and displays the scalar value; the desktop supports manual refresh and retains the last successful value with an error status when updates fail.

For numeric fields, `multiplier` converts units (default 1). Optional `subtract_source: { url, value_path, multiplier }` subtracts another verified endpoint's numeric field using the same connection authentication. Displayed value is `primary * multiplier - secondary * secondary.multiplier`, then formatted with `decimals`. This supports total-minus-used balances without generating replacement images or an external scheduled script. Verify the service's units and formula before choosing these fields.

For account APIs using Bearer authentication, supply the existing Yan `connection_id`. The host resolves the key in memory and only sends it to the connection's exact HTTPS origin; never put keys in URLs, descriptions, artwork or pet packages. Do not confuse model API keys with dashboard login credentials: verify which credential the balance endpoint needs. If an endpoint needs browser cookies or another unsupported authentication mechanism, explain that specific gap and obtain the needed interface details rather than inventing an endpoint or claiming a blanket network ban.

Example shape only (this is NOT a known Weason endpoint): `data_source: { url: "https://service.example/verified-balance-endpoint", value_path: ["data", "balance"], connection_id: "existing-connection-id", label: "Balance", prefix: "$", decimals: 2, interval_seconds: 60 }`.

## Custom frontend

`layout: "web"` accepts `frontend: { html, css, js, width, height }`. HTML may be a full document or fragment; CSS and JavaScript are bundled text, up to 512 KiB combined. Dimensions are integers from 100 to 800 CSS pixels (defaults 280 by 180); user scale applies to the whole frontend. Use inline SVG icons or data-URL images/fonts; bundle dependencies into the provided code rather than linking external scripts or styles. No workspace or host-source edit is required.

The frontend owns all visible content, including header, icon, balance row, conditional footer, buttons and whether timestamps appear. It runs JavaScript in an isolated sandbox and exposes `window.yanPet.onData(callback)`, `onConfig(callback)`, `onState(callback)` (each returns unsubscribe), plus `refreshData()`, `startDrag()`, `stopDrag()`, `openTask()` and `close()`. Implement drag on a suitable header with pointerdown/startDrag and pointerup/pointercancel/stopDrag; use refreshData on a refresh button. Do not claim that the UI is limited to manifest labels or fixed rows.

`onData` receives `{ value, text, status, updatedAt, error, petId }`. On ready, `value` is the scalar after any numeric conversion/subtraction and `text` is formatted. Loading/error events do not contain a new value; keep the last successful display. Example: `yanPet.onData(d => { if (d.status !== 'ready') return; document.querySelector('#amount').textContent = d.text; document.querySelector('#footer').textContent = d.value < 5 ? 'Balance low' : 'Balance sufficient'; });`. Display timestamps only if the user requests them. Credentials stay in host data_source requests; frontend scripts have no Node, filesystem or parent access. External networking uses the host data_source bridge; browser cookie login and mutating requests are not yet supported.

## Creation

- Follow the user's character and style brief. If they only say “帮我做一个宠物”, ask one short question about their preferred character or propose a concrete character for them to choose. Do not silently copy an existing pet.
- When artwork is requested, use `yan_media_generate_image`. If no image model is configured, explain what is missing for artwork; functional widget publication still works. No workspace is required: media generation and pet publication use Yan-owned storage.
- For an animated pet, request a transparent PNG sprite sheet with exactly 8 equal columns and 9 equal rows, no text, borders, labels or grid lines. Each cell must contain the same complete character, at consistent scale and baseline, with room for extremities. Use `aspect_ratio: "3:4"` and describe the 8 × 9 grid in the prompt; the renderer normalizes each cell to its display size. The tool chooses supported model dimensions, so do not invent a width/height parameter.
- Rows in order: idle (6 frames), run right (8), run left (8), wave (4), jump (5), failed (8), wait (6), active (6), review (6). Unused trailing cells repeat the last valid pose. Keep transitions coherent and the background transparent. The first row is used by the settings preview.
- Verify the grid, transparency and consistent character with `yan_media_read_image`, passing `generated_image_id` from the generation result's `meta.generatedImageId` and a question about the 8 × 9 layout and frame alignment. This is a required functional spritesheet check. Revise with `source_asset_id` if alignment or transparency is wrong; after two unsuccessful corrections, explain the issue and ask how to proceed. If visual verification is unavailable, report that limitation instead of presenting an unverified sheet as working animation.
- A static character is supported through `layout: "static"` if the user asks for a static pet, or accepts it as an alternative. Do not silently downgrade animation.

## Install and finish

Call `yan_skills_install_pet` with `name`, a short `description`, and the selected `layout`. For `web`, pass `frontend` and optional `data_source`, omitting artwork. For `widget`, pass `data_source` and omit artwork. For `sprite` or `static`, pass `source_asset_id` containing the generated PNG asset id (or `png_base64` for a valid prepared PNG), and optionally `data_source`.

The tool validates data binding and, when artwork is supplied, basic PNG dimensions/format. It creates a unique pet directory and publishes it atomically into YanData/pets. It does not validate artistic quality or every frame, so perform the visual check when artwork is used. The app watches this directory and refreshes the pet page automatically. Do not edit configuration files or request a workspace for installation.

After success, call `yan_skills_list_pets` and confirm the returned pet id is present. Report the pet's name and that it is now selectable in 设置 → 宠物. Do not claim it is selected or visible on the desktop unless verified. The runtime provides scaling and the bridge commands for dragging and focusing. For web pets, wire those commands to your UI; image pets already have those interactions built in.
