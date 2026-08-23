import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodingInput } from "../src/modules/coding/CodingInput";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

describe("CodingInput", () => {
  it("submits on Send button click", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "Hi agent");
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    expect(onSubmit).toHaveBeenCalledWith("Hi agent", []);
  });

  it("submits on Enter (without Shift) and clears the input", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    const ta = screen.getByTestId("coding-input-textarea") as HTMLTextAreaElement;
    await userEvent.type(ta, "Run /plan{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Run /plan", []);
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

  it("on focus plays the surface beam; streaming plays a traveling beam", async () => {
    const { rerender } = render(<CodingInput onSubmit={vi.fn()} />);
    const beam = screen.getByTestId("coding-composer-beam");
    expect(beam).toHaveAttribute("data-beam-playing", "false");
    await userEvent.click(screen.getByTestId("coding-input-textarea"));
    expect(beam).toHaveAttribute("data-beam-playing", "true");
    expect(screen.queryByTestId("coding-input-submit-metal")).toBeNull();
    rerender(<CodingInput onSubmit={vi.fn()} streaming />);
    expect(screen.getByTestId("coding-composer-beam")).toHaveAttribute("data-beam-mode", "traveling");
    expect(screen.getByTestId("coding-composer-beam")).toHaveAttribute("data-beam-playing", "true");
  });

  it("groups + and icon send inside the surface with no Send caption", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    const surface = screen.getByTestId("coding-input-surface");
    const send = screen.getByTestId("coding-input-submit");
    expect(surface.contains(screen.getByTestId("coding-input-add"))).toBe(true);
    expect(surface.contains(send)).toBe(true);
    expect(send).toHaveAttribute("aria-label", "Send");
    expect(send.querySelector("svg")).not.toBeNull();
    const caption = Array.from(send.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .join("");
    expect(caption).toBe("");
    expect(send.closest("[data-testid='coding-input-submit-metal']")).toBeNull();
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "/pl");
    expect(screen.getByTestId("slash-plan").closest("[data-testid$='-metal']")).toBeNull();
  });

  it("accepts a dropped PDF and enables send without typed text", async () => {
    const onSubmit = vi.fn();
    render(<CodingInput onSubmit={onSubmit} />);
    await userEvent.upload(
      screen.getByTestId("coding-input-file"),
      file("doc.pdf", "application/pdf"),
    );
    await waitFor(() => expect(screen.getByTestId("coding-input-doc-0")).toBeInTheDocument());
    expect(screen.getByTestId("coding-input-submit")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("coding-input-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [text, attachments] = onSubmit.mock.calls[0] as [string, string[]];
    expect(text).toBe("");
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toContain("base64,");
  });

  it("accepts a Word file on the shared document accept list", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    await userEvent.upload(
      screen.getByTestId("coding-input-file"),
      file(
        "notes.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );
    await waitFor(() => expect(screen.getByTestId("coding-input-doc-0")).toBeInTheDocument());
  });

  it("drops a PDF onto the composer", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    fireEvent.drop(screen.getByTestId("coding-input"), {
      dataTransfer: {
        files: [file("scan.pdf", "application/pdf")],
      },
    });
    await waitFor(() => expect(screen.getByTestId("coding-input-doc-0")).toBeInTheDocument());
  });

  it("pastes a clipboard image as an attachment", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    const ta = screen.getByTestId("coding-input-textarea");
    const image = file("clip.png", "image/png");
    fireEvent.paste(ta, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image,
          },
        ],
      },
    });
    await waitFor(() => expect(screen.getByTestId("coding-input-thumb-0")).toBeInTheDocument());
  });

  it("still shows slash suggestions when the value starts with /", async () => {
    render(<CodingInput onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByTestId("coding-input-textarea"), "/rec");
    expect(screen.getByTestId("coding-input-suggestions")).toBeInTheDocument();
  });
});
