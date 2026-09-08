/**
 * v2.4.2 Phase 1 -- sidebar history host, thinking-pill crop, scrollbar tokens.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { AgentStateOrb } from "../src/components/agentState/AgentStateOrb";
import {
  longestPendingCaption,
  pendingPillMinWidthExpr,
} from "../src/components/agentState/captionRotator";
import {
  ORB_SIZE_BUBBLE,
  rectFullyInside,
} from "../src/components/agentState/orbEngine";
import { isSidebarHistoryRoute } from "../src/components/SidebarHistoryHost";
import { HISTORY_HAIRLINE_GAP } from "../src/components/Sidebar";

function renderApp(pathName: string) {
  return render(
    <MemoryRouter initialEntries={[pathName]}>
      <App telemetryStream={null} />
    </MemoryRouter>,
  );
}

describe("sidebar history host", () => {
  it("treats only the four module routes as history hosts", () => {
    expect(isSidebarHistoryRoute("/chatbot")).toBe(true);
    expect(isSidebarHistoryRoute("/coding")).toBe(true);
    expect(isSidebarHistoryRoute("/images")).toBe(true);
    expect(isSidebarHistoryRoute("/videos")).toBe(true);
    expect(isSidebarHistoryRoute("/settings")).toBe(false);
    expect(isSidebarHistoryRoute("/inbox")).toBe(false);
    expect(isSidebarHistoryRoute("/")).toBe(false);
  });

  it("ports Chatbot history into the sidebar and leaves the transcript as the main pane", async () => {
    renderApp("/chatbot");
    const host = await screen.findByTestId("sidebar-history-host");
    const pane = await screen.findByTestId("chats-pane");
    expect(host).toContainElement(pane);
    expect(
      screen
        .getByTestId("chat-page")
        .querySelector("[data-testid='chats-pane']"),
    ).toBeNull();
    expect(screen.queryByTestId("chats-pane-collapse-toggle")).toBeNull();
  });

  it("ports Agents history into the sidebar and drops the in-pane History band", async () => {
    renderApp("/coding");
    const host = await screen.findByTestId("sidebar-history-host");
    const pane = await screen.findByTestId("coding-history-pane");
    expect(host).toContainElement(pane);
    expect(
      screen
        .getByTestId("coding-page")
        .querySelector("[data-testid='coding-history-pane']"),
    ).toBeNull();
    expect(screen.queryByTestId("coding-history-collapse-toggle")).toBeNull();
    expect(screen.getByTestId("coding-workspace-header")).toBeInTheDocument();
    expect(screen.getByTestId("coding-tabs")).toBeInTheDocument();
  });

  it("ports Image and Video history into the sidebar, isolated per module", async () => {
    renderApp("/images");
    const imageHost = await screen.findByTestId("sidebar-history-host");
    const imagePane = await screen.findByTestId("image-history-pane");
    expect(imageHost).toContainElement(imagePane);
    expect(
      screen
        .getByTestId("image-studio-page")
        .querySelector("[data-testid='image-history-pane']"),
    ).toBeNull();
    expect(screen.queryByTestId("video-history-pane")).toBeNull();
    expect(screen.queryByTestId("chats-pane")).toBeNull();

    fireEvent.click(screen.getByTestId("nav-video"));
    const videoHost = await screen.findByTestId("sidebar-history-host");
    const videoPane = await screen.findByTestId("video-history-pane");
    expect(videoHost).toContainElement(videoPane);
    expect(screen.queryByTestId("image-history-pane")).toBeNull();
    expect(
      screen
        .getByTestId("video-lab-page")
        .querySelector("[data-testid='video-history-pane']"),
    ).toBeNull();
  });

  it("swaps the hosted tree when switching Chatbot to Agents and hides the slot on Settings", async () => {
    renderApp("/chatbot");
    expect(await screen.findByTestId("chats-pane")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("nav-coding"));
    await waitFor(() => {
      expect(screen.queryByTestId("chats-pane")).toBeNull();
      expect(screen.getByTestId("coding-history-pane")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sidebar-history-host")).toContainElement(
      screen.getByTestId("coding-history-pane"),
    );

    fireEvent.click(screen.getByTestId("nav-admin-settings"));
    await waitFor(() => {
      expect(screen.queryByTestId("sidebar-history-host")).toBeNull();
      expect(screen.getByTestId("sidebar-history-spacer")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("chats-pane")).toBeNull();
    expect(screen.queryByTestId("coding-history-pane")).toBeNull();
  });

  it("collapses the sidebar rail without dropping the hosted tree", async () => {
    renderApp("/chatbot");
    await screen.findByTestId("chats-pane");
    const toggle = screen.getByTestId("sidebar-collapse-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("sidebar-history-host")).toHaveAttribute(
      "data-compact",
      "true",
    );
    expect(screen.getByTestId("chats-pane")).toHaveAttribute(
      "data-history-collapsed",
      "true",
    );
    expect(screen.getByTestId("chats-pane")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("chats-pane")
        .querySelector(
          "[data-testid='folder-tree'], [data-testid='folder-tree-empty']",
        ),
    ).not.toBeNull();
  });

  it("draws a hairline between module tabs and history, not on Settings", async () => {
    renderApp("/images");
    expect(
      await screen.findByTestId("sidebar-history-hairline"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-history-host")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("nav-admin-settings"));
    await waitFor(() => {
      expect(screen.queryByTestId("sidebar-history-hairline")).toBeNull();
      expect(screen.getByTestId("sidebar-history-spacer")).toBeInTheDocument();
    });
  });

  /**
   * v2.4.4 Phase 2.1 (T008): field screenshot 2 showed the rule sitting
   * closer to Videos than to Chats. The rule now owns one symmetric block
   * margin and the tree header below it contributes no top padding, so the
   * two gaps come from the same single declaration.
   */
  it("centers the hairline with one symmetric gap on each side", async () => {
    renderApp("/images");
    const rule = await screen.findByTestId("sidebar-history-hairline");
    expect(rule.style.marginBlock).toBe(HISTORY_HAIRLINE_GAP);
    // No asymmetric shorthand may reintroduce the uneven gap.
    expect(rule.style.marginTop).toBe(rule.style.marginBottom);
    const header = screen.getByTestId("folder-tree-header");
    expect(header.style.paddingTop).toBe("0px");
    expect(header.style.justifyContent).toBe("space-between");
    expect(screen.getByTestId("folder-tree-title")).toHaveTextContent(
      "Sessions",
    );
    expect(HISTORY_HAIRLINE_GAP).toBe("var(--space-2)");
    const videos = screen.getByTestId("nav-video");
    expect(videos.style.padding).toContain("var(--space-2)");
  });

  it("shows Sessions under the hairline on an empty Chatbot tree", async () => {
    renderApp("/chatbot");
    const rule = await screen.findByTestId("sidebar-history-hairline");
    expect(rule.style.marginBlock).toBe(HISTORY_HAIRLINE_GAP);
    const host = screen.getByTestId("sidebar-history-host");
    expect(host).toContainElement(screen.getByTestId("folder-tree-title"));
    expect(screen.getByTestId("folder-tree-title")).toHaveTextContent(
      "Sessions",
    );
    expect(screen.getByTestId("nav-chatbot")).toHaveAttribute(
      "aria-label",
      "Chatbot",
    );
  });
});

