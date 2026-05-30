# Stakeholder HTML Surfaces (plan brief / progress / acceptance)

**Adoption item**: A11 (skill-native) from [../../v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md).
**Source pattern**: claude-code-harness `harness-plan-brief`, `harness-progress`, `harness-accept` skills.
**Status**: active convention (v1.4.0).
**Hard constraint**: every surface is local, self-contained, and zero-outbound.

## Purpose

The claude-code-harness ships three cognitive-load HTML surfaces so a non-engineer stakeholder can review work without reading the repo: a plan brief, a progress tracker, and an acceptance / handoff decision. Nexus adopts the same three surfaces as a reporting convention. Each surface is a single self-contained HTML file generated from local inputs (the plan, the known-gaps file, the captured test/lint/build evidence). The surfaces are read-only artifacts for humans; they do not change runtime behaviour.

## Zero-outbound contract (non-negotiable)

Every generated file MUST be openable offline with no network access and leak nothing:

- Inline CSS only. No `<link rel="stylesheet">`, no CDN, no web fonts. Use a system font stack.
- No `<script src="...">` and no remote `<img>`/`<iframe>`. Any script is inline and used only for local interactivity (collapse/expand). The surfaces below need no script at all.
- No analytics, telemetry, beacon, or tracking pixel.
- All data is interpolated from local inputs at generation time; the file embeds the data, it does not fetch it.

This mirrors Nexus's local-first runtime contract and the MCP Registry Policy hard-no on outbound services. A surface that references any external URL (other than informational hyperlinks the reader may choose to click) fails the contract.

## Inputs

| Surface | Local inputs |
|---|---|
| Plan brief | The plan file under `docs/versions/v1/<v>/plans/<slug>.md` (title, goal, phases-at-a-glance, definition of pass, out-of-scope items). |
| Progress tracker | The plan phase list + checkbox state, the per-phase session histories under `development/history/`, and the captured test/lint/build/coverage evidence. |
| Acceptance / handoff | The plan's definition-of-pass criteria, the [known-gaps.md](../known-gaps.md) open/resolved counts, and the fresh whole-plan evidence (Phase 9 for this cycle). |

## How to generate

1. Read the local inputs for the chosen surface.
2. Copy the matching template below into `docs/versions/v1/<v>/development/surfaces/<surface>.html` (the `surfaces/` directory is created on first use).
3. Replace every `{{TOKEN}}` with the local value. For repeating rows (phases, gaps, criteria), repeat the marked `<!-- row -->` block once per item.
4. Verify the zero-outbound contract: search the file for `http://`, `https://`, `src=`, and `@import`; the only allowed external strings are informational hyperlinks in the body.
5. The file is the deliverable. It opens in any browser and prints cleanly to PDF for a stakeholder who wants a static copy.

Tier wording inside the surfaces follows [evidence-and-support-tiers.md](evidence-and-support-tiers.md): a criterion with no fresh proof is shown as "not proven here", never as a green pass.

---

