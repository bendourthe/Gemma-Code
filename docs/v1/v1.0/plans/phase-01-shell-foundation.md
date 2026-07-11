# Phase 1 - Shell foundation: Tauri + design tokens + dashboard skeleton

**Goal**: Stand up the `nexus-shell` Tauri app with the sidebar + 2x2 dashboard cards + Local Model Status placeholder, apply the dark-theme design tokens, and prove the IPC contract to a Node sidecar.
**Prerequisites**: None.
**Stability Gate**: `npm run dev:shell` opens a native window on Windows / macOS / Linux that renders the mockup layout and roundtrips a `ping` IPC call to the Node sidecar.

---

## Sub-tasks

### 1.1 - Scaffold the Tauri workspace

**Objective**: Create the `desktop/` workspace with Tauri 2.x (Rust core + WebView frontend) and wire it as an npm workspace member.

**Prompt**:
> Scaffold a new Tauri 2.x workspace at `desktop/` in the Nexus-AI repository. Use Vite + React + TypeScript for the WebView frontend (the same stack as the existing webview-builder skill). Configure the Tauri core (`desktop/src-tauri/`) to compile on Windows, macOS, and Linux. Register `desktop/` as an npm workspace in the root `package.json`. Add `npm run dev:shell` and `npm run build:shell` scripts that wrap `tauri dev` and `tauri build`. Default to the system theme but force the dark palette regardless. The window title must read `Nexus - Local AI Studio`. Minimum window size 1280x800. Confirm the placeholder window opens with `npm run dev:shell` on the host platform. Do NOT depend on Electron or any non-Rust core - Tauri 2.x is the chosen shell. Acceptance: `cargo check` in `desktop/src-tauri/` is clean, `npm run dev:shell` opens a window, `npm run build:shell` produces a bundle.

---

### 1.2 - Design tokens (palette, typography, spacing, radius)

**Objective**: Codify the four-module color palette (Chatbot cyan, Agentic AI magenta, Images orange, Videos green) and the dark-theme base tokens.

**Prompt**:
> In `desktop/src/styles/tokens.css` define the Nexus design tokens as CSS custom properties: dark-theme base (`--bg-0`, `--bg-1`, `--bg-2`, `--fg-0`, `--fg-1`, `--fg-muted`, `--border-subtle`); module accents (`--accent-chatbot: cyan-500`, `--accent-coding: magenta-500`, `--accent-image: orange-500`, `--accent-video: green-500`); typography (`--font-sans`, `--font-mono`, six type scales `--text-xs` through `--text-2xl`); spacing scale (`--space-1` through `--space-10` on a 4 px base); radius (`--radius-sm`, `--radius-md`, `--radius-lg`); shadows (subtle elevation tokens for cards). Reference: `docs/versions/v1/v1.0.0/pivot-brief.md` Section 3 (UI mockup analysis). Document each token in `docs/versions/v1/v1.0.0/design-tokens.md` with usage examples. Apply tokens via Tailwind CSS v4 configured to consume CSS variables. Acceptance: a `<StyleguidePage>` route at `/_styleguide` renders every token visually for inspection.

---

### 1.3 - Sidebar component (primary + admin separation)

**Objective**: Build the permanent left-hand sidebar with five primary nav entries and visually-isolated Settings + User Profile.

**Prompt**:
> In `desktop/src/components/Sidebar.tsx` implement the sidebar from the UI mockup: at the top, the Nexus logo + wordmark; five primary nav entries with color-coded icons (Chatbot / Agentic AI / Images / Videos); a thin divider; Settings and User Profile at the bottom, visually isolated. The currently-active entry gets a subtle accent border on the left using its module accent color. Use Lucide React icons. Components must use React Router v6 for routing - each nav entry routes to `/chatbot`, `/coding`, `/images`, `/videos`, `/settings`, `/profile`. Keyboard navigation: `Ctrl+1` through `Ctrl+4` switch modules; `Ctrl+,` opens settings. Persist the active route in localStorage and restore on launch. Acceptance: clicking each entry switches routes, the active accent is correct, keyboard shortcuts work.

---

### 1.4 - Dashboard 2x2 module cards

**Objective**: Implement the dashboard with 2x2 module cards (Agentic Coding, Local Chatbot, Image Studio, Video Lab), top bar (title + search + bell + gear), and "Welcome, {firstName}!" greeting.

