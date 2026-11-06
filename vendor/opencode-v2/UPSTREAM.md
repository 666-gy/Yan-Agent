# OpenCode V2 runtime baseline

- Official source: https://github.com/anomalyco/opencode
- Fixed tag: v2.0.27
- Commit: `1f4d07a4a519185955ae8ab2ea3607805509e386`
- License: MIT (see LICENSE)
- Runtime: official signed `node.exe` 26.4.0 + bundled OpenCode 2.0.27 JavaScript and native assets
- HTTP client: `@opencode/client@2.0.27`
- Registry: https://registry.npmjs.org
- Package integrity: pinned in package-lock.json
- Node archive and all 48 delivered files: SHA-256 pinned in runtime.json; all runtime files checked before each launch

Install from the Yan project root with `npm run kernel:v2:install`.
An existing runtime is verified and reused. A missing runtime is built from the
exact upstream commit. Use `npm run kernel:v2:install -- --rebuild` to force a
rebuild; differing output hashes fail installation rather than updating the pin.
The official Node build uses Bun 1.4.2 as a build tool, pinned separately under
build-tools. It is installed only in ignored `.kernel-build/tools`; it is not
part of the runtime or a global installation. Building requires Git and network.
The upstream lockfile is frozen and install scripts are disabled. The Node
download comes from nodejs.org and is checked against the committed archive hash.
The delivered Node retains its valid OpenJS Foundation Authenticode signature.
The build calls the unchanged upstream build-node.ts with --bundle-only and an
empty AppArchive: Yan owns the UI, so OpenCode's bundled website is omitted.
The source checkout under `.kernel-build/source` is disposable build input.
Pinned local patches are documented in `patches/README.md`. Compaction events
retain the actual threshold/overflow trigger and the decision-time context
estimate in metadata; the upstream threshold policy remains unchanged.

Verify with `npm run kernel:v2:check`. Tests launch the Node bundle against
temporary directories and never submit a model-executing prompt.

The dependencies are deliberately installed in this vendor package so the V1
desktop application retains its existing dependency graph while the V2 adapter
is being built. This milestone is a development runtime, not an integrated or
packaged replacement for the desktop backend.

The runtime owns `<dataDir>/opencode-runtime-v2` and uses a private authenticated
loopback server. It does not discover/start/stop the user's global service, run
the old binary patch, or import the old database maintenance code. Its ownership
file contains process IDs only, never credentials. A stale owner file fails
closed and requires inspection; it is never used as permission to kill an
unrelated PID. Unexpected child exits clear this process's owned registration.

V2 plugins configured by local path must be directories with an entrypoint.
Single-file plugin URLs are ignored by this version's configuration source.
The lifecycle test verifies an actual prompt hook, not just plugin inventory.
It also verifies process.versions.node === '26.4.0' and no process.versions.bun,
starts with only System32 on PATH and hostile inherited NODE_OPTIONS, and runs,
resizes and terminates a real Windows PTY child. Upstream's initial PTY API PID
can be 0 because the Windows terminal connects asynchronously; the test verifies
the real PID written by the child, not the initial API PID field.

This is a local build of a stable source tag, not an official stable Node npm
release. The npm Node distribution currently uses beta/dev version identifiers.
Runtime file bytes: 150924565 (including assets and Node license); prior Bun exe:
212824456. This comparison also includes omission of the upstream website and
does not establish an equivalent-feature runtime benchmark. Memory and antivirus
behavior have not been benchmarked or certified. Runtime updates are disabled.
