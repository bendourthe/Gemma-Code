import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComposerContextRow } from "../src/shared/chat/ComposerContextRow";
import { ContextUsageBar } from "../src/shared/chat/ContextUsageBar";
import type { SessionContextUsage } from "../../core/chat/sessionContextUsage";

function usage(over: Partial<SessionContextUsage>): SessionContextUsage {
  return {
    usedTokens: 0,
    percent: 0,
    atOrAbove80: false,
    estimated: false,
    denominatorKind: "llm",
    ...over,
  };
}

describe("ContextUsageBar", () => {
  it("hides when percent is null", () => {
    const { container } = render(
      <ContextUsageBar usage={usage({ percent: null, denominatorKind: "none" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 79% without a new-session CTA", () => {
    render(
      <ComposerContextRow usage={usage({ percent: 79, atOrAbove80: false, usedTokens: 79 })}>
        <span data-testid="picker">picker</span>
      </ComposerContextRow>,
    );
    expect(screen.getByTestId("context-usage-percent")).toHaveTextContent("79%");
    expect(screen.queryByTestId("context-usage-cta")).toBeNull();
    expect(screen.getByTestId("picker")).toBeInTheDocument();
  });

  // v2.2.9 Phase 1.2 (T002): the Context bar is the wide control (~70-75%)
  // and the picker is a bounded trailing control on one non-wrapping row.
  it("grows the Context bar and bounds the picker slot", () => {
    render(
      <ComposerContextRow usage={usage({ percent: 42, usedTokens: 42 })}>
        <span data-testid="picker">picker</span>
      </ComposerContextRow>,
    );
    const bar = screen.getByTestId("context-usage-bar");
    expect(bar.style.flex).toBe("3 1 auto");
    const slot = screen.getByTestId("composer-picker-slot");
    expect(slot.style.flex).toBe("0 1 30%");
    expect(slot.style.maxWidth).toBe("30%");
    expect(slot.style.minWidth).toBe("14rem");
    const row = bar.parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe("nowrap");
  });

  it("keeps the picker full-width and invents no bar when denominatorKind is none", () => {
    render(
      <ComposerContextRow usage={usage({ percent: null, denominatorKind: "none" })}>
        <span data-testid="picker">picker</span>
      </ComposerContextRow>,
    );
    expect(screen.queryByTestId("context-usage-bar")).toBeNull();
    const slot = screen.getByTestId("composer-picker-slot");
    expect(slot.style.flex).toBe("1 1 auto");
    expect(screen.getByTestId("picker")).toBeInTheDocument();
  });

  it("shows the 80% CTA once and clicking it does not remove the picker", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(
      <ComposerContextRow
        usage={usage({ percent: 80, atOrAbove80: true, usedTokens: 80 })}
        onStartNewSession={onStart}
      >
        <span data-testid="picker">picker</span>
      </ComposerContextRow>,
    );
    expect(screen.getByTestId("context-usage-cta")).toBeInTheDocument();
    await user.click(screen.getByTestId("context-usage-new-session"));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("picker")).toBeInTheDocument();
  });

  it("quotes the live percent in the warning, not a hardcoded 80", () => {
    render(
      <ComposerContextRow
        usage={usage({ percent: 100, atOrAbove80: true, usedTokens: 8, denominatorKind: "visual" })}
        onStartNewSession={() => undefined}
      >
        <span>picker</span>
      </ComposerContextRow>,
    );
    expect(screen.getByTestId("context-usage-cta")).toHaveTextContent("This session is at 100% of context");
    expect(screen.getByTestId("context-usage-cta").textContent).not.toMatch(/at 80% of context\. Starting/);
  });
});
