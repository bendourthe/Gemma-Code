import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_ENTRIES, Sidebar } from "../src/components/Sidebar";
import { PERSISTENCE_KEYS } from "../src/lib/persistence";
import { MODULES } from "../src/types/modules";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("derives module labels and routes from the canonical registry", () => {
    for (const entry of NAV_ENTRIES) {
      expect(entry.label).toBe(MODULES[entry.id].label);
      expect(entry.to).toBe(MODULES[entry.id].route);
      expect(entry).not.toHaveProperty("accentVar");
    }
  });

  it("renders all four primary module entries plus admin entries", () => {
    renderAt("/");
    expect(screen.getByTestId("nav-chatbot")).toBeInTheDocument();
    expect(screen.getByTestId("nav-coding")).toBeInTheDocument();
    expect(screen.getByTestId("nav-image")).toBeInTheDocument();
    expect(screen.getByTestId("nav-video")).toBeInTheDocument();
    expect(screen.getByTestId("nav-admin-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-admin-profile")).toBeNull();
  });

  // v2.2.0 Phase 6 (6.1 / 6.3): the brand block and the Ask-inbox tab are
  // gone. The title bar already carries the single brand mark, and approvals
  // moved to a footer bell rather than holding a permanent nav row.
  it("does not duplicate the brand that the title bar already shows", () => {
    const { container } = renderAt("/");
    expect(screen.queryByTestId("sidebar-brand")).toBeNull();
    expect(container.querySelector(".nexus-gradient-text")).toBeNull();
  });

  it("replaces the Ask inbox nav entry with a footer bell", () => {
    renderAt("/");
    expect(screen.queryByTestId("nav-admin-inbox")).toBeNull();
    expect(screen.getByTestId("approvals-bell")).toBeInTheDocument();
  });

  it("marks the coding route as active when the route matches", () => {
    renderAt("/coding");
    const link = screen.getByTestId("nav-coding") as HTMLAnchorElement;
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark the chatbot entry as active when at /coding", () => {
    renderAt("/coding");
    const link = screen.getByTestId("nav-chatbot") as HTMLAnchorElement;
    expect(link.getAttribute("aria-current")).toBeNull();
  });

  // v2.2.3 Phase 2 (2.1): one liquid-glass selected state for every module.
  // No per-tab accent on the icon color, background fill, or a 3px left bar.
  it("does not tint the active module row or its icon with a pillar accent", () => {
    renderAt("/images");
    const link = screen.getByTestId("nav-image") as HTMLAnchorElement;
    expect(link.className).toContain("nexus-nav-link");
    const inlineStyle = link.getAttribute("style") ?? "";
    expect(inlineStyle).not.toContain("accent-image");
    expect(inlineStyle).not.toContain("border-left");
    const icon = link.querySelector("svg");
    expect(icon?.getAttribute("color") ?? "").not.toContain("accent");
  });

  it("keeps the inactive rows free of pillar accents too", () => {
    renderAt("/images");
    for (const id of ["nav-chatbot", "nav-coding", "nav-video"]) {
      const link = screen.getByTestId(id) as HTMLAnchorElement;
      const inlineStyle = link.getAttribute("style") ?? "";
      expect(inlineStyle).not.toContain("accent-");
      const icon = link.querySelector("svg");
      expect(icon?.getAttribute("color") ?? "").not.toContain("accent");
    }
  });

  it("persists the active route in localStorage", () => {
    renderAt("/images");
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.activeRoute)).toBe("/images");
  });

  it("Ctrl+3 navigates to /images", () => {
    renderAt("/");
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.activeRoute)).toBe("/images");
  });

  it("Ctrl+, navigates to /settings", () => {
    renderAt("/");
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.activeRoute)).toBe("/settings");
  });

  it("ignores Ctrl+digit when focus is on an input", () => {
    renderAt("/");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "2", ctrlKey: true });
    // Route should still be "/" - the persistence was last updated on mount.
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.activeRoute)).toBe("/");
    document.body.removeChild(input);
  });

  it("ignores Ctrl+digit for unmapped digits", () => {
    renderAt("/");
    fireEvent.keyDown(window, { key: "9", ctrlKey: true });
    expect(window.localStorage.getItem(PERSISTENCE_KEYS.activeRoute)).toBe("/");
  });

  // v2.2.4 Phase 1 (1.3): collapse is an edge pill, not a flex row above Chatbot.
  it("keeps the collapse control out of document flow above the first tab", () => {
    renderAt("/chatbot");
    const aside = screen.getByTestId("sidebar");
    const nav = screen.getByTestId("sidebar-module-nav");
    const toggle = screen.getByTestId("sidebar-collapse-toggle");
    expect(aside.firstElementChild).toBe(nav);
    expect(toggle.className).toContain("nexus-sidebar-collapse-pill");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles the edge pill without navigating modules", () => {
    renderAt("/chatbot");
    const toggle = screen.getByTestId("sidebar-collapse-toggle");
    expect(toggle.getAttribute("aria-label")).toBe("Expand sidebar");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(screen.getByTestId("nav-chatbot").getAttribute("aria-current")).toBe("page");
  });
});