## Template 1 - Plan Brief

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plan Brief - {{PLAN_TITLE}}</title>
<style>
  :root { --ink:#1a1a2e; --muted:#5b5b77; --line:#e3e3ef; --accent:#3a4fb8; --bg:#fafaff; }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem; background:var(--bg); color:var(--ink);
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         line-height:1.55; max-width:60rem; margin-inline:auto; }
  header { border-bottom:3px solid var(--accent); padding-bottom:1rem; margin-bottom:1.5rem; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; }
  .meta { color:var(--muted); font-size:.9rem; }
  h2 { font-size:1.15rem; margin-top:2rem; border-left:4px solid var(--accent); padding-left:.6rem; }
  .goal { background:#fff; border:1px solid var(--line); border-radius:8px; padding:1rem 1.25rem; }
  table { width:100%; border-collapse:collapse; margin-top:.75rem; background:#fff; }
  th, td { text-align:left; padding:.55rem .7rem; border-bottom:1px solid var(--line); font-size:.92rem; vertical-align:top; }
  th { background:#f0f0fa; }
  ul { margin:.5rem 0; padding-left:1.2rem; }
  footer { margin-top:2.5rem; color:var(--muted); font-size:.8rem; border-top:1px solid var(--line); padding-top:.75rem; }
  @media print { body { background:#fff; } }
</style>
</head>
<body>
<header>
  <h1>Plan Brief: {{PLAN_TITLE}}</h1>
  <div class="meta">Version {{VERSION}} &middot; {{PLAN_TYPE}} &middot; prepared {{DATE}}</div>
</header>

<section>
  <h2>What this plan delivers</h2>
  <div class="goal">{{GOAL}}</div>
</section>

<section>
  <h2>Phases at a glance</h2>
  <table>
    <thead><tr><th>#</th><th>Phase</th><th>Outcome</th></tr></thead>
    <tbody>
      <!-- row --><tr><td>{{PHASE_NUM}}</td><td>{{PHASE_TITLE}}</td><td>{{PHASE_OUTCOME}}</td></tr>
    </tbody>
  </table>
</section>

<section>
  <h2>Definition of done</h2>
  <ul>
    <!-- row --><li>{{PASS_CRITERION}}</li>
  </ul>
</section>

<section>
  <h2>Explicitly out of scope</h2>
  <ul>
    <!-- row --><li>{{OUT_OF_SCOPE_ITEM}}</li>
  </ul>
</section>

<footer>Generated locally from {{PLAN_PATH}}. No data left this machine.</footer>
</body>
</html>
```

---

## Template 2 - Progress Tracker

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Progress - {{PLAN_TITLE}}</title>
<style>
  :root { --ink:#1a1a2e; --muted:#5b5b77; --line:#e3e3ef; --accent:#3a4fb8;
          --done:#1f9d6b; --wip:#c98a00; --todo:#8a8aa3; --bg:#fafaff; }
  body { margin:0; padding:2rem; background:var(--bg); color:var(--ink);
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         line-height:1.5; max-width:60rem; margin-inline:auto; }
  h1 { font-size:1.5rem; border-bottom:3px solid var(--accent); padding-bottom:.6rem; }
  .bar { height:1.1rem; background:#ececf7; border-radius:999px; overflow:hidden; margin:.75rem 0 1.5rem; }
  .bar > span { display:block; height:100%; width:{{PERCENT}}%; background:var(--done); }
  .pct { font-weight:600; }
  table { width:100%; border-collapse:collapse; background:#fff; }
  th, td { text-align:left; padding:.5rem .7rem; border-bottom:1px solid var(--line); font-size:.92rem; }
  th { background:#f0f0fa; }
  .status { font-weight:600; font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; }
  .s-done { color:var(--done); } .s-wip { color:var(--wip); } .s-todo { color:var(--todo); }
  .evidence { margin-top:1.5rem; background:#fff; border:1px solid var(--line); border-radius:8px; padding:1rem 1.25rem; font-size:.9rem; }
  .muted { color:var(--muted); font-size:.8rem; }
  @media print { body { background:#fff; } }
</style>
</head>
<body>
<h1>Progress: {{PLAN_TITLE}} ({{VERSION}})</h1>
<div class="pct">{{PHASES_DONE}} of {{PHASES_TOTAL}} phases complete &middot; {{PERCENT}}%</div>
<div class="bar"><span></span></div>

<table>
  <thead><tr><th>#</th><th>Phase</th><th>Status</th><th>Notes</th></tr></thead>
  <tbody>
    <!-- row --><tr><td>{{PHASE_NUM}}</td><td>{{PHASE_TITLE}}</td>
      <td class="status s-{{STATUS_CLASS}}">{{STATUS_LABEL}}</td><td>{{PHASE_NOTE}}</td></tr>
  </tbody>
</table>

<div class="evidence">
  <strong>Latest verified evidence</strong>
  <ul>
    <li>Tests: {{TESTS_SUMMARY}}</li>
    <li>Coverage: {{COVERAGE_SUMMARY}}</li>
    <li>Lint / build / architecture: {{QUALITY_SUMMARY}}</li>
  </ul>
  <div class="muted">Unproven items are shown as "not proven here", not as a pass (see evidence-and-support-tiers).</div>
</div>

<p class="muted">Generated locally {{DATE}} from the plan and session histories. No data left this machine.</p>
</body>
</html>
```

---

## Template 3 - Acceptance / Handoff Decision

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceptance - {{PLAN_TITLE}}</title>
<style>
  :root { --ink:#1a1a2e; --muted:#5b5b77; --line:#e3e3ef;
          --go:#1f9d6b; --nogo:#c0392b; --bg:#fafaff; }
  body { margin:0; padding:2rem; background:var(--bg); color:var(--ink);
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         line-height:1.5; max-width:58rem; margin-inline:auto; }
  h1 { font-size:1.5rem; margin-bottom:.25rem; }
  .verdict { display:inline-block; font-size:1.1rem; font-weight:700; padding:.4rem 1rem; border-radius:8px;
             color:#fff; background:var(--{{VERDICT_CLASS}}); margin:.5rem 0 1.5rem; }
  table { width:100%; border-collapse:collapse; background:#fff; }
  th, td { text-align:left; padding:.55rem .7rem; border-bottom:1px solid var(--line); font-size:.92rem; vertical-align:top; }
  th { background:#f0f0fa; }
  .ok { color:var(--go); font-weight:600; } .fail { color:var(--nogo); font-weight:600; }
  .holds { margin-top:1.5rem; background:#fff; border:1px solid var(--line); border-radius:8px; padding:1rem 1.25rem; }
  .muted { color:var(--muted); font-size:.8rem; }
  @media print { body { background:#fff; } }
</style>
</head>
<body>
<h1>Acceptance decision: {{PLAN_TITLE}} ({{VERSION}})</h1>
<div class="verdict">{{VERDICT_LABEL}}</div>

<h2>Definition-of-pass criteria</h2>
<table>
  <thead><tr><th>Criterion</th><th>Result</th><th>Evidence</th></tr></thead>
  <tbody>
    <!-- row --><tr><td>{{CRITERION}}</td>
      <td class="{{RESULT_CLASS}}">{{RESULT_LABEL}}</td><td>{{CRITERION_EVIDENCE}}</td></tr>
  </tbody>
</table>

<div class="holds">
  <strong>Open hold conditions</strong>
  <ul>
    <!-- row --><li>{{HOLD_CONDITION}}</li>
  </ul>
  <div class="muted">Known gaps still open: {{OPEN_GAPS}} &middot; resolved this cycle: {{RESOLVED_GAPS}}.</div>
</div>

<p class="muted">Prepared locally {{DATE}} from the plan, known-gaps, and fresh acceptance evidence. No data left this machine.</p>
</body>
</html>
```

---

## Acceptance for this deliverable

The convention "produces the three HTML surfaces from local inputs" when an author can take the plan, known-gaps, and captured evidence for any Nexus cycle, fill the three templates above, and obtain three self-contained HTML files that open offline and reveal no external dependency. The templates are the reusable engine; a worked instance for the v1.4.0 cycle is generated under `development/surfaces/` when the cycle reaches its acceptance gate (Phase 9). Until then, this convention sits at support tier `supported` for the templates themselves (they are complete and self-contained) and `candidate` for the live per-cycle instances (no caller has generated them yet).

## Where this is referenced

This convention is the home of the three stakeholder surfaces; the [evidence-pack discipline](evidence-pack.md) (A12) points here for the human-facing acceptance artifact, and the surfaces draw their definition-of-pass and gap counts from the [known-gaps.md](../known-gaps.md) file and the plan.
