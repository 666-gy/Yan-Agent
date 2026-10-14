---
name: intelligent-ui-creator
description: Create compact task-specific mini-apps inside Yan chat so users can make choices, practice actions and complete plans without switching software.
---

# Intelligent UI Creator

Build a small working application for the user's current task. The user should be able to do something useful here and keep the result: choose a room palette, assemble a plan, compare saved options, or practice a sequence. A good mini-app removes a concrete reason to switch to another app. The number of controls or amount of illustration does not establish that benefit.

The Creator start call has already opened a place in the answer. Now choose the smallest useful workflow and implement it. Do not add another planning phase, tool or application scaffold.

## Start with the work

Briefly decide internally: **object → action → state → feedback → completion**. What does the user work on, what can they do to it, what changes, how is that change visible, and what useful outcome can they leave with? This is a design check, not extra fields or a visible questionnaire.

Choose a coherent, achievable scope. If the available data or geometry only supports one part of a task, name that part accurately. Use confirmed data, label estimates or concept previews, and keep necessary task-specific limitations near the relevant action.

Examples of the intended behavior:

- **Room palette:** a room preview is the main workspace. Recommended swatches actually recolor walls/furnishings, selections remain visible, and the user can retain and compare a choice. A list of color names beside an unchanged room misses the task. An SVG concept room is useful when labeled as a concept, without implying it previews the user's actual room or exact paint appearance.
- **Bicycle assembly or origami:** show the current object state and the next physical action. Step, replay and reverse controls reveal movement, contact points, fold lines or orientation changes; each step starts where the preceding one ended. Keep the current instruction short. A finished object with tabs that only replace paragraphs does not teach the operation. Demonstrate a verified subassembly or folding sequence rather than inventing mechanics to fill a course.
- **Places and routes:** use a compact map as the workspace. Selecting a marker or route changes its highlighted geometry and the nearby photos/details; users can keep places or a chosen plan. Relevant researched photos help users recognize and compare places. Transport text boxes and dropdowns alone leave the spatial task undone. Use the host map capability below instead of drawing a pretend street map.
- **Planning:** users select, arrange or adjust actual items; totals, constraints and conflicts respond to edits. Retain the chosen arrangement and provide an actionable result. A checklist that changes only its checkmarks is sufficient only when tracking that checklist is itself the requested work.

The main surface should be the room, parts, board, map, calendar, selected items or other task object. SVG, canvas, forms, tables and text are implementation choices. Use the form that lets users operate on that object; do not add diagrams or toggles just to make an answer interactive.

## Compact application design

Fit into the conversation column: the mini-app root should fill the available width (width:100%, min-width:0, max-width:100%). The host already controls the answer width; do not add a fixed pixel max-width to the app root. Individual task objects may preserve their aspect ratio within that full-width surface. Aim for an initial desktop height around **320–480px** when the task permits. These are design budgets, not fixed clipping heights. Reduce duplicate headings, large margins, repeated descriptions and secondary controls before reducing the workspace or type size. Narrow screens may be taller; reflow at 320px without horizontal page overflow or tiny scaled text.

Make the first view immediately usable: the working object, its main controls and the current result/progress. Reveal settings, explanations and secondary actions on demand. The host already shows a title; avoid another hero heading or marketing introduction. Keep labels, units, current-step instructions, errors and meaningful limitations; remove text that merely explains an obvious button.

Use **pill buttons for text actions and round buttons for icon actions or swatches**. Provide clear selected, focus, disabled and pressed states. Give icon-only controls accessible names. Keep touch targets comfortable even when visible icons are small. Bounded surfaces, borders, backgrounds and grouped controls are welcome when they make a coherent mini-app; the host does not mandate transparent internals or a card template.

Keep controls near their effect. Support keyboard operation and valid/empty states. Make changes visible through the object or outcome, not only a toast or paragraph. Animate physical actions when movement explains them; provide step/replay controls, respect reduced motion and preserve a comprehensible static step. Use color with labels or shape and verify legibility in both themes.

## State and a useful ending

The task result can be the interaction itself. Do not attach a standard completion toolbar to every app. A palette changes on swatch selection and remembers that selection automatically; it does not need another Choose this, Save or Generate summary button. Keep separate commit controls only when preview and commitment genuinely differ, such as adding a place to an itinerary. Do not show a persistent saved-status sentence after every click.

