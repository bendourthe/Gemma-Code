/**
 * Tiny WebGL helper for the liquid-metal ring. Reverse-engineered metal-fx
 * idea (a flowing specular on a rounded ring); no package import. Nexus
 * accent tints only -- no gold / silver / chromatic palettes.
 */

export type MetalAccentToken =
  | "--accent-coding"
  | "--accent-chatbot"
  | "--accent-image"
  | "--accent-video";

/** Linear RGB matching tokens.css hex values. */
export const METAL_TINT: Record<MetalAccentToken, readonly [number, number, number]> = {
  "--accent-coding": [0.925, 0.282, 0.6],
  "--accent-chatbot": [0.133, 0.827, 0.933],
  "--accent-image": [0.976, 0.451, 0.086],
  "--accent-video": [0.133, 0.773, 0.369],
};

export const METAL_MAX_DPR = 2;

export function metalTokenFromCssVar(token: string): MetalAccentToken {
  if (token === "--accent-chatbot") return "--accent-chatbot";
  if (token === "--accent-image") return "--accent-image";
  if (token === "--accent-video") return "--accent-video";
  return "--accent-coding";
}

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_tint;
uniform float u_strength;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * 2.0 - 1.0;
  float aspect = u_res.x / max(u_res.y, 1.0);
  p.x *= aspect;
  vec2 b = vec2(aspect * 0.78, 0.62);
  vec2 q = abs(p) - b;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float ring = smoothstep(0.14, 0.03, abs(d + 0.02) - 0.045);
  float angle = atan(p.y, p.x) + u_time * 1.35;
  float spec = pow(0.5 + 0.5 * sin(angle * 2.0 + u_time * 0.7), 10.0);
  vec3 metal = mix(u_tint * 0.45, vec3(0.88, 0.93, 1.0), spec);
  gl_FragColor = vec4(metal, ring * u_strength);
}
`;

export interface MetalProgram {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uTint: WebGLUniformLocation | null;
  uStrength: WebGLUniformLocation | null;
}

export function clampMetalDpr(dpr: number): number {
  const safe = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(Math.max(safe, 1), METAL_MAX_DPR);
}

export function requestMetalContext(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  try {
    const gl2 = canvas.getContext("webgl2");
    if (gl2) return gl2 as unknown as WebGLRenderingContext;
    return canvas.getContext("webgl");
  } catch {
    return null;
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createMetalProgram(gl: WebGLRenderingContext): MetalProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return {
    gl,
    program,
    uRes: gl.getUniformLocation(program, "u_res"),
    uTime: gl.getUniformLocation(program, "u_time"),
    uTint: gl.getUniformLocation(program, "u_tint"),
    uStrength: gl.getUniformLocation(program, "u_strength"),
  };
}

export function drawMetalFrame(
  metal: MetalProgram,
  width: number,
  height: number,
  time: number,
  tint: readonly [number, number, number],
  strength: number,
): void {
  const { gl } = metal;
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(metal.program);
  if (metal.uRes) gl.uniform2f(metal.uRes, width, height);
  if (metal.uTime) gl.uniform1f(metal.uTime, time);
  if (metal.uTint) gl.uniform3f(metal.uTint, tint[0], tint[1], tint[2]);
  if (metal.uStrength) gl.uniform1f(metal.uStrength, strength);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
