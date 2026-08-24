/**
 * v2.2.0 Phase 3 (3.3) -- hub command discovery in the Agentic composer.
 *
 * Before this, the composer rendered `filterSlashCommands(value).slice(0, 8)`:
 * no hub discovery at all, and 8 of the 16 built-ins invisible at an empty "/".
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CodingInput } from "../src/modules/coding/CodingInput";
import {
  SLASH_COMMANDS,
  filterSlashCommandsWithHub,
  toSlashCommandFromHub,
  type HubCommandDescriptor,
} from "../src/modules/coding/slashCommands";

const HUB: readonly HubCommandDescriptor[] = [
  { name: "constitution", description: "Author a project constitution.", source: "nexus-hub" },
  { name: "describe", description: "Describe this project.", source: "nexus-hub" },
  // Collides with a built-in: the built-in must win so the dropdown matches
  // what the router actually executes.
  { name: "plan", description: "Hub plan variant.", source: "nexus-hub" },
];

describe("toSlashCommandFromHub", () => {
  it("marks the entry as nexus-hub and builds a template", () => {
    const cmd = toSlashCommandFromHub(HUB[0]!);
    expect(cmd.namespace).toBe("nexus-hub");
    expect(cmd.template).toBe("/constitution ");
  });

  it("falls back to a generated description", () => {
    const cmd = toSlashCommandFromHub({ name: "x", description: "", source: "nexus-hub" });
    expect(cmd.description).toContain("Nexus-Hub command");
  });
});

describe("filterSlashCommandsWithHub", () => {
  it("returns built-ins plus hub commands at an empty slash", () => {
    const out = filterSlashCommandsWithHub("/", HUB);
    const names = out.map((c) => c.name);
    // No 8-item cap: every built-in is reachable.
    expect(out.length).toBeGreaterThan(SLASH_COMMANDS.length);
    expect(names).toContain("constitution");
    expect(names).toContain("describe");
  });

  it("never lets a hub command shadow a built-in of the same name", () => {
    const out = filterSlashCommandsWithHub("/plan", HUB);
    const planEntries = out.filter((c) => c.name === "plan");
    expect(planEntries).toHaveLength(1);
    expect(planEntries[0]?.namespace).toBeUndefined();
  });

  it("filters both sources by the typed prefix", () => {
    const out = filterSlashCommandsWithHub("/desc", HUB);
    expect(out.map((c) => c.name)).toEqual(["describe"]);
  });

  it("skips malformed hub entries rather than breaking the dropdown", () => {
    const malformed = [
      { name: "", description: "no name", source: "nexus-hub" },
      { description: "missing name entirely", source: "nexus-hub" },
      null,
      { name: "   ", description: "whitespace", source: "nexus-hub" },
      HUB[0]!,
    ] as unknown as readonly HubCommandDescriptor[];
    const out = filterSlashCommandsWithHub("/", malformed);
    expect(out.map((c) => c.name)).toContain("constitution");
    expect(out.every((c) => c.name.trim().length > 0)).toBe(true);
  });

  it("deduplicates repeated hub names", () => {
    const dupes = [HUB[0]!, HUB[0]!] as readonly HubCommandDescriptor[];
    const out = filterSlashCommandsWithHub("/constitution", dupes);
    expect(out).toHaveLength(1);
  });

  it("returns nothing for non-slash input", () => {
    expect(filterSlashCommandsWithHub("hello", HUB)).toEqual([]);
  });
});

describe("CodingInput hub discovery", () => {
  it("lists hub commands alongside built-ins", async () => {
    const user = userEvent.setup();
    render(<CodingInput onSubmit={() => undefined} hubCommands={HUB} />);
    await user.type(screen.getByRole("textbox"), "/");
    expect(await screen.findByTestId("slash-constitution")).toBeTruthy();
    expect(screen.getByTestId("slash-plan")).toBeTruthy();
    // The hub entry is badged so its origin is visible.
    expect(screen.getByTestId("slash-constitution-source").textContent).toContain("Nexus-Hub");
  });

  it("shows the install hint when no catalog is present", async () => {
    const user = userEvent.setup();
    render(<CodingInput onSubmit={() => undefined} hubCommands={[]} />);
    await user.type(screen.getByRole("textbox"), "/");
    expect(await screen.findByTestId("slash-no-catalog-hint")).toBeTruthy();
  });

  it("does not show the hint when the catalog is present", async () => {
    const user = userEvent.setup();
    render(<CodingInput onSubmit={() => undefined} hubCommands={HUB} />);
    await user.type(screen.getByRole("textbox"), "/");
    await screen.findByTestId("slash-constitution");
    expect(screen.queryByTestId("slash-no-catalog-hint")).toBeNull();
  });
});
