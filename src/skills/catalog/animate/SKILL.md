---
name: animate
description: Introduce purposeful motion or interactivity to webview / extension UI elements. Restricted to extension UI surfaces, not generic.
argument-hint: "[component or webview file]"
version: 1.0.0
platforms: [linux, macos, windows]
metadata.tags: [ui, webview, motion]
metadata.related_skills: []
---

Add purposeful motion / interactivity to webview surfaces. Never decoration for its own sake.

Scope:
- Restricted to extension UI: `src/panels/webview/`, `src/panels/MemoryPanel/`, other webview code under `src/panels/`.
- NOT generic app UI, marketing sites, or third-party frontends. Stop and explain if `$ARGUMENTS` points elsewhere.

When animation is purposeful:
1. **State transitions** -- a list reorders, a status flips, a section collapses. Duration 150-250ms; never over 500ms.
2. **Continuity** -- when content moves, animate so the user can track it. Hard cuts on movement are disorienting.
3. **Feedback on user action** -- hover, click-press, success/failure pulses on tool results. Confirm input was received.
4. **Loading / progress** -- subtle motion replaces "Loading..." text. Spinner under 1s, progress bar over 1s.

When animation is decoration (avoid):
- Entrance animations on elements the user already expects.
- Continuous loops with no informational content.
- Easing that exceeds natural physics (bouncy springs on serious tool results).

Implementation:
- Prefer CSS transitions over JS animation. Honour `prefers-reduced-motion`.
- Use VS Code theme variables (`--vscode-*`) so motion-paired colours stay consistent.
- Durations / easings as named constants in [src/panels/webview/styles.ts](../../../src/panels/webview/styles.ts) -- not magic numbers in components.
- Reuse the existing render-message protocol. Do NOT add a separate "animation event" channel.

Process:
1. Read the target webview file end-to-end. List state transitions, user actions, loading paths.
2. For each candidate write: trigger, purpose, timing.
3. Implement via CSS transitions when possible; JS only when CSS cannot express the transition.
4. Test:
   - Exercise each animation in a fresh webview session.
   - Run with `prefers-reduced-motion: reduce` (`workbench.reduceMotion: true` or system setting) -- all animations collapse to instant.
   - Run `npm test -- src/panels/webview/` and confirm DOM-structure tests stay green.
5. Report: animations added (file:line, trigger, duration, purpose), reduced-motion behaviour, rejected candidates with rationale.

Hard rules:
- Respect `prefers-reduced-motion`. No exceptions.
- No animation over 500ms.
- No animation that moves the user's focus point unexpectedly.
- Named constants, not inline magic numbers.
- Stay inside extension UI surfaces.

Usage: `/animate <webview file>` -- e.g. `/animate src/panels/webview/render/diffCard.ts`.

$ARGUMENTS
