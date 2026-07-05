# v1.9.0 Phase 5 -- Desktop app (Nexus AI Studio) full UI/UX overhaul

**Date**: 2026-07-04
**Plan**: [installer-and-app-experience-overhaul.md](../../plans/installer-and-app-experience-overhaul.md) (Phase 5, T501-T505)
**Scope**: bring the Tauri desktop app to visual parity with the rebuilt installer -- a frameless custom dark title bar, the shared constellation + radial-glow backdrop, the "Nexus AI Studio" rebrand, the transparent floating mark, and a cohesive glow/gradient restyle -- so the installer and the app read as one product on Windows, macOS, and Linux.

## Summary

The desktop app went from a native-titled "Nexus" window to a frameless "Nexus AI Studio" shell that matches the installer. A custom React title bar (transparent glowing mark + wordmark + window controls) replaces the OS title bar; the Phase 2 constellation + radial-glow backdrop mounts once behind the whole shell so every route inherits the ambient look; the brand reads "Nexus AI Studio" everywhere (title bar, window/document title, sidebar, dashboard hero); and the shared glow/gradient/glass helpers unify the sidebar and dashboard. The desktop `ListedModel` DTO mirror gains `"audio"` (closing `IAE.P4.B`) and the desktop half of the `NAME.P1.A` rebrand is done. The cohesive restyle is scope-gated to the shell (not a pillar-page feature rewrite), per the plan's cut-line.

## What changed

### Frameless title bar + window controls (T501)
- [tauri.conf.json](../../../../desktop/src-tauri/tauri.conf.json): `decorations: false` (was `true`); window `title` "Nexus AI Studio".
- New [components/TitleBar.tsx](../../../../desktop/src/components/TitleBar.tsx): a 40px dark bar with a transparent static glowing mark + "Nexus AI Studio" wordmark on a `data-tauri-drag-region` (native move + double-click-maximize) and minimize / maximize-restore / close buttons (lucide icons). The maximize button reads the real window state on mount and after each toggle, swapping between a Maximize and a Restore affordance. Chrome is deliberately static (no bob) -- the animated hero mark lives on the Dashboard, matching the installer's two-mark treatment.
- New [lib/windowControls.ts](../../../../desktop/src/lib/windowControls.ts): a `WindowControls` wrapper (`minimize` / `toggleMaximize` / `close` / `isMaximized`) that lazily imports `@tauri-apps/api/window`'s `getCurrentWindow()` and, outside a Tauri runtime (Vitest, `vite dev:web`), returns a no-op implementation so the bar renders and its buttons stay inert instead of throwing. Mirrors the `ipc.ts` runtime-detection + override-seam pattern (`setWindowControlsOverride` for tests).
- New [src-tauri/capabilities/default.json](../../../../desktop/src-tauri/capabilities/default.json): the app's first Tauri v2 capability file, granting the `main` window `core:default` + the `core:window` surface the title bar needs (`allow-start-dragging`, `-minimize`, `-maximize`, `-unmaximize`, `-toggle-maximize`, `-is-maximized`, `-close`). App-defined commands (`ipc_call`) require no grant, so the existing IPC is unaffected. Validated by `tauri-build` during `cargo check`.
- [src-tauri/src/lib.rs](../../../../desktop/src-tauri/src/lib.rs) is unchanged: the force-dark theme + `window-icon.png` override are Rust-side and keep working on a frameless window; the window controls are JS-side.

### Constellation + radial-glow backdrop (T502)
- [App.tsx](../../../../desktop/src/App.tsx) restructured into a fixed-viewport column: a `.nexus-app-backdrop` radial-glow layer + the Phase 2 [`<ConstellationBackground/>`](../../../../desktop/src/components/ConstellationBackground.tsx) at 0.5 opacity (both `position: fixed`, `z-index: 0`), then the `<TitleBar/>`, then a content row (sidebar + `<main>`) at `position: relative; z-index: 1`. The content row scrolls internally; the chrome stays fixed.
- The four pillar page roots set no opaque background, so they inherit the ambient backdrop through the transparent `<main>`; the constellation reduced-motion + hidden-pause behavior comes from the primitive (React `matchMedia`), so app parity with the installer is exact.

### Rebrand to "Nexus AI Studio" (T503)
- `productName` "Nexus" -> "Nexus AI Studio" and window title in [tauri.conf.json](../../../../desktop/src-tauri/tauri.conf.json); identifier `ai.nexus.shell` kept.
- [index.html](../../../../desktop/index.html) `<title>` "Nexus - Local AI Studio" -> "Nexus AI Studio".
- [Sidebar.tsx](../../../../desktop/src/components/Sidebar.tsx): brand wordmark "Nexus" -> "Nexus AI Studio" (signature-gradient text via `.nexus-gradient-text`), the mark gains a cyan glow, and the panel becomes a translucent glass surface (`.nexus-glass`) so the ambient glow reads through.
- [Dashboard.tsx](../../../../desktop/src/pages/Dashboard.tsx): the plain h1 becomes a branded hero -- an animated [`<FloatingLogo/>`](../../../../desktop/src/components/FloatingLogo.tsx) mark + a gradient "Nexus AI Studio" heading + a "Your Local AI Workspace" subtitle.
- The app already carried a transparent `/nexus-mark.png` (refreshed in Phase 2, matching `window-icon.png` at ~0.20 opaque ratio), so no asset regen was needed; the sidebar, title bar, and hero all feed it.

