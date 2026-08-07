/**
 * v1.0.0 Phase 6.5 -- HTML5 canvas mask editor.
 *
 * RETAINED, NOT DEAD (v1.15.0 Phase 8 refactor triage): the Phase 5 chat
 * redesign retired the Inpaint mode tab that used to mount this, so nothing in
 * the app renders it today -- but it stays (and stays unit-tested) because it is
 * exactly the component the deferred inline "paint a mask on an attachment"
 * affordance needs. See known gap IRSC.P5.A. Delete only if that gap is closed
 * as won't-do.
 *
 * Renders the source
 * image and lets the user paint a binary mask on top of it; the
 * alpha channel of the overlay becomes the mask passed to the
 * `diffusion.inpaint` IPC method.
 *
 * Keeps the brush state local so the page only deals with the final
 * mask payload (`maskBase64`) when the user clicks Generate.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface MaskEditorProps {
  readonly sourceImage: string;
  readonly width: number;
  readonly height: number;
  readonly onMaskChange?: (maskBase64: string) => void;
}

interface Stroke {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export function MaskEditor({
  sourceImage,
  width,
  height,
  onMaskChange,
}: MaskEditorProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [brushSize, setBrushSize] = useState(32);
  const [strokes, setStrokes] = useState<Stroke[][]>([]);
  const historyRef = useRef<Stroke[][][]>([]);
  const redoRef = useRef<Stroke[][][]>([]);
  const isPaintingRef = useRef(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (const stroke of strokes) {
      for (const point of stroke) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (onMaskChange) {
      onMaskChange(canvas.toDataURL("image/png"));
    }
  }, [strokes, onMaskChange]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function pointerCoords(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    isPaintingRef.current = true;
    const point = pointerCoords(event);
    historyRef.current.push(strokes);
    redoRef.current = [];
    setStrokes((prev) => [...prev, [{ ...point, size: brushSize }]]);
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!isPaintingRef.current) return;
    const point = pointerCoords(event);
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      const last = next[next.length - 1] ?? [];
      next[next.length - 1] = [...last, { ...point, size: brushSize }];
      return next;
    });
  }

  function endStroke(): void {
    isPaintingRef.current = false;
  }

  function undo(): void {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current.pop() ?? [];
    redoRef.current.push(strokes);
    setStrokes(previous);
  }

  function redo(): void {
    if (redoRef.current.length === 0) return;
    const restored = redoRef.current.pop() ?? [];
    historyRef.current.push(strokes);
    setStrokes(restored);
  }

  function clear(): void {
    historyRef.current.push(strokes);
    redoRef.current = [];
    setStrokes([]);
  }

  return (
    <div data-testid="mask-editor" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: width,
          aspectRatio: `${width} / ${height}`,
          backgroundColor: "var(--bg-1)",
        }}
      >
        <img
          alt="Source"
          src={sourceImage}
          data-testid="mask-source-image"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 0.85,
          }}
        />
        <canvas
          ref={canvasRef}
          data-testid="mask-canvas"
          width={width}
          height={height}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair" }}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <label style={{ fontSize: "var(--text-sm)", color: "var(--fg-1)" }}>
          Brush
          <input
            data-testid="mask-brush-size"
            type="range"
            min={4}
            max={128}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ marginLeft: "var(--space-2)" }}
          />
        </label>
        <button data-testid="mask-undo" onClick={undo} type="button">
          Undo
        </button>
        <button data-testid="mask-redo" onClick={redo} type="button">
          Redo
        </button>
        <button data-testid="mask-clear" onClick={clear} type="button">
          Clear
        </button>
      </div>
    </div>
  );
}