Only offer export or a result summary when the user requested one or needs it for a concrete next step. Prefer a small optional disclosure over an always-visible output box. Display read-only results as text/output, not a scrollable textarea. Textareas are for editing. Let the document use its natural content height; avoid root height/min-height:100vh and fixed-height overflow:auto app shells inside the chat iframe. The chat handles page scrolling; bounded scrolling belongs only to genuinely long task lists.

The host exposes a small local state API before your script runs:

```js
const saved = window.yanUi.getState(); // synchronous JSON snapshot clone, or null
// Validate the saved shape and apply defaults before using it.
const kept = await window.yanUi.setState({
  version: 1, selectedPalette, savedChoices
}); // true after persistence; false if unavailable or timed out
```

Persist only the small JSON data needed to resume the task: selected options, edited values, saved alternatives or learning progress. The limit is **16 KiB per panel snapshot**; invalid or oversized values reject the promise. Handle failures without losing the live interaction or claiming the choice was saved.

State is restored when the same panel revision/content is reopened in this Yan browser profile. A new render revision starts fresh; this is not cross-device sync or permanent archival storage. Save after meaningful changes, not every animation frame. Reconstruct views from data; do not save DOM, generated HTML, large assets, timers or secrets. Use this API instead of localStorage, which is unavailable in the sandbox.

Keep the current selection/result visible and distinguish changing a preview from keeping a choice. Add undo, reset or comparison only when it serves the task. For a multi-step lesson, preserve the current step and completion state without automatically restarting playback on restore.

When the task explicitly needs a result carried into a next conversation step, offer a concise result summary on demand. Otherwise omit it. The local API does **not** notify the model, send a message, grant approval or execute work. Do not label an action “sent to Yan”, “ordered” or “applied” when it only changes local state. No automatic chat submission or clipboard API is provided.

## Runtime and styling

### Choose the rendering path

The Creator supports two paths. Prefer **format=openui** when its registered components directly perform the task: Trip for a real map and an ordered retained itinerary, Budget for quantities and live totals, Choice for persistent option selection. The start response includes the exact OpenUI Lang component signatures and example. Return code, not HTML, for this path. The local host bundles the MIT OpenUI parser/React renderer and Yan components; no Thesys Gateway, separate API key or extra model call is needed.

Use the contract's App root and compose only the components that help. OpenUI code supports literals, component constructors and references; Query, Mutation, dynamic expressions, external tools and arbitrary JavaScript are unavailable. Registered components own interaction logic, validate restored state and save choices. The host omits **带回对话** by default. Only set handoff=true on an OpenUI render when the result is needed for a concrete next conversation step; its button appends to the draft without sending. Declare resources on every render as usual, including map=true for Trip. Without verified route geometry, supply an empty routes array and keep the useful place planner.

Use **format=html** with html for interactions that do not fit this library: playable boards, physical folding/assembly, custom visual previews or other task-specific mini-apps. OpenUI is not a reason to reduce these to text selectors. The HTML runtime and design guidance below remain available; an omitted format retains the existing HTML behavior.

Deliver a self-contained HTML fragment with a unique root ID, scoped CSS and explicit element references. Inline SVG/canvas and inline JavaScript work. No document wrappers, Markdown fences, dependencies, remote scripts, arbitrary fetch/XHR, filesystem access or backend APIs. Fixed OpenFreeMap map resources and declared photos are the only remote-resource exceptions. Use the map API rather than writing your own network calls. Do not assume d3, lucide, window.openai or DOM IDs as JavaScript globals. Use only the documented window.yanUi APIs; the host handles size reporting.

Foundation styles live in the low-priority `yan-foundation` CSS layer. Ordinary scoped CSS overrides them without !important. Optional theme tokens: `--ui-bg`, `--ui-text`, `--ui-muted`, `--ui-border`, `--ui-accent`, `--ui-surface`, and `--ui-series-1` through `--ui-series-6`. Use these or readable local light/dark colors. Fonts must be local; system-ui is the fallback. Optional `ui-controls`, `ui-field`, `ui-row`, `ui-muted` and `ui-number` classes provide layout/type conveniences, not a required design system. Historical `ui-grid`, `ui-stat` and `ui-value` classes remain for compatibility.

