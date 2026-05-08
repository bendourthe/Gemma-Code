// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  compilePermissionPrompt,
  defaultPermissionOptions,
  PERMISSION_PROMPT_FN_SOURCE,
  type PermissionPromptPayload,
  type PermissionPromptResolution,
} from "../../../../../src/panels/webview/render/permissionPrompt.js";

const renderPermissionPrompt = compilePermissionPrompt(document);

function basePayload(overrides: Partial<PermissionPromptPayload> = {}): PermissionPromptPayload {
  return {
    id: "p-1",
    toolName: "run_terminal",
    description: "Execute shell command",
    commandEcho: "npm test",
    options: defaultPermissionOptions("run_terminal"),
    ...overrides,
  };
}

function dispatchKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("renderPermissionPrompt", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the tool name, description, and command echo", () => {
    const card = renderPermissionPrompt(basePayload(), () => {});
    document.body.appendChild(card);

    expect(card.querySelector(".permission-prompt-tool")?.textContent).toBe("run_terminal");
    expect(card.querySelector(".permission-prompt-description")?.textContent).toBe(
      "Execute shell command",
    );
    expect(card.querySelector(".permission-prompt-command")?.textContent).toBe("npm test");
  });

  it("renders all four numbered options with the correct labels", () => {
    const card = renderPermissionPrompt(basePayload(), () => {});
    document.body.appendChild(card);

    const buttons = card.querySelectorAll<HTMLButtonElement>(".permission-prompt-button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.textContent).toBe("1 - Yes");
    expect(buttons[1]?.textContent).toContain("Yes, allow run_terminal for all projects");
    expect(buttons[2]?.textContent).toBe("3 - No");
    expect(buttons[3]?.textContent).toContain("Tell Gemma what to do instead");
  });

  it("digit shortcut 1 resolves to yes", () => {
    const onResolve = vi.fn<(r: PermissionPromptResolution) => void>();
    const card = renderPermissionPrompt(basePayload(), onResolve);
    document.body.appendChild(card);
    dispatchKey("1");
    expect(onResolve).toHaveBeenCalledWith({ value: "yes", freeformText: undefined });
  });

  it("digit shortcut 2 resolves to yes-for-all", () => {
    const onResolve = vi.fn<(r: PermissionPromptResolution) => void>();
    const card = renderPermissionPrompt(basePayload(), onResolve);
    document.body.appendChild(card);
    dispatchKey("2");
    expect(onResolve).toHaveBeenCalledWith({ value: "yes-for-all", freeformText: undefined });
  });

  it("digit shortcut 3 resolves to no", () => {
    const onResolve = vi.fn<(r: PermissionPromptResolution) => void>();
    const card = renderPermissionPrompt(basePayload(), onResolve);
    document.body.appendChild(card);
    dispatchKey("3");
    expect(onResolve).toHaveBeenCalledWith({ value: "no", freeformText: undefined });
  });

  it("alias 'y' resolves to yes; 'n' resolves to no; 'a' resolves to yes-for-all", () => {
    const yes = vi.fn();
    const card1 = renderPermissionPrompt(basePayload(), yes);
    document.body.appendChild(card1);
    dispatchKey("y");
    expect(yes).toHaveBeenCalledWith({ value: "yes", freeformText: undefined });
    document.body.innerHTML = "";

    const no = vi.fn();
    const card2 = renderPermissionPrompt(basePayload(), no);
    document.body.appendChild(card2);
    dispatchKey("n");
    expect(no).toHaveBeenCalledWith({ value: "no", freeformText: undefined });
    document.body.innerHTML = "";

    const all = vi.fn();
    const card3 = renderPermissionPrompt(basePayload(), all);
    document.body.appendChild(card3);
    dispatchKey("a");
    expect(all).toHaveBeenCalledWith({ value: "yes-for-all", freeformText: undefined });
  });

  it("Esc resolves to no; Enter resolves to yes", () => {
    const onResolveEsc = vi.fn();
    const card = renderPermissionPrompt(basePayload(), onResolveEsc);
    document.body.appendChild(card);
    dispatchKey("Escape");
    expect(onResolveEsc).toHaveBeenCalledWith({ value: "no", freeformText: undefined });
    document.body.innerHTML = "";

    const onResolveEnter = vi.fn();
    const card2 = renderPermissionPrompt(basePayload(), onResolveEnter);
    document.body.appendChild(card2);
    dispatchKey("Enter");
    expect(onResolveEnter).toHaveBeenCalledWith({ value: "yes", freeformText: undefined });
  });

  it("digit 4 reveals the freeform input but does not resolve until Enter is pressed in the textarea", () => {
    const onResolve = vi.fn();
    const card = renderPermissionPrompt(basePayload(), onResolve);
    document.body.appendChild(card);
    dispatchKey("4");
    const wrap = card.querySelector<HTMLDivElement>(".permission-prompt-freeform");
    expect(wrap?.hidden).toBe(false);
    expect(onResolve).not.toHaveBeenCalled();

    const input = card.querySelector<HTMLTextAreaElement>(".permission-prompt-freeform-input");
    if (!input) throw new Error("freeform input missing");
    input.value = "use a different approach";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onResolve).toHaveBeenCalledWith({
      value: "freeform",
      freeformText: "use a different approach",
    });
  });

  it("ignores keystrokes after the prompt has been resolved", () => {
    const onResolve = vi.fn();
    const card = renderPermissionPrompt(basePayload(), onResolve);
    document.body.appendChild(card);
    dispatchKey("1");
    dispatchKey("3");
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(card.classList.contains("permission-prompt-resolved")).toBe(true);
  });

  it("never assigns user-supplied text to innerHTML", () => {
    expect(PERMISSION_PROMPT_FN_SOURCE.includes("innerHTML")).toBe(false);
  });
});