describe("thinking pill crop", () => {
  it("keeps the pending canvas fully inside the pill box", () => {
    expect(
      rectFullyInside(
        { left: 12, right: 60, top: 8, bottom: 56 },
        { left: 0, right: 180, top: 0, bottom: 64 },
      ),
    ).toBe(true);
    expect(
      rectFullyInside(
        { left: -2, right: 46, top: 8, bottom: 56 },
        { left: 0, right: 180, top: 0, bottom: 64 },
      ),
    ).toBe(false);

    render(
      <AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />,
    );
    const pill = screen.getByTestId("agent-state-orb");
    const canvas = screen.getByTestId("agent-state-orb-canvas");
    const chrome = screen.getByTestId("agent-state-orb-pill-chrome");
    expect(pill.style.overflow).toBe("visible");
    expect(pill.style.borderRadius).toBe("");
    expect(chrome.style.borderRadius).toBe("999px");
    expect(canvas.parentElement).toBe(pill);
    expect(chrome.parentElement).toBe(pill);
    expect(Number.parseInt(canvas.style.width, 10)).toBe(ORB_SIZE_BUBBLE);

    const pillBox = { left: 0, right: 200, top: 0, bottom: 64 };
    const canvasBox = {
      left: 12,
      right: 12 + ORB_SIZE_BUBBLE,
      top: 8,
      bottom: 8 + ORB_SIZE_BUBBLE,
    };
    vi.spyOn(pill, "getBoundingClientRect").mockReturnValue(pillBox as DOMRect);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
      canvasBox as DOMRect,
    );
    expect(
      rectFullyInside(
        canvas.getBoundingClientRect(),
        pill.getBoundingClientRect(),
      ),
    ).toBe(true);
  });

  it("keeps a fixed min-width and no second inset for rotating captions", () => {
    expect(longestPendingCaption()).toBe("Searching...");
    render(
      <AgentStateOrb activity="chat-streaming" size="bubble" rotateCaptions />,
    );
    const pill = screen.getByTestId("agent-state-orb");
    expect(pill.style.minWidth).toBe(pendingPillMinWidthExpr(ORB_SIZE_BUBBLE));
    expect(pill.style.minWidth).toContain(
      `${longestPendingCaption().length}ch`,
    );
    // v2.4.4 Phase 1.2: the list gutter is the only left offset.
    expect(pill.style.marginLeft).toBe("");
    expect(pill.style.overflow).toBe("visible");
    const caption = screen.getByTestId("agent-state-orb-caption");
    expect(caption.style.minWidth).toBe(`${longestPendingCaption().length}ch`);
  });
});

describe("scrollbar tokens", () => {
  it("declares a transparent track and scheme-matched thumb", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../src/styles/tokens.css"),
      "utf8",
    );
    expect(css).toContain("::-webkit-scrollbar");
    expect(css).toContain("scrollbar-color");
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toMatch(
      /::-webkit-scrollbar-track\s*\{\s*background:\s*transparent/,
    );
    expect(css).toContain("color-mix(in srgb, var(--fg-muted)");
  });
});
