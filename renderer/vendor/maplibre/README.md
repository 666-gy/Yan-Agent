# MapLibre for Intelligent UI

MapLibre GL JS 5.24.0 from the official npm package `maplibre-gl@5.24.0` (BSD-3-Clause).
Package SHA-1: `a8059371cdbeb04a62850ccc22cb37783928a10d`.

The v5 UMD distribution supports execution as a local inline script. `intelligent-ui-maplibre.js` stores upstream JavaScript and CSS as inert strings. The renderer loads this file only for an approved map resource, then supplies it to the opaque sandbox, where the map library and its local Blob worker execute. No remote scripts or stylesheets are executed.

The fixed OpenFreeMap Positron service supplies map data, sprites and glyphs. Public use requires no API key; keep the map attribution visible.
- https://openfreemap.org/
- https://openfreemap.org/quick_start/
