---
name: intelligent-ui-creator
description: Express answers and support decisions through compact inline interactive UI.
---

# Intelligent UI

Choose the smallest useful interaction: object → user action → changed state → visible result. In daily mode this is a natural response format; otherwise it is a task capability. Do not produce controls merely to decorate prose. Do not add a separate classifier or generation model.

## OpenUI first

The start response includes the exact current OpenUI contract. Use `format=openui`, `code`, and the official `Stack` root. Compose the catalog's layout, text, form, table, chart and media components. Bind inputs to `$variables`; derive results and views from the same state with local expressions. Prefer local `@Set`/`@Reset` actions. Do not use the historical App/Budget/Choice signatures for new output.

The renderer saves local OpenUI state automatically. It does not send messages or call tools. `handoff=true` adds an optional host button that prepares the selected state in the existing chat draft after the user clicks; it never submits. Only request it when a next conversation step needs the result. Do not add routine completion/save/export toolbars.

Use the answer column's full available width and natural height. Keep the task object, key controls and result close together. Reflow at 320px; preserve readable type and keyboard/touch targets. Support focus, selected, empty, invalid and disabled states. Use the host theme; reduce motion when requested by the OS. Avoid duplicate titles and unnecessary instruction text. Include sources, units, assumptions and estimate labels where they affect interpretation. Wording and visual choices are guidance, not protocol errors.

## Resources and maps

Use existing tools to research data before rendering. Declare resources on every render; omission clears prior grants. `resources.map=true` enables the locally bundled MapLibre adapter and fixed OpenFreeMap resources. `Map(name, places, routes)` uses objects with stable unique ids; places include name, lat, lng, optional detail/image/credit, and routes include label and verified coordinates. All coordinates are WGS84 [latitude, longitude]. Keep OpenFreeMap/OpenMapTiles/OpenStreetMap attribution. It is a viewer and planner, not a route/search service. Without verified road geometry, use routes=[]; never draw invented roads.

Declare up to 12 complete researched HTTPS photo URLs from upload.wikimedia.org, images.unsplash.com or images.pexels.com in resources.images. Retain relevant credit and handle unavailable photos. Closed network permissions remain authoritative. Query, Mutation, arbitrary fetch, remote scripts, backend and filesystem calls are unavailable. An action cannot grant approval, execute work or submit a conversation.

## Custom HTML

Use `format=html` only when the catalog cannot express the needed interaction, for example a physical demonstration, custom scene or playable board. Submit a self-contained HTML fragment with scoped CSS and inline JS. No packages, remote scripts or document wrappers. Host tokens: --ui-bg, --ui-text, --ui-muted, --ui-border, --ui-accent, --ui-surface. Optional ui-controls, ui-field, ui-row and ui-muted classes provide basic HTML layout; custom scoped CSS can override the low-priority foundation layer.

HTML can call window.yanUi.getState() and await window.yanUi.setState(JSON) to retain meaningful choices. Snapshots are limited to 16 KiB, scoped to the panel's task/revision/content and this browser profile. Validate restored data, use defaults, handle false/rejected saves, and do not store secrets or markup. window.yanUi.createMap(element,{markers,routes,onSelect}) provides the same granted map; markers use lat/lng/label and routes use WGS84 coordinates. Check window.yanUi.capabilities.map before using it.

## Delivery

Use the same Creator and task_id for start/render. One panel per turn; later render replaces its revision. Research first, check representative calculations and the main interaction, then render. Tool success confirms delivery, not correct calculations or browser verification. Keep the final answer concise and independently understandable. Do not link HTML files or open a separate browser. If rendering fails, fix the specific error once or provide a usable text answer.
