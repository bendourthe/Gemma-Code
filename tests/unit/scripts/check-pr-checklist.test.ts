/**
 * v0.9.0 Phase 5 sub-task 5.2 -- unit tests for the Submission Checklist gate.
 *
 * Four core cases the plan calls out:
 *
 *  1. Fully checked body -> ok = true.
 *  2. One unchecked, non-`N/A:` box -> ok = false (and the line is flagged).
 *  3. Unchecked box with `N/A: <reason>` -> ok = true.
 *  4. Body without a Submission Checklist section -> ok = false, kind =
 *     "missing-section".
 */

import { describe, it, expect } from "vitest";

import { extractChecklistLines, checkBody } from "../../../scripts/check-pr-checklist.mjs";

const BODY_FULLY_CHECKED = [
  "## Summary",
  "Some change.",
  "",
  "## Submission Checklist",
  "- [x] I have read CONTRIBUTING.md",
  "- [x] `npm run lint` passes locally",
  "- [x] No new outbound network calls",
  "",
  "## After",
  "(other section)",
].join("\n");

const BODY_ONE_UNCHECKED = [
  "## Submission Checklist",
  "- [x] I have read CONTRIBUTING.md",
  "- [ ] `npm run lint` passes locally",
  "- [x] No new outbound network calls",
].join("\n");

const BODY_NA_REASON = [
  "## Submission Checklist",
  "- [x] I have read CONTRIBUTING.md",
  "- [ ] N/A: not a code change",
  "- [x] No new outbound network calls",
].join("\n");

const BODY_NO_SECTION = [
  "## Summary",
  "no checklist here",
  "",
  "## Test plan",
  "- [x] ran tests",
].join("\n");

describe("extractChecklistLines", () => {
  it("returns null when the section is absent", () => {
    expect(extractChecklistLines(BODY_NO_SECTION)).toBe(null);
  });

  it("returns the section body up to the next `## ...` header", () => {
    const out = extractChecklistLines(BODY_FULLY_CHECKED);
    expect(Array.isArray(out)).toBe(true);
    const joined = (out ?? []).join("\n");
    expect(joined).toContain("CONTRIBUTING.md");
    expect(joined).not.toContain("After");
  });
});

describe("checkBody -- fully checked", () => {
  it("returns ok = true and counts the items", () => {
    const r = checkBody(BODY_FULLY_CHECKED);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("ok");
    expect(r.items.length).toBe(3);
    expect(r.items.every((i) => i.pass)).toBe(true);
  });
});

describe("checkBody -- one unchecked, non-N/A", () => {
  it("returns ok = false and flags the failing item", () => {
    const r = checkBody(BODY_ONE_UNCHECKED);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("failing");
    const fails = r.items.filter((i) => !i.pass);
    expect(fails.length).toBe(1);
    expect(fails[0].line).toMatch(/npm run lint/);
  });
});

describe("checkBody -- unchecked with N/A: reason", () => {
  it("returns ok = true because the N/A: tag passes", () => {
    const r = checkBody(BODY_NA_REASON);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("ok");
    expect(r.items.length).toBe(3);
    const naItem = r.items.find((i) => i.rest.startsWith("N/A:"));
    expect(naItem).toBeDefined();
    expect(naItem?.pass).toBe(true);
    expect(naItem?.reason).toBe("n/a");
  });
});

describe("checkBody -- no Submission Checklist section", () => {
  it("returns ok = false with kind = `missing-section`", () => {
    const r = checkBody(BODY_NO_SECTION);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("missing-section");
  });
});

describe("checkBody -- empty section", () => {
  it("returns kind = `missing-section` when items are absent", () => {
    const empty = "## Submission Checklist\n\n## Next\n";
    const r = checkBody(empty);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("missing-section");
  });
});
