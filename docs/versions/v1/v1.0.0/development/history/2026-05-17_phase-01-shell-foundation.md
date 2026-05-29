# Session history -- v1.0.0 Phase 1: Tauri desktop shell foundation

**Date**: 2026-05-17
**Phase**: 1 of 11 (Nexus v1.0.0 cycle)
**Plan**: [docs/versions/v1/v1.0.0/plans/phase-01-shell-foundation.md](../../plans/phase-01-shell-foundation.md)
**Plan parent**: [docs/versions/v1/v1.0.0/plans/v1.0.0-cycle.md](../../plans/v1.0.0-cycle.md)
**Cycle brief**: [docs/versions/v1/v1.0.0/pivot-brief.md](../../pivot-brief.md)

---

## Goal

Stand up the `nexus-shell` Tauri desktop application -- sidebar + 2x2 dashboard cards + Local Model Status placeholder -- prove the IPC contract to a Node sidecar, and codify the dark-theme design tokens that every later phase will consume.

## Outcome

All 8 sub-tasks completed. 52 / 52 unit tests passing. Coverage: lines 99.11%, functions 100%, branches 87.21%. Lint clean, typecheck clean.

The phase ships:

- A `desktop/` npm workspace (Tauri 2.x Rust core + Vite + React 19 + TypeScript frontend + Node sidecar bundled with esbuild).
- Design tokens (dark surfaces, four foreground tones, four module accents with soft variants, four semantic colors, eight-stop spacing, four type scales, four radius tokens, three shadows) at `desktop/src/styles/tokens.css`; documented at `docs/versions/v1/v1.0.0/design-tokens.md`; visually inspectable at `/_styleguide`.
- A permanent left sidebar with five primary nav entries (color-coded), visually-isolated Settings + Profile, `Ctrl+1..4` + `Ctrl+,` keyboard shortcuts, `localStorage` route persistence.
- A 2x2 dashboard grid of `<ModuleCard>` components, top bar with title + search + bell + gear, first-name greeting, Recent Projects mock list, the always-visible Local Model Status widget, and the two bottom-right FABs (sparkle + help).
- A reusable `<LocalModelStatus>` widget with `muted` / `loading` / `active` states driven by a `TelemetryStream` contract.
- A Node sidecar speaking JSON-RPC 2.0 over stdin/stdout, declaring eight v1.0.0 methods (`ping`, `models.list`, `models.install`, `coding.startTask`, `image.generate`, `video.generate`, `skills.sync`, `telemetry.subscribe`); only `ping` is implemented this phase, the rest throw `NotImplementedError` with code `-32601`.
- A `.github/workflows/shell-build.yml` cross-platform matrix (windows-latest / macos-latest / ubuntu-latest) running lint + typecheck + vitest with coverage + sidecar bundle + `cargo check` / `cargo clippy --all-targets -- -D warnings` / `cargo test` / vite build.

## Sub-task by sub-task

### 1.1 -- Tauri workspace scaffolding

Created `desktop/` with:

- `desktop/package.json` (workspace member `@nexus/desktop@1.0.0-alpha.0`, npm scripts for dev/build/test).
- `desktop/tsconfig.json` (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, paths alias `@/* -> src/*`).
- `desktop/vite.config.ts` (port 1420 strict-port; HMR ws-tunnelled when `TAURI_DEV_HOST` is set).
- `desktop/src-tauri/Cargo.toml` (`nexus-shell` crate, Tauri 2.1, tokio, thiserror; release profile with LTO + panic=abort + strip).
- `desktop/src-tauri/tauri.conf.json` (1440x900 / 1280x800-min, force-dark, identifier `ai.nexus.shell`, CSP `default-src 'self'`).
- `desktop/src-tauri/src/main.rs` -- 1-line entry binary.
- `desktop/src-tauri/src/lib.rs` -- builder, `AppState`, `ipc_call` Tauri command, force-dark on every webview, sidecar spawn on setup + shutdown on `RunEvent::Exit`.
- `desktop/src-tauri/build.rs` -- standard `tauri_build::build()`.

