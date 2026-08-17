import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodingInput } from "../src/modules/coding/CodingInput";

describe("CodingInput", () => {
  it("submits on Send button click", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hi agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    expect(onSubmit).toHaveBeenCalledWith("Hi agent");
  });

  it("submits on Enter (without Shift) and clears the input", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    const ta = screen.getByTestId("coding-input-textarea") as HTMLTextAreaElement;
    await userEvent.type(ta, "Run /plan{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Run /plan");
    expect(ta.value).toBe("");
  });

  it("Shift+Enter inserts a newline without submitting", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    const ta = screen.getByTestId("coding-input-textarea") as HTMLTextAreaElement;
    await userEvent.type(ta, "line1{Shift>}{Enter}{/Shift}line2");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(ta.value).toContain("line1\nline2");
  });

  it("shows the slash-command dropdown when input begins with /", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "/pl");
    expect(screen.getByTestId("coding-input-suggestions")).toBeInTheDocument();
    expect(screen.getByTestId("slash-plan")).toBeInTheDocument();
  });

  it("hides the dropdown for non-slash input", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "hello");
    expect(screen.queryByTestId("coding-input-suggestions")).toBeNull();
  });

  it("clicking a suggestion pre-fills the textarea with its template", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "/com");
    await userEvent.click(screen.getByTestId("slash-commit"));
    const ta = screen.getByTestId("coding-input-textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("/commit");
  });

  it("submit button is disabled while input is empty or whitespace", () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    const btn = screen.getByTestId("coding-input-submit");
    expect(btn).toBeDisabled();
  });

  it("disabled prop disables the entire control", () => {
    render(<CodingInput disabled onSubmit={vi.fn()} />);
    expect(screen.getByTestId("coding-input-textarea")).toBeDisabled();
    expect(screen.getByTestId("coding-input-submit")).toBeDisabled();
  });

  it("plays a breathing beam on focus and a traveling beam while streaming", async () => {
    const { rerender } = render(<CodingInput onSubmit={vi.fn()} />);
    const beam = screen.getByTestId("coding-composer-beam");
    expect(beam).toHaveAttribute("data-beam-playing", "false");
    await userEvent.click(screen.getByTestId("coding-input-textarea"));
    expect(beam).toHaveAttribute("data-beam-playing", "true");
    expect(beam).toHaveAttribute("data-beam-mode", "breathing");
    rerender(<CodingInput onSubmit={vi.fn()} streaming />);
    expect(screen.getByTestId("coding-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
    expect(screen.getByTestId("coding-composer-beam")).toHaveAttribute("data-beam-playing", "true");
  });

  it("wraps Send in metal and leaves slash suggestions without it", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    const send = screen.getByTestId("coding-input-submit");
    expect(send.closest("[data-testid='coding-input-submit-metal']")).not.toBeNull();
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "/pl");
    expect(screen.getByTestId("slash-plan").closest("[data-testid$='-metal']")).toBeNull();
  });
});
