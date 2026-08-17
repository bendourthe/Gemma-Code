import { describe, expect, it, vi } from "vitest";
import {
  clampMetalDpr,
  createMetalProgram,
  drawMetalFrame,
  METAL_MAX_DPR,
  METAL_TINT,
  metalTokenFromCssVar,
  requestMetalContext,
} from "../src/components/metalGl";

function stubGl(overrides: Record<string, unknown> = {}): WebGLRenderingContext {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    BLEND: 3042,
    COLOR_BUFFER_BIT: 16384,
    TRIANGLES: 4,
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    deleteShader: () => undefined,
    createProgram: () => ({}),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    useProgram: () => undefined,
    createBuffer: () => ({}),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    enable: () => undefined,
    blendFunc: () => undefined,
    getUniformLocation: () => ({}),
    viewport: () => undefined,
    clearColor: () => undefined,
    clear: () => undefined,
    uniform2f: () => undefined,
    uniform1f: () => undefined,
    uniform3f: () => undefined,
    drawArrays: () => undefined,
    ...overrides,
  } as unknown as WebGLRenderingContext;
}

describe("metalGl", () => {
  it("maps CSS accent vars onto locked tokens and tints", () => {
    expect(metalTokenFromCssVar("--accent-coding")).toBe("--accent-coding");
    expect(metalTokenFromCssVar("--accent-chatbot")).toBe("--accent-chatbot");
    expect(metalTokenFromCssVar("--accent-image")).toBe("--accent-image");
    expect(metalTokenFromCssVar("--accent-video")).toBe("--accent-video");
    expect(metalTokenFromCssVar("--unknown")).toBe("--accent-coding");
    expect(METAL_TINT["--accent-coding"]).toEqual([0.925, 0.282, 0.6]);
    expect(METAL_TINT["--accent-chatbot"]).toEqual([0.133, 0.827, 0.933]);
    expect(METAL_TINT["--accent-image"]).toEqual([0.976, 0.451, 0.086]);
    expect(METAL_TINT["--accent-video"]).toEqual([0.133, 0.773, 0.369]);
  });

  it("clamps device pixel ratio to [1, 2]", () => {
    expect(clampMetalDpr(1)).toBe(1);
    expect(clampMetalDpr(3)).toBe(METAL_MAX_DPR);
    expect(clampMetalDpr(0)).toBe(1);
    expect(clampMetalDpr(Number.NaN)).toBe(1);
  });

  it("compiles a program against a stub GL context and draws a frame", () => {
    const drawArrays = vi.fn();
    const gl = stubGl({ drawArrays });
    const program = createMetalProgram(gl);
    expect(program).not.toBeNull();
    if (!program) return;
    drawMetalFrame(program, 80, 32, 0.5, METAL_TINT["--accent-coding"], 0.8);
    expect(drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
  });

  it("returns null when shader compile fails", () => {
    const gl = stubGl({ getShaderParameter: () => false, createShader: () => ({}) });
    expect(createMetalProgram(gl)).toBeNull();
  });

  it("returns null when createShader fails", () => {
    const gl = stubGl({ createShader: () => null });
    expect(createMetalProgram(gl)).toBeNull();
  });

  it("returns null when program link fails", () => {
    const gl = stubGl({ getProgramParameter: () => false });
    expect(createMetalProgram(gl)).toBeNull();
  });

  it("requestMetalContext prefers webgl2, then webgl, and swallows throws", () => {
    const canvas = document.createElement("canvas");
    const gl = stubGl();
    const spy = vi.spyOn(canvas, "getContext").mockImplementation((type: string) => {
      if (type === "webgl2") return gl as unknown as RenderingContext;
      return null;
    });
    expect(requestMetalContext(canvas)).toBe(gl);
    spy.mockImplementation((type: string) => {
      if (type === "webgl2") return null;
      if (type === "webgl") return gl as unknown as RenderingContext;
      return null;
    });
    expect(requestMetalContext(canvas)).toBe(gl);
    spy.mockImplementation(() => {
      throw new Error("no gl");
    });
    expect(requestMetalContext(canvas)).toBeNull();
    spy.mockRestore();
  });

  it("returns null when createProgram fails", () => {
    const gl = stubGl({ createProgram: () => null });
    expect(createMetalProgram(gl)).toBeNull();
  });
});