Root `package.json` registers the workspace and exposes `npm run dev:shell` / `build:shell` / `lint:shell` / `test:shell` / `test:shell:coverage`.

### 1.2 -- Design tokens

- `desktop/src/styles/tokens.css` -- every token as a CSS custom property on `:root`. Force-dark on `html, body`.
- `desktop/src/styles/globals.css` -- imports `tokens.css`; adds a handful of utility classes (`.nx-stack`, `.nx-row`, `.nx-grow`, `.nx-divider`, `.nx-card`) used until Tailwind v4 lands in Phase 2.
- `docs/versions/v1/v1.0.0/design-tokens.md` -- token reference with hex values, intended use, change-log table.
- `desktop/src/pages/Styleguide.tsx` -- visible inspection page rendered at `/_styleguide` with swatches for every surface / fg / accent / status token plus radius samples.

### 1.3 -- Sidebar

`desktop/src/components/Sidebar.tsx`:

- Top: Sparkles + "Nexus" wordmark (Sparkle color matches the active module accent).
- Four primary `<NavLink>` entries with their module-accent left border when active and the module's icon in the matching accent.
- A thin `.nx-divider`.
- Two admin entries (Settings, Profile) visually isolated at the bottom.
- `Ctrl+1..4` switches modules, `Ctrl+,` opens settings. Input-focus guard via `(e.target as HTMLElement).tagName` to avoid stealing keystrokes from text inputs.
- Active route is written to `localStorage` via `desktop/src/lib/persistence.ts`; the entry point (`desktop/src/main.tsx`) reads it on launch and `replaceState`s the URL before React mounts.

### 1.4 -- Dashboard 2x2 cards

`desktop/src/pages/Dashboard.tsx` mirrors the pivot-brief mockup:

- Top bar: title text, disabled search field, bell with red-dot badge, gear button -> `/settings`.
- Welcome line, first name from `desktop/src/lib/profile.ts` (Zod-validated; falls back to "User" on miss / invalid JSON / schema mismatch).
- `<ModuleCard>` grid -- one card per pillar: Coding, Chatbot, Image Studio, Video Lab. Each card has a Lucide icon, the canonical label, a subtitle, a two-line body, a CTA button that `useNavigate()`s, and a preview slot.
- Recent Projects list (mock data; real data lands when ChatHistoryStore is exposed via the Coding module in Phase 3).
- The `<LocalModelStatus>` widget (driven by the App-level stream).
- Sparkle + help FABs bottom-right.
- A dev-only "Ping sidecar" button (`data-testid="dashboard-ping"`) -- shown in dev builds and exercised by `Dashboard.test.tsx`.

`desktop/src/components/ModuleCard.tsx`:

- Single parameterized component driven by `moduleId`. The descriptor (`MODULES[moduleId]`) supplies the canonical label and the accent var, so the four cards share one implementation.
- Grid layout: header (icon + title + subtitle) over body over CTA, with the preview slot occupying the right two rows.

### 1.5 -- Node sidecar + IPC contract

- `desktop/sidecar/src/protocol.ts` -- `IPC_METHODS` const tuple, `Method` union, Zod schemas for `PingRequest` / `PingResponse`, `NotImplementedError` with code `-32601`, `isMethod` guard.
- `desktop/sidecar/src/handlers.ts` -- handler registry. `ping` returns `{ok: true, pid, version, platform}`; every other declared method throws `NotImplementedError`. `dispatch(method, params, ctx)` validates the method exists, parses the request with the schema, and invokes the handler.
- `desktop/sidecar/src/main.ts` -- entry point. Reads JSON-RPC 2.0 messages from stdin line-by-line, dispatches, writes `{jsonrpc: "2.0", id, result | error}` to stdout. `SIGTERM` / `SIGINT` cleanly exit.
- `desktop/src-tauri/src/sidecar.rs` -- spawns `desktop/sidecar/dist/main.js` (resolved either through `app.path().resolve(..., Resource)` in prod or via a dev-fallback walk through the workspace), holds a `pending: Arc<Mutex<HashMap<u64, oneshot::Sender>>>` map, a background thread reads stdout line-by-line and routes responses by `id`. `request()` uses a tokio `oneshot` with a 15 s timeout. `shutdown()` drops stdin and kills the child cleanly.
- `desktop/src/lib/ipc.ts` -- thin frontend wrapper that goes through `invoke('ipc_call', ...)`. Guards the Tauri runtime detection on `window.__TAURI_INTERNALS__` / `window.__TAURI__` so the same module can be unit-tested in jsdom without a Tauri host. A `setInvokeOverride` seam lets tests inject a fake invoke.

