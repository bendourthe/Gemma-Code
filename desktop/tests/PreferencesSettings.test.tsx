import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreferencesSettings } from "../src/pages/settings/PreferencesSettings";
import type { ListedModelDto } from "../src/pages/settings/modelsTypes";
import {
  readDefaultModel,
  readModelOrder,
  reorder,
} from "../src/shared/models/modelPreferences";
import { askBeforeModelSwitch } from "../src/shared/models/modelSwitchPreference";

// v2.4.8 follow-up (2026-09-07): the operator asked for one place that holds
// their own choices -- whether to be asked before a switch stops GPU work, and
// which model each category starts with and in what order.
const MODELS: ListedModelDto[] = [
  {
    id: "gemma-4-12b-it-gguf",
    displayName: "Gemma 4 12B",
    type: "llm",
    task: "chat",
    installed: true,
    source: "registry",
  },
  {
    id: "qwen3.5:4b",
    displayName: "Qwen 3.5 4B",
    type: "llm",
    task: "chat",
    installed: true,
    source: "registry",
  },
  {
    id: "realvisxl-v5",
    displayName: "RealVisXL V5.0",
    type: "image",
    task: "image",
    installed: true,
    source: "registry",
  },
  {
    id: "not-downloaded",
    displayName: "Not Downloaded",
    type: "llm",
    task: "chat",
    installed: false,
    source: "registry",
  },
];

function renderPage() {
  return render(<PreferencesSettings listModels={async () => MODELS} />);
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("PreferencesSettings", () => {
  it("lists only downloaded models, per category", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("prefs-category-chat")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("prefs-default-chat-gemma-4-12b-it-gguf"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("prefs-default-image-realvisxl-v5"),
    ).toBeInTheDocument();
    // A model that is not downloaded is not something to order or default to.
    expect(screen.queryByTestId("prefs-default-chat-not-downloaded")).toBeNull();
  });

  it("stores the default model for a category", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("prefs-default-chat-qwen3.5:4b")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("prefs-default-chat-qwen3.5:4b"));
    expect(readDefaultModel("chat")).toBe("qwen3.5:4b");
    // Clicking the current default clears it.
    await user.click(screen.getByTestId("prefs-default-chat-qwen3.5:4b"));
    expect(readDefaultModel("chat")).toBeNull();
  });

  it("stores a reordered category", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("prefs-up-chat-qwen3.5:4b")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("prefs-up-chat-qwen3.5:4b"));
    expect(readModelOrder("chat")).toEqual(["qwen3.5:4b", "gemma-4-12b-it-gguf"]);
  });

  it("turns the switch confirmation off and on", async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByTestId("prefs-ask-before-switch");
    expect(askBeforeModelSwitch()).toBe(true);
    await user.click(toggle);
    expect(askBeforeModelSwitch()).toBe(false);
    await user.click(toggle);
    expect(askBeforeModelSwitch()).toBe(true);
  });
});

describe("reorder", () => {
  it("moves one id one place and never off the ends", () => {
    expect(reorder(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(reorder(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(reorder(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(reorder(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(reorder(["a", "b"], "zz", "up")).toEqual(["a", "b"]);
  });
});
