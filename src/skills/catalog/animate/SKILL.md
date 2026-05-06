---
name: animate
description: Introduce purposeful motion or interactivity to webview / extension UI elements. Restricted to extension UI surfaces, not generic.
argument-hint: "[component or webview file]"
---

You are adding motion or interactivity to webview / extension UI surfaces. The goal is purposeful animation that improves user understanding -- never decoration for its own sake.

Scope:
- This skill is restricted to extension UI surfaces: `src/panels/webview/`, `src/panels/MemoryPanel/`, and other webview render code under `src/panels/`.
- It does NOT apply to generic application UI, marketing sites, or third-party frontends. If `$ARGUMENTS` points to one of those, stop and explain.

When animation is purposeful:
1. **State transitions** -- show users that something changed (a list reorders, a status flips, a section collapses). The animation MUST be shorter than the perceived value of seeing it (typical 150-250ms; never over 500ms).
2. **Continuity** -- when a piece of content moves, animate the move so the user can track it. Hard cuts on movement are disorienting.
3. **Feedback on user action** -- hover affordances, click-press depression, success/failure pulses on tool-call results. These confirm the system received input.
4. **Loading / progress** -- replace static "Loading..." text with subtle motion that indicates "still alive". Match the perceived duration: spinner < 1s, progress bar > 1s.

When animation is decoration (avoid):
- Entrance animations on elements the user just navigated to expecting (e.g. fading in the chat panel on open). The user already knows it's there.
- Continuous loops with no informational content.
- Easing that exceeds the natural physics of the interaction (bouncy springs on a serious tool result).

Implementation guidelines:
- Prefer CSS transitions and `prefers-reduced-motion` over JS-driven animation. The webview must respect the user's OS-level reduced-motion setting.
- For VS Code webviews, use VS Code theme variables (`--vscode-*`) so motion-paired colours stay consistent across themes.
- All durations as named constants in [src/panels/webview/styles.ts](../../../src/panels/webview/styles.ts) or the panel's stylesheet, not magic numbers in component code.
- Reuse the existing render-message protocol for state changes. Do NOT add a separate "animation event" channel.

Process:
1. Read the target webview file end-to-end. Identify the state transitions, user actions, and loading paths.
2. For each candidate, write down: the trigger, the perceived purpose, the proposed timing.
3. Implement using CSS transitions wherever possible. JS-driven animation only when CSS cannot express the transition.
4. Test:
   - In a fresh webview session, exercise each animation manually.
   - Run with `prefers-reduced-motion: reduce` (set via VS Code's `workbench.reduceMotion: true` or system setting). All animations must collapse to instant transitions.
   - Run the panel's unit tests (`npm test -- src/panels/webview/`) -- DOM-structure tests must remain green.
5. Report:
   - Animations added (file:line, trigger, duration, purpose).
   - Reduced-motion behaviour for each.
   - Any animation considered but rejected, with rationale.

Hard rules:
- Respect `prefers-reduced-motion`. No exceptions.
- No animation longer than 500ms, no exceptions.
- No animation that moves the user's focus point unexpectedly (no autoscrolls during animation).
- All durations / easings as named constants, not inline magic numbers.
- Restrict scope to extension UI surfaces.

Usage example:
- `/animate src/panels/webview/render/permissionPrompt.ts` -- animate the new numbered permission prompt.
- `/animate src/panels/webview/render/diffCard.ts` -- animate the inline diff card.

$ARGUMENTS
