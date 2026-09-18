---
name: protocol-reverse
description: "Offline protocol reverse engineering workbench: unknown binary/network protocols, opaque file formats, proprietary message streams. Use when the user asks to reverse, identify, or document an unknown protocol or binary format, when given hex dumps/pcaps/protocol samples, or when a parser/dissector must be produced and validated. Invokes the Sub Reverser Agent when delegation is available."
version: 1.0.0
---

# Protocol Reverse Workbench

A fixed hypothesis-validation workflow for unknown protocols. The core discipline: **understanding is only real when an executable parser replays every sample successfully.** A narrative description of fields is a hypothesis, never a result.

## Workflow (follow in order, do not skip)

1. **Inventory** — list every sample (hex dumps, pcaps, captured streams, code). Note sizes, alignment hints, headers visible to the eye.
2. **Align & measure** — before guessing anything, call the `hex_stats` MCP tool on the sample (it infers the record stride automatically; `scripts/field_stats.py` is the offline fallback):
   - constant offsets → length prefixes, magic numbers, version fields
   - low-entropy offsets → counters, enumerated types, flags
   - high-entropy offsets → payload, compression, checksums
   - If no record length is known, run without `--record-length`: the script autocorrelates candidate strides and reports the best one.
3. **Differential experiments** — vary ONE input at a time and run the `hex_diff` MCP tool on the sample pair; the changed offsets reveal that field. With the workspace terminal you may also send modified payloads to an offline target. A field's meaning is proven by how it changes, not by how it looks.
4. **Format hypothesis** — write the field table: offset, size, endianness, type, meaning, confidence (high/medium/low). Mark guesses explicitly.
5. **Executable parser** — implement the table as a Python or Node script (or a Wireshark Lua dissector when the protocol rides on TCP/UDP and Wireshark is available). Create it inside the assigned lab directory.
6. **Replay validation** — `python scripts/replay_check.py "<parser command> {sample}" <samples_dir>` runs the parser against every sample and reports per-file exit status. Iterate until every sample parses or the failure is explained. When a trailing field breaks replay, call `crc_probe` before inventing explanations.
7. **State machine** — if message types and transitions are visible, summarize the protocol state machine as a Mermaid `stateDiagram-v2` block.

## Lab discipline

- All scripts and artifacts live in the assigned lab directory (create `.yanagent/reverser-lab/` under the workspace if none was assigned). Never modify project source files.
- Offline only: never send network traffic to live endpoints. Samples are files.
- Prefer stdlib-only parsers (no pip installs) so the replay harness runs anywhere.
- Checksums/CRCs: if a trailing field breaks replay, test standard CRC-16/32 variants before inventing explanations.

## Report shape

Sample inventory → Field table (offset, size, type, meaning, confidence) → Experiments run (input → observed output) → Parser path + per-sample validation result → State machine (Mermaid) → Open questions.

## Companion tools

- `hex_dump` / `hex_stats` / `hex_diff` / `crc_probe` — native yan_analysis tools for steps 1-3 and 6.
- `pcap_overview` — tshark-based capture overview when samples are network captures (needs Wireshark installed).
- `ghidra_status` / `ghidra_decompile` — when the protocol lives in a compiled binary and Ghidra is installed (GHIDRA_INSTALL_DIR).

## Delegation

When native subagents are available, dispatch `subagent_type: "reverser"` (Sub Reverser Agent) with the sample paths and the assigned lab directory; it runs this same workflow with write access to the lab. Use `yan_analysis` tools (`repo_map`, `code_outline`, `code_symbol`) first when the "protocol" is implemented in workspace code rather than captured traffic.