### 1.6 -- LocalModelStatus

- `desktop/src/components/LocalModelStatus.types.ts` -- `LocalModelTelemetry` interface and `TelemetryStream` contract.
- `desktop/src/components/LocalModelStatus.tsx` -- three states (muted / loading / active), GPU bar with width clamped to 0..100, color coded green / amber / red at 70 / 85% thresholds.
- `desktop/src/lib/telemetryMock.ts` -- deterministic placeholder stream (default 2 s interval) used by the App until Phase 8 wires real NVML / `nvidia-smi`.

### 1.7 -- CI

`.github/workflows/shell-build.yml`:

- Triggers: PRs and main pushes touching `desktop/**` or the workflow file.
- Matrix: `[windows-latest, macos-latest, ubuntu-latest]`.
- Steps: install Linux Tauri prerequisites (webkit2gtk, xdotool, ayatana, librsvg, etc.) on the Ubuntu leg; Node 22 + npm cache; stable Rust toolchain via `dtolnay/rust-toolchain@stable`; cargo registry + target cache keyed on `Cargo.toml`; `npm ci`; `npm run lint`; `npm run typecheck`; `npm run build:sidecar`; `npm run test:coverage`; `cargo check --all-targets`; `cargo clippy --all-targets -- -D warnings`; `cargo test --all-targets`; `npm run build:web`; upload coverage from the Ubuntu leg.

### 1.8 -- Tests and stabilization

Ten Vitest files (52 cases) plus four Rust unit tests in `sidecar.rs`:

| File | Cases | Surface |
|---|---|---|
| `tests/Sidebar.test.tsx` | 8 | entries, active accent, persistence, every `Ctrl+digit`, input-focus guard, unmapped digit |
| `tests/ModuleCard.test.tsx` | 3 | header / body / CTA / preview, click navigates, all four variants |
| `tests/Dashboard.test.tsx` | 9 | grid renders, profile fallback + override, gear nav, CTA nav, telemetry wiring, ping happy + error paths, bell + FABs |
| `tests/LocalModelStatus.test.tsx` | 6 | muted, loading, active sample + re-render, GPU% clamping, mock stream timer behaviour |
| `tests/ipc.test.ts` | 4 | unavailable, success, Error rejection, non-Error rejection |
| `tests/sidecar-handlers.test.ts` | 5 | ping shape, unknown rejection, every unimplemented method throws, `isMethod` exhaustive, handler map complete |
| `tests/persistence.test.ts` | 4 | round-trip, miss, write-fail swallow, read-fail swallow |
| `tests/profile.test.ts` | 4 | default, round-trip, invalid JSON, schema mismatch |
| `tests/modules.test.ts` | 3 | descriptor shape, canonical order, guard |
| `tests/App.test.tsx` | 6 | shell mounts, every route, styleguide tokens render, placeholder fallback |

Rust unit tests in `desktop/src-tauri/src/sidecar.rs` cover the script-path fallback walk, JSON-RPC request serialization, response-with-result parse, response-with-error parse.

## Troubleshooting log

