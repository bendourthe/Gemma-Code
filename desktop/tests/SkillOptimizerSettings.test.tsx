import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  SkillOptimizerSettings,
  type SkillOptimizerClient,
} from "../src/pages/settings/SkillOptimizerSettings";

// v1.12.0 EM.P2.A -- the approval panel. The guardrail under test: preview writes
// nothing (apply is never called on preview), and an edit is applied only when
// the user clicks Approve, with the exact token+proposalId round-tripped.

function fakeClient(overrides: Partial<SkillOptimizerClient> = {}): SkillOptimizerClient {
  return {
    preview: async () => ({
      token: "tok",
      proposals: [
        { id: "0", skillId: "nexus-hub/x", skillPath: "/c/x/SKILL.md", diff: "+ add a rule" },
      ],
    }),
    apply: async () => ({ applied: true, skillPath: "/c/x/SKILL.md" }),
    ...overrides,
  };
}

describe("SkillOptimizerSettings (EM.P2.A)", () => {
  it("previews proposals and writes one ONLY on approval", async () => {
    const apply = vi.fn(async () => ({ applied: true, skillPath: "/c/x/SKILL.md" }));
    render(<SkillOptimizerSettings client={fakeClient({ apply })} />);

    fireEvent.change(screen.getByTestId("skill-optimizer-skill-id"), {
      target: { value: "nexus-hub/x" },
    });
    fireEvent.click(screen.getByTestId("skill-optimizer-preview"));

    await waitFor(() =>
      expect(screen.getByTestId("skill-optimizer-proposal-0")).toBeInTheDocument(),
    );
    expect(screen.getByText("+ add a rule")).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled(); // nothing written by preview

    fireEvent.click(screen.getByTestId("skill-optimizer-approve-0"));
    await waitFor(() =>
      expect(screen.getByTestId("skill-optimizer-approve-0")).toHaveTextContent("Written"),
    );
    expect(apply).toHaveBeenCalledWith("tok", "0");
  });

  it("shows the empty state when the skill already passes", async () => {
    render(
      <SkillOptimizerSettings
        client={fakeClient({ preview: async () => ({ token: "t", proposals: [] }) })}
      />,
    );
    fireEvent.change(screen.getByTestId("skill-optimizer-skill-id"), { target: { value: "s" } });
    fireEvent.click(screen.getByTestId("skill-optimizer-preview"));
    await waitFor(() => expect(screen.getByTestId("skill-optimizer-empty")).toBeInTheDocument());
  });

  it("surfaces a preview error", async () => {
    render(
      <SkillOptimizerSettings
        client={fakeClient({
          preview: async () => {
            throw new Error("boom");
          },
        })}
      />,
    );
    fireEvent.change(screen.getByTestId("skill-optimizer-skill-id"), { target: { value: "s" } });
    fireEvent.click(screen.getByTestId("skill-optimizer-preview"));
    await waitFor(() =>
      expect(screen.getByTestId("skill-optimizer-error")).toHaveTextContent("boom"),
    );
  });
});
