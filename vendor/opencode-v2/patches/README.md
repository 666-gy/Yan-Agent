# Yan runtime fixes

Base: OpenCode v2.0.27, exact commit in `../runtime.json`.

`compaction-diagnostics.patch` preserves the actual `auto`, `overflow`, or
`manual` trigger in event metadata (`yanContext`), together with the kernel's
measured and estimated token counts, effective threshold, and context window.
It does not change the threshold gate or the public auto/manual protocol.
Started and completed events carry the metadata; completed checkpoints retain
it for diagnosis. `test/kernel-v2-compaction-flow.test.cjs` exercises the shipped
bundle against a local provider to check below-threshold behavior, threshold
crossing, overflow recovery, and post-compaction context reads.

`shell-settlement.patch` delays the in-memory settled flag until the durable
Tool.Success event is published. If JSON validation/publication fails, the tool
remains eligible for terminal error compensation. Failed error publications
also remain unsettled. The runner propagates result publication failures
instead of reporting a successful turn; ordinary tool errors remain available
to the model for correction and continuation.

The patch includes a regression test for failed durable publication. Yan's
`test/shell-result-contract.e2e.cjs` additionally runs the shipped Node bundle,
checks SQLite terminal tool state and the next model request, and injects invalid
metadata through an isolated fixture plugin to verify compensation.

The patch hash and shipped bundle hash are pinned in `../runtime.json`.
`scripts/install-kernel-v2.cjs --rebuild` verifies the base and patch before
building; tracked changes beyond this patch are rejected. Bun is a build tool
only; the delivered runtime remains Node.