1. **Vitest setup file silently not loaded.** First run reported "Invalid Chai property: toBeInTheDocument" -- a sign that `@testing-library/jest-dom` matchers were not extending `expect`. Root cause: relative path `./tests/setup.ts` in `setupFiles` was not resolving against the workspace cwd on Windows when invoked through `npm run --workspace`. Fix: use `path.resolve(__dirname, "./tests/setup.ts")`. Setup duration jumped from 0.4 s to 4.7 s confirming the file is now executed.
2. **IPC unit test reporting "Cannot read properties of undefined".** The Tauri API package is installed in `node_modules` so `await import("@tauri-apps/api/core")` resolved cleanly in jsdom but `invoke()` threw because the Tauri host was absent. Fix: gate `resolveInvoke()` on `tauriRuntimeAvailable()`, which checks `window.__TAURI_INTERNALS__` / `window.__TAURI__`. This is the supported Tauri 2.x detection path and matches what the official docs recommend.
3. **TypeScript variance error from two Vite types.** `tsc --noEmit` failed with a 30-line variance error between `vite@6.4.2` (desktop dev dep) and `vite@5.4.21` (vitest's transitive dep). Fix: pinned desktop to `vite@^5.4.21` to dedupe with vitest's vite-node. Functionally equivalent for this phase; the bump to vite 6 will land alongside Tailwind v4 in Phase 2.
4. **JSX namespace missing.** React 19 + `jsx: "react-jsx"` does not expose a global JSX namespace. Component signatures used `: JSX.Element`. Fix: `desktop/src/types/jsx.d.ts` re-exports `JSX` from `react/jsx-runtime`. Cheaper than rewriting eight signatures and survives future React majors.

## Test results

```
> vitest run --coverage
 Test Files  10 passed (10)
      Tests  52 passed (52)
   Duration  ~8.5s

% Coverage report from v8
All files          | 99.11 | 87.21 | 100   | 99.11
 sidecar/src       | 100   | 93.33 | 100   | 100
 src/components    | 100   | 94.11 | 100   | 100
 src/lib           | 93.83 | 74    | 100   | 93.83
 src/pages         | 100   | 100   | 100   | 100
```

- `npm run lint:shell` -- 0 warnings.
- `npm run typecheck` (`tsc --noEmit`) -- 0 errors.
- Root `npm run lint` -- 0 warnings (no changes to root `src/`).
- Root `npm run build` -- 0 errors.

Skipped on this host:

- `cargo check` / `cargo clippy` / `cargo test` -- to be exercised by the new `shell-build.yml` matrix on the first PR push. Tracked as `1.P1.A`.
- Tauri end-to-end smoke via `tauri-driver` / WebDriver -- tracked as `1.P2.D`; scheduled as Phase 2 testing-and-stabilization sub-task.

## Assumptions

- The Rust toolchain on the operator's local machine will install cleanly via `rustup` before Phase 2 closes; until then, CI is the validating leg.
- The Tauri icon set will be generated during Phase 2's rebrand sweep (via `cargo tauri icon path/to/source.png`) so `tauri build` becomes functional. `tauri dev` works with the bundled default until then.
- The Phase 8 telemetry source (NVML / `nvidia-smi`) will be wired by adding a `telemetry.subscribe` handler to the sidecar without changing the `LocalModelStatus` widget or its types -- the contract is designed for that swap.

## Next steps (handoff to Phase 2)

1. Land Tailwind v4 + finalize the rebrand icon set (closes `1.P2.B`, `1.P2.C`, `1.P2.E`).
2. Add a `tauri-driver` Playwright smoke that opens the window and round-trips a `ping` (closes `1.P2.D`).
3. Begin the rebrand sweep: `gemma-code.*` settings keys -> `nexus.coding.*` with the one-cycle compat shim, `~/.gemma-code/` -> `~/.nexus/` migration, code identifier renames (`GemmaCodePanel` -> `NexusCodingPanel`, etc.). Plan: [docs/versions/v1/v1.0.0/plans/phase-02-rebrand-and-core-extraction.md](../../plans/phase-02-rebrand-and-core-extraction.md).

## Known gaps

See [docs/versions/v1/v1.0.0/known-gaps.md](../../known-gaps.md) for the full structured list. One P1 (CI matrix first-run validation), four P2 (Tailwind / icons / Lucide icon refresh / Tauri-driver smoke), one P3 (real telemetry source -- scheduled for Phase 8). Zero P0.
