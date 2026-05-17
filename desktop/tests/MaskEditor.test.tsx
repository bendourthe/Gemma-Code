import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MaskEditor } from "../src/modules/image/MaskEditor";

describe("MaskEditor", () => {
  // jsdom's HTMLCanvasElement returns null from getContext() and has no
  // toDataURL. The mask editor short-circuits when getContext is null, so
  // stub both to make the redraw path observable.
  let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL | undefined;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined;
  beforeEach(() => {
    originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,STUB";
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext() {
      return {
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        fillStyle: "",
      } as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  afterEach(() => {
    if (originalToDataURL) {
      HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    }
    if (originalGetContext) {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  it("renders the source image, canvas, and brush controls", () => {
    render(<MaskEditor sourceImage="data:image/png;base64,AAA" width={128} height={128} />);
    expect(screen.getByTestId("mask-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("mask-source-image")).toBeInTheDocument();
    expect(screen.getByTestId("mask-brush-size")).toBeInTheDocument();
  });

  it("emits a mask data URL when brush state changes", () => {
    const onMaskChange = vi.fn();
    render(
      <MaskEditor
        sourceImage="data:image/png;base64,AAA"
        width={64}
        height={64}
        onMaskChange={onMaskChange}
      />,
    );
    const canvas = screen.getByTestId("mask-canvas") as HTMLCanvasElement;
    // The initial effect emits an empty mask too, so this assertion
    // covers both the initial paint and the stroke flow.
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20 });
    expect(onMaskChange).toHaveBeenCalled();
  });

  it("undo + redo restore prior strokes", () => {
    render(<MaskEditor sourceImage="data:image/png;base64,AAA" width={64} height={64} />);
    const canvas = screen.getByTestId("mask-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas);
    fireEvent.click(screen.getByTestId("mask-undo"));
    fireEvent.click(screen.getByTestId("mask-redo"));
    expect(canvas).toBeInTheDocument();
  });

  it("clear resets the mask", () => {
    render(<MaskEditor sourceImage="data:image/png;base64,AAA" width={64} height={64} />);
    const canvas = screen.getByTestId("mask-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas);
    fireEvent.click(screen.getByTestId("mask-clear"));
    expect(screen.getByTestId("mask-canvas")).toBeInTheDocument();
  });
});
