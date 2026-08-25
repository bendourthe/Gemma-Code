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
});
