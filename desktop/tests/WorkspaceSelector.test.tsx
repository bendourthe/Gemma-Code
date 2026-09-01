import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceSelector } from "../src/modules/coding/WorkspaceSelector";
import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import { setWorkspaceDialogOverride } from "../src/lib/workspacePicker";

describe("WorkspaceSelector", () => {
  afterEach(() => {
    clearInvokeOverride();
    setWorkspaceDialogOverride(null);
  });

  it("leaves the workspace unchanged when the native picker is canceled", async () => {
    const add = vi.fn();
    setWorkspaceDialogOverride(async () => null);
    render(
      <WorkspaceSelector
        selection={{ roots: ["C:\\work"], primaryRoot: "C:\\work" }}
        onReplacePrimary={vi.fn()}
        onAdd={add}
        onRemove={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("coding-workspace-add"));
    await waitFor(() => expect(add).not.toHaveBeenCalled());
    expect(screen.getByTestId("coding-workspace-primary")).toHaveAttribute("title", "C:\\work");
  });

  it("ignores a stale picker result when a newer request is queued", async () => {
    let resolveFirst!: (value: string[]) => void;
    const first = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });
    let opens = 0;
    setWorkspaceDialogOverride(async () => {
      opens += 1;
      return opens === 1 ? first : ["E:\\newer"];
    });
    setInvokeOverride(async (command, args) => {
      if (command === "canonicalize_workspace_roots") return args?.paths ?? [];
      throw new Error(`unexpected command: ${command}`);
    });
    const add = vi.fn();
    render(
      <WorkspaceSelector
        selection={{ roots: ["C:\\work"], primaryRoot: "C:\\work" }}
        onReplacePrimary={vi.fn()}
        onAdd={add}
        onRemove={vi.fn()}
        onError={vi.fn()}
      />,
    );
    const button = screen.getByTestId("coding-workspace-add");
    await userEvent.click(button);
    await userEvent.click(button);
    resolveFirst(["D:\\older"]);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith(["E:\\newer"]);
  });
});