### Cohesive restyle (T504)
- New helpers in [globals.css](../../../../desktop/src/styles/globals.css) (additive): `.nexus-app-backdrop`, `.nexus-gradient-text`, `.nexus-glass`, and the `.nexus-titlebar*` chrome classes (hover states need real CSS, so the title bar styling lives here).
- Pillar page titles: the Coding and Video page h1s get their module accent + a soft glow (`text-shadow` from the `-soft` token). The Image (mode-tab header) and Chat (folder-tree) pages have no title slot; they rely on the shell backdrop + their own module-accent chrome, so no title was forced.
- **Approach decision**: Tailwind v4 is named in the plan and the package description but is *not* an installed dependency (no `tailwindcss` in `package.json`, no config, no `tailwind.css`). Rather than introduce a new build pipeline under the Actions freeze for a "cohesive restyle", the existing inline-token + `globals.css` system is standardized. Recorded as the deliberate T504 choice.
- **Cut-line**: the four pillar pages' inner working surfaces (chat folder tree, coding panels/tabs, image/video prompt forms) keep their v1.0.0 layouts (`IAE.P5.C`). The DoD's "one family" look is carried by the shell (title bar + ambient backdrop + rebranded sidebar + dashboard hero + accent titles), honoring "a cohesive restyle, not a feature rewrite".

### IAE.P4.B -- desktop DTO mirror gains audio
- [pages/settings/modelsTypes.ts](../../../../desktop/src/pages/settings/modelsTypes.ts): `"audio"` added to the `ModelType` union, matching core's `llm / embed / image / video / audio / controlnet / vae` order.
- [pages/settings/ModelsSettings.tsx](../../../../desktop/src/pages/settings/ModelsSettings.tsx): an "Audio" entry added to `TYPE_FILTERS`, and `ModelIcon` gains an audio branch (label "S", color `--accent-audio` fallback `#d946ef`), so an audio model marshalled over IPC renders with a proper icon and is filterable instead of falling through to an undefined type.

## Tests (T505)
- New [tests/TitleBar.test.tsx](../../../../desktop/tests/TitleBar.test.tsx) (6): mark + wordmark render, drag-region present, minimize/close wiring, maximize toggle + Restore glyph swap, already-maximized mount sync, custom title/mark props.
- New [tests/windowControls.test.ts](../../../../desktop/tests/windowControls.test.ts) (4): override seam get/clear, no-op path outside Tauri (isMaximized false, mutators resolve), and the real path via a mocked `@tauri-apps/api/window` (each control delegates to the current window).
- New [tests/desktopBranding.test.ts](../../../../desktop/tests/desktopBranding.test.ts) (5): `productName` + identifier, window title + `decorations: false`, `index.html` title, no legacy "Local AI Studio" string, and the capability's window-control permissions.
- Extended: `App.test.tsx` (title bar + backdrop + constellation mount), `Sidebar.test.tsx` (rebrand lockup), `Dashboard.test.tsx` (hero + floating mark), `ModelsSettings.test.tsx` (audio filter narrows to the audio entry + the audio icon renders).

## Verification / gates
- Desktop Vitest: **515 passed / 0 failed** (63 files, +19 tests over Phase 2's 496).
- Coverage: lines 93.83% / branches 85.51% / functions 83.43% (>= the 80/70/80/80 gate). New/changed: TitleBar.tsx 100% lines/branches/functions; Sidebar.tsx 100% lines; Dashboard.tsx 100% lines.
- `tsc --noEmit` clean; `eslint src sidecar/src tests --max-warnings=0` clean.
- `cargo check` clean (the new capability + config validate through `tauri-build`); `cargo clippy --all-targets` clean (clippy component installed this session).
- CI/CD check: `release.yml`'s `desktop-bundle` job stages artifacts by wildcard (`bundle/nsis/*-setup.exe`, `bundle/dmg/*.dmg`, `bundle/appimage/*.AppImage`, `bundle/deb/*.deb`) into canonical `Nexus-Desktop_${version}_*` names, so the spaced `productName` rename does not break any upload glob. No workflow change needed.

## Known gaps opened
- `IAE.P5.A` (P1, DF): frameless per-OS window behavior (Windows Aero snap, macOS move/zoom, Linux WM) not on-device verified -> Phase 6 rehearsal.
- `IAE.P5.B` (P2, DF): edge/corner resize with `decorations: false` relies on the webview (no custom resize grips like the installer's `QSizeGrip`s) -> verify per OS in Phase 6, or add CSS handles / native-decorations fallback.
- `IAE.P5.C` (P2, DF): pillar-page internal component polish deferred (cut-line -- shell carries the family look).
- `IAE.P5.D` (P3, DF): the spaced `productName` bundle build (deb name sanitization, DMG volume) not run here (freeze) -> confirm in the Phase 6 CI rehearsal (T602).

## Resolved
- `IAE.P4.B` (desktop DTO mirror gained `"audio"`).
- `NAME.P1.A` desktop half (the app now reads "Nexus AI Studio" throughout; the non-user-visible compat-shim retirement remains a separate hygiene item).
