/**
 * Phase 12 (v0.5.0) -- Predictive cache pre-warming.
 *
 * Tracks per-path tool-output access timestamps and forecasts likely-soon
 * accesses with a pure-JS ARIMA(1,0,1) model. The intent is to pre-`lookup`
 * a small handful of paths during idle time so the in-process LRU is warm
 * when the agent eventually re-reads them.
 *
 * Hard constraints (per the implementation plan):
 *   - Pure JavaScript: no model file, no native deps, no GPU cycles.
 *   - LSTM is explicitly out of scope -- not a replaceable backend, not a
 *     toggle. ARIMA(1,0,1) is the only forecaster.
 *   - Off by default. Enable via `gemma-code.predictiveCacheEnabled`.
 *   - Memory budget: at most ~250 KB across the active prediction set.
 *
 * The ARIMA model is fit by minimising one-step squared error over recent
 * inter-arrival deltas via gradient descent on the AR1 + MA1 coefficients.
 * Order (1,0,1) is sufficient for the dominant access patterns we see
 * (periodic re-reads of the same handful of files during iterative debug),
 * and the parameter count is small enough that fits stay under 50 ms even
 * with 1000 observations.
 */

/** Maximum number of (path, access-timestamps) entries we keep. */
const MAX_TRACKED_PATHS = 256;

/** Maximum access samples retained per path; older samples roll off. */
const MAX_SAMPLES_PER_PATH = 64;

/** Minimum samples before a path can be considered for prediction. */
const MIN_SAMPLES_FOR_PREDICT = 4;

/** Soft memory cap for predicted pre-warm payloads, bytes. */
export const PREDICTIVE_PRE_WARM_BUDGET_BYTES = 250 * 1024;

interface PathSeries {
  /** Monotonic millisecond timestamps; `samples[i+1] >= samples[i]`. */
  readonly samples: number[];
  /** Cached ARIMA fit; refreshed lazily when stale. */
  fit: ARIMAFit | null;
  /** Wall clock at last fit; we re-fit when new samples arrive. */
  fitAt: number;
}

interface ARIMAFit {
  readonly phi: number;
  readonly theta: number;
  readonly mean: number;
  readonly residual: number;
}

export class PredictiveCache {
  private readonly _series = new Map<string, PathSeries>();

  /** Record an access to `absolutePath` at the current wall clock. */
  observe(absolutePath: string, atMs: number = Date.now()): void {
    let series = this._series.get(absolutePath);
    if (!series) {
      // Hold to MAX_TRACKED_PATHS by dropping the oldest series; this is
      // the only memory-bound the module enforces internally.
      if (this._series.size >= MAX_TRACKED_PATHS) {
        const oldest = this._series.keys().next();
        if (!oldest.done) this._series.delete(oldest.value);
      }
      series = { samples: [], fit: null, fitAt: 0 };
      this._series.set(absolutePath, series);
    }
    series.samples.push(atMs);
    if (series.samples.length > MAX_SAMPLES_PER_PATH) {
      series.samples.splice(0, series.samples.length - MAX_SAMPLES_PER_PATH);
    }
    series.fit = null;
  }

  /**
   * Predict the top-K paths most likely to be re-accessed next, ranked by
   * confidence. Confidence is the inverse of the predicted next-arrival
   * delta scaled by the residual variance; higher is sooner-and-tighter.
   * Paths with too few samples (< MIN_SAMPLES_FOR_PREDICT) are skipped.
   */
  predict(topK: number, nowMs: number = Date.now()): string[] {
    const candidates: Array<{ path: string; score: number }> = [];
    for (const [path, series] of this._series) {
      if (series.samples.length < MIN_SAMPLES_FOR_PREDICT) continue;
      const lastTs = series.samples[series.samples.length - 1]!;
      const prevTs = series.samples[series.samples.length - 2]!;
      if (!series.fit || series.fitAt < lastTs) {
        series.fit = fitARIMA101(series.samples);
        series.fitAt = nowMs;
      }
      const fit = series.fit;
      if (!fit) continue;
      const lastDelta = lastTs - prevTs;
      const predictedDelta = forecastARIMA101(fit, lastDelta);
      // Lower predicted delta + lower residual = higher score. Floor the
      // delta at 1 ms to avoid div-by-zero on degenerate periodic input.
      const score = 1 / (Math.max(1, predictedDelta) * (1 + fit.residual));
      candidates.push({ path, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, Math.max(0, topK)).map((c) => c.path);
  }

  /** Drop all observed history. Test helper. */
  clear(): void {
    this._series.clear();
  }

  /** Diagnostic: number of distinct paths currently tracked. */
  trackedPathCount(): number {
    return this._series.size;
  }
}

/**
 * Fit ARIMA(1,0,1) coefficients on the inter-arrival delta series. We use
 * 200 iterations of plain gradient descent on (phi, theta) with a tiny
 * step size; this is deliberately simple -- not the fastest possible fit,
 * but well under 50 ms for 1000 observations and bullet-proof to read.
 */
export function fitARIMA101(samples: number[]): ARIMAFit | null {
  if (samples.length < MIN_SAMPLES_FOR_PREDICT) return null;
  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const d = (samples[i] ?? 0) - (samples[i - 1] ?? 0);
    deltas.push(Number.isFinite(d) ? d : 0);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  // Centre the series; the (0) in (1,0,1) means no differencing, but
  // mean-centring gives the AR/MA coefficients a clean target.
  const centred = deltas.map((d) => d - mean);

  let phi = 0;
  let theta = 0;
  const lr = 0.001;
  const eps = 1e-6;
  for (let iter = 0; iter < 200; iter++) {
    let dPhi = 0;
    let dTheta = 0;
    let prevResid = 0;
    for (let t = 1; t < centred.length; t++) {
      const ct = centred[t] ?? 0;
      const ctPrev = centred[t - 1] ?? 0;
      const pred = phi * ctPrev + theta * prevResid;
      const resid = ct - pred;
      dPhi += -2 * resid * ctPrev;
      dTheta += -2 * resid * prevResid;
      prevResid = resid;
    }
    phi -= lr * dPhi;
    theta -= lr * dTheta;
    // Constrain to invertible region; numerical drift is the main risk.
    if (phi > 0.99) phi = 0.99;
    if (phi < -0.99) phi = -0.99;
    if (theta > 0.99) theta = 0.99;
    if (theta < -0.99) theta = -0.99;
    if (Math.abs(dPhi) < eps && Math.abs(dTheta) < eps) break;
  }
  // Final residual variance for confidence scoring.
  let prevResid = 0;
  let sse = 0;
  for (let t = 1; t < centred.length; t++) {
    const ct = centred[t] ?? 0;
    const ctPrev = centred[t - 1] ?? 0;
    const pred = phi * ctPrev + theta * prevResid;
    const resid = ct - pred;
    sse += resid * resid;
    prevResid = resid;
  }
  const residual = Math.sqrt(sse / Math.max(1, centred.length - 1));
  return { phi, theta, mean, residual };
}

/**
 * One-step forecast given the most recent observed delta. Bounded below
 * at 0 because negative inter-arrival deltas are nonsensical.
 */
export function forecastARIMA101(fit: ARIMAFit, lastDelta: number): number {
  const centredLast = lastDelta - fit.mean;
  const predCentred = fit.phi * centredLast;
  return Math.max(0, predCentred + fit.mean);
}