## Maps and researched photos

Gather the data before rendering, using available search tools and `yan_web` tools such as `fetch_text` and `list_page_assets` for known source pages. The panel cannot search the web. Use actual place coordinates and photo URLs found in research; check that a photo depicts the named place and preserve its source/required credit. Do not invent URLs, use a generic stock image as a named landmark, or draw fictional roads to fill missing data.

Declare resources **on each render**, alongside `task_id` and `html`:

```json
{"action":"render","resources":{"map":true,"images":[]}}
```

Populate `images` with up to **12 complete researched HTTPS URLs**, at most 2048 characters each, from `upload.wikimedia.org`, `images.unsplash.com` or `images.pexels.com`. Other photo hosts are currently unsupported. URLs cannot contain credentials, non-443 ports or fragments. Use the declared URLs as given; the host CSP limits image origins/paths but does not enforce byte-for-byte query-string equality. Omitted resources clear the previous grants. Saved network permission must allow access; do not work around a denial.

`window.yanUi.capabilities.map` reports whether map support is available. When enabled, call:

```js
const map = window.yanUi.createMap(containerElement, {
  center: [latitude, longitude], // optional; without this the map fits the data
  zoom: 13,                     // optional, 1–19
  markers: [                    // up to 100
    { id: 'place-1', lat: latitude, lng: longitude, label: placeName }
  ],
  routes: [                     // up to 20, at most 2000 coordinates total
    { id: 'route-1', coordinates: verifiedRouteCoordinates, label: routeName,
      color: '#2767bb', dashed: false }
  ],
  onSelect: ({ type, id }) => showSelectedDetails(type, id)
});
// Route coordinates are arrays of [latitude, longitude]. IDs are unique across both collections.
map.select('place-1'); // highlight/focus and call onSelect once if selection changed
map.fit();            // fit all supplied places/routes
// map.destroy();     // dispose before replacing the map with different data
```

Inline the researched data and implement `showSelectedDetails` in your fragment. Map clicks and nearby photo/place buttons should share this selection: have buttons call `map.select(id)` and update the visible details, selected button and saved choice from `onSelect`. Restore a validated saved ID using `select`, or select the first available place. Do not call `select` recursively from its callback. Keep photos and brief details near the map; secondary route instructions can expand on demand. The map height defaults to **260px**, adjustable with `--yan-map-height` on its container. Keep OpenFreeMap, OpenMapTiles and OpenStreetMap contributors attribution visible.

All coordinates use **WGS84, latitude then longitude** (latitude within ±85, longitude within ±180). GeoJSON commonly uses the reverse order. Amap/高德 coordinates commonly use GCJ-02; do not place them on this base map without a verified conversion. The host supplies locally bundled MapLibre GL JS with the fixed OpenFreeMap Positron style (`https://tiles.openfreemap.org/styles/positron`); its style, tiles, fonts and sprites load only from `tiles.openfreemap.org`. It supplies **no** geocoding, routing, transit search, live traffic, travel times or turn-by-turn navigation. Draw a route only from verified route geometry; if that is unavailable, show verified places only and briefly state that a route has not been calculated. A straight connector is not a drivable route. When map data or service is unavailable, keep the useful selection and honest limitation; do not imply that a text comparison is a working navigation app.

Render declared photos using normal `<img>` elements; `crossorigin="anonymous"` and `referrerpolicy="no-referrer"` are recommended. Set a useful `alt`, bounded aspect ratio and an error handler that removes the broken image or shows a compact unavailable state. An accepted URL is a loading permission, not a guarantee that a remote image or its CORS policy will work. Remote scripts, arbitrary tile providers and general network requests remain unavailable.

## Check the journey and deliver

Before render, walk through the actual user journey: start with defaults, perform the main action, observe a correct state change, keep a useful result, and resume it. Check representative calculations and boundaries; for physical sequences check continuity and truthful scope. Look for overflow, unreadable labels, dead controls or an outcome that still requires finding another tutorial to understand the demonstrated action. Do not claim browser or visual testing unless performed.

Call the same Creator with `action=render`, the current `task_id`, `html` and any needed `resources`. Reuse it for corrections. Do not write a file or open a browser as the deliverable. Success confirms delivery, not correctness or design quality. Keep final prose brief and independently understandable; let the mini-app carry the interaction.