**Prompt**:
> In `desktop/src/pages/Dashboard.tsx` implement the landing page exactly per `docs/versions/v1/v1.0.0/pivot-brief.md` Section 3. Top bar: module title ("NEXUS Dashboard: Your Local AI Workspace"), search field (functionally a placeholder for v1.0.0), notification bell with red-dot badge, gear icon (links to /settings). Welcome line with first name pulled from `~/.nexus/profile.json` (fallback "User"). 2x2 grid of `<ModuleCard>` components - each card has icon, title (e.g. "Agentic AI Coding"), one-line subtitle, two-line body, primary CTA button, and a small visual preview slot on the right (use the mockup's visual style). Card accent borders use the module accent token. Below the grid, render a `Recent Projects` list (mock data for now) and a `Local Model Status` panel (placeholder reading from a hard-coded JSON until Phase 8 lights up real telemetry). Sparkle and ? buttons bottom-right (link to AI assist / docs - placeholders). Acceptance: the page matches the mockup visually and routes work.

---

### 1.5 - Node sidecar process + IPC contract

**Objective**: Spawn a Node sidecar process from the Tauri core, define the JSON-RPC IPC contract, and roundtrip a `ping` call.

**Prompt**:
> In `desktop/src-tauri/src/sidecar.rs` implement a Node sidecar spawner that launches `desktop/sidecar/dist/main.js` as a child process at app launch and shuts it down on app quit. Sidecar code lives at `desktop/sidecar/src/main.ts` and is bundled with esbuild to `desktop/sidecar/dist/main.js`. Communication: stdin/stdout JSON-RPC 2.0. Define an IPC contract at `desktop/sidecar/src/protocol.ts`: `Method` union type covering `ping`, `models.list`, `models.install`, `coding.startTask`, `image.generate`, `video.generate`, `skills.sync`, `telemetry.subscribe`. Each method has request + response Zod schemas. Implement only `ping` for this phase - all others throw `NotImplemented` errors. In the frontend, `desktop/src/lib/ipc.ts` exposes `ipc.call(method, params)` that goes through Tauri's `invoke('ipc_call', ...)` to the Rust core, which forwards to the sidecar. Acceptance: a dev-only "Ping sidecar" button on the Dashboard returns `{ok: true, pid: <number>, version: "1.0.0"}` from the sidecar.

---

### 1.6 - Local Model Status placeholder widget

**Objective**: Implement the `<LocalModelStatus>` widget contract as a reusable component (consumed by Dashboard + future module-internal panels).

**Prompt**:
> In `desktop/src/components/LocalModelStatus.tsx` implement the always-visible model-status widget per the UI mockup: model name + parameter size (e.g. "Gemma 4 7B - Active"), GPU utilization % with a horizontal bar, free VRAM in GB (e.g. "GPU Usage: 38% RTX 3080, 50GB VRAM Free"). The widget subscribes to a `telemetry.subscribe` IPC stream (still placeholder in this phase) and re-renders on each update. When the IPC stream is not available, render a "telemetry unavailable" muted state. The data model is `{ modelName: string, paramSize: string, gpuPct: number, vramFreeGB: number, deviceName: string, lastUpdated: number }` exported from `desktop/src/components/LocalModelStatus.types.ts`. Acceptance: the widget renders on the Dashboard and re-renders when a mocked telemetry tick fires every 2 seconds.

---

### 1.7 - Cross-platform CI for the shell

**Objective**: Wire GitHub Actions to build the shell on `windows-latest`, `macos-latest`, and `ubuntu-latest`.

**Prompt**:
> Add `.github/workflows/shell-build.yml` that on every PR runs `cargo check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` inside `desktop/src-tauri/`, plus the frontend's `npm run lint`, `npm run build`, and `vitest run` for `desktop/`. The job matrix is `[windows-latest, macos-latest, ubuntu-latest]`. Build artifacts are uploaded on push to `main` for inspection but not released. Cache cargo registry + target directory keyed on `Cargo.lock`. Cache `node_modules` keyed on `package-lock.json`. Acceptance: a PR that compiles the shell passes all three matrix legs; a PR that introduces a Rust clippy warning fails.

---

### 1.8 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 1. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 1. Include: Vitest unit tests for `<Sidebar>` (keyboard navigation, active accent, persistence), `<Dashboard>` (renders cards, welcome line, navigation), `<ModuleCard>` (renders all variants, click invokes nav), `<LocalModelStatus>` (renders, re-renders on tick, muted state); Rust unit tests for the sidecar spawner; an integration test that boots the shell with WebDriver / Playwright (if Tauri-compatible) and verifies the ping IPC roundtrip works on the dev build. Coverage target: lines >= 80, functions >= 80 across `desktop/src/` and `desktop/src-tauri/src/`. Run the test suite, fix all failures, iterate until every test passes. Do not advance to Phase 2 until this phase is fully verified. After all tests pass, run `/generate-session-history` to document Phase 1.

---

### Phase 1 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing on all three OS matrix legs
- [ ] `npm run dev:shell` opens the window on Windows / macOS / Linux
- [ ] Dashboard visually matches the mockup
- [ ] Sidebar keyboard shortcuts work
- [ ] Ping IPC roundtrips to the sidecar
- [ ] Local Model Status widget renders against a mocked telemetry stream
- [ ] Coverage gate (lines >= 80, functions >= 80) green
- [ ] Session history generated for Phase 1
- [ ] Ready to advance to Phase 2
