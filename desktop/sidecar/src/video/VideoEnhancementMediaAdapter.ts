import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
  VideoEnhancementStagedSuccess,
  VideoSourceIdentity,
} from "../../../../core/video/VideoEnhancement.js";
import {
  serializeVideoWorkflowMetadata,
  type VideoWorkflowMetadata,
} from "../../../../core/video/WorkflowMetadata.js";
import {
  VideoEnhancementMediaLifecycle,
  VideoEnhancementMediaLifecycleError,
  type PreparedEnhancedVideoPublication,
  type VideoMediaFileIdentity,
} from "./VideoEnhancementMediaLifecycle.js";
import {
  VideoEnhancementRuntimePortError,
  type PublishedVideoEnhancementOutput,
  type StoredVideoEnhancementJob,
  type ValidatedVideoEnhancementMedia,
  type VideoEnhancementMediaPort,
  type VideoEnhancementPublicationPort,
  type VideoEnhancementRuntimeIssue,
  type VideoGenerationOutputSnapshot,
} from "./VideoEnhancementRuntime.js";

const NEXUS_RELEASE = "v2.3.0";
const MAX_ID_LENGTH = 256;
const QUARANTINE_DIRECTORY = ".nexus-quarantine";
const MAX_QUARANTINE_COLLISIONS = 100;
const PUBLISHED_TRACKING_RETENTION_MS = 5 * 60_000;
const PROVENANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;

interface RetainedPublication {
  readonly prepared: PreparedEnhancedVideoPublication;
  readonly validated: ValidatedVideoEnhancementMedia;
  readonly source: VideoGenerationOutputSnapshot;
}

interface PublishedPublication {
  readonly output: PublishedVideoEnhancementOutput;
  readonly sourcePath: string;
}

export interface VideoEnhancementMediaAdapterShutdownResult {
  readonly removedUnpublishedArtifacts: number;
  readonly retainedUnpublishedArtifacts: number;
}

/**
 * Production bridge between the runtime's split media/publication ports and
 * one stateful media lifecycle. Prepared artifacts are keyed by child job ID
 * and cannot be consumed by another child.
 */
export class VideoEnhancementMediaAdapter
  implements VideoEnhancementMediaPort, VideoEnhancementPublicationPort
{
  private readonly retained = new Map<string, RetainedPublication>();
  private readonly preparing = new Set<string>();
  private readonly publishing = new Set<string>();
  private readonly published = new Map<string, PublishedPublication>();
  private readonly publishedExpiry = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly outputOwners = new Map<string, string>();
  private closed = false;

  constructor(private readonly lifecycle: VideoEnhancementMediaLifecycle) {}

  retainedCount(): number {
    return this.retained.size;
  }

  async verifySource(
    expected: VideoSourceIdentity,
    signal: AbortSignal,
  ): Promise<VideoSourceIdentity> {
    this.assertOpen("validate");
    return this.translateLifecycle(() =>
      this.lifecycle.verifySource(expected, signal),
    );
  }

  async validateAndWriteProvenance(input: {
    readonly job: StoredVideoEnhancementJob;
    readonly staged: VideoEnhancementStagedSuccess;
    readonly signal: AbortSignal;
  }): Promise<ValidatedVideoEnhancementMedia> {
    this.assertOpen("validate");
    assertMatchingExecution(input.job, input.staged);
    if (
      this.retained.has(input.job.childJobId) ||
      this.preparing.has(input.job.childJobId) ||
      this.published.has(input.job.childJobId)
    ) {
      throw portError(
        "invalid_state",
        "provenance",
        "This enhancement child already owns a prepared or published artifact.",
        false,
      );
    }

    const sourceWorkflow = normalizeSourceWorkflow(
      input.job.sourceOutput.workflow,
      input.job.sourceOutput,
    );
    const identityDigest = publicationDigest(input.job);
    const sourceDirectory = path.dirname(input.job.sourceOutput.path);
    const metadataStagedPath = path.join(
      sourceDirectory,
      `.nexus-enhancement-${identityDigest}.staged.mp4`,
    );
    const finalPath = path.join(
      sourceDirectory,
      `nexus-enhanced-${identityDigest}.mp4`,
    );
    const provenanceRecordId = `nexus-video-enhancement-${identityDigest}`;

    this.preparing.add(input.job.childJobId);
    try {
      let prepared: PreparedEnhancedVideoPublication;
      try {
        prepared = await this.translateLifecycle(() =>
          this.lifecycle.prepare({
            sourceGenerationId: input.job.sourceOutput.generationId,
            sourceOutputId: input.job.sourceOutputId,
            provenanceRecordId,
            nexusRelease: NEXUS_RELEASE,
            presetRouting: "explicit",
            sourceWorkflow,
            staged: input.staged,
            metadataStagedPath,
            finalPath,
            signal: input.signal,
          }),
        );
      } catch (error) {
        if (
          !(error instanceof VideoEnhancementRuntimePortError) ||
          (error.code !== "output_conflict" && error.code !== "invalid_request")
        ) {
          await hideFailedPreparation(
            metadataStagedPath,
            sourceDirectory,
            `failed-${identityDigest}`,
          );
        }
        throw error;
      }
      if (this.closed) {
        await removePreparedArtifact(prepared);
        throw portError(
          "cancelled",
          "provenance",
          "Video enhancement media preparation stopped during shutdown.",
          false,
        );
      }
      const validated = validatedFromPrepared(prepared);
      this.retained.set(
        input.job.childJobId,
        Object.freeze({
          prepared,
          validated,
          source: input.job.sourceOutput,
        }),
      );
      return validated;
    } finally {
      this.preparing.delete(input.job.childJobId);
    }
  }

  async publish(input: {
    readonly childJobId: string;
    readonly desiredOutputId: string;
    readonly source: VideoGenerationOutputSnapshot;
    readonly validated: ValidatedVideoEnhancementMedia;
    readonly signal: AbortSignal;
  }): Promise<PublishedVideoEnhancementOutput> {
    this.assertOpen("publish");
    validateOutputId(
      input.desiredOutputId,
      input.childJobId,
      input.source.outputId,
    );
    if (this.publishing.has(input.childJobId)) {
      throw portError(
        "invalid_state",
        "publish",
        "This enhancement child is already publishing.",
        false,
      );
    }
    const retained = this.retained.get(input.childJobId);
    if (!retained) {
      throw portError(
        "invalid_state",
        "publish",
        "No matching prepared enhancement artifact is retained.",
        false,
      );
    }
    if (
      !sourceMatches(input.source, retained.source) ||
      !validatedMatches(input.validated, retained.validated)
    ) {
      throw portError(
        "output_conflict",
        "publish",
        "The publication request does not match the retained child artifact.",
        false,
      );
    }
    const existingOwner = this.outputOwners.get(input.desiredOutputId);
    if (existingOwner && existingOwner !== input.childJobId) {
      throw portError(
        "output_conflict",
        "publish",
        "The requested enhancement output ID already belongs to another child.",
        false,
      );
    }

    this.publishing.add(input.childJobId);
    this.outputOwners.set(input.desiredOutputId, input.childJobId);
    try {
      const promoted = await this.translateLifecycle(() =>
        this.lifecycle.promote(retained.prepared, input.signal),
      );
      if (
        !pathsEqual(promoted.finalPath, retained.prepared.finalPath) ||
        promoted.publishedContainerSha256 !==
          retained.prepared.publishedContainerSha256
      ) {
        throw portError(
          "publish_failed",
          "publish",
          "The promoted artifact did not match its retained preparation.",
          false,
        );
      }
      const output = publishedFromPrepared(
        input.desiredOutputId,
        retained.prepared,
      );
      this.retained.delete(input.childJobId);
      this.published.set(
        input.childJobId,
        Object.freeze({
          output,
          sourcePath: retained.prepared.sourcePath,
        }),
      );
      this.schedulePublishedExpiry(input.childJobId);
      return output;
    } catch (error) {
      if (!this.published.has(input.childJobId)) {
        this.outputOwners.delete(input.desiredOutputId);
      }
      throw error;
    } finally {
      this.publishing.delete(input.childJobId);
    }
  }

  async quarantine(input: {
    readonly childJobId: string;
    readonly output: PublishedVideoEnhancementOutput;
    readonly reason: {
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
      readonly stage: string;
      readonly diagnostics: string | null;
    };
  }): Promise<void> {
    const published = this.published.get(input.childJobId);
    if (!published || !publishedOutputMatches(input.output, published.output)) {
      throw portError(
        "output_conflict",
        "publish",
        "The quarantine request does not match a published child artifact.",
        false,
      );
    }
    if (pathsEqual(published.sourcePath, input.output.path)) {
      throw portError(
        "publish_failed",
        "publish",
        "The source video cannot be quarantined as an enhancement output.",
        false,
      );
    }

    const outputPath = await canonicalExistingFile(input.output.path);
    const outputDirectory = await fs.realpath(path.dirname(outputPath));
    const quarantineDirectory = path.join(
      outputDirectory,
      QUARANTINE_DIRECTORY,
    );
    await ensureQuarantineDirectory(outputDirectory, quarantineDirectory);
    const quarantineDigest = createHash("sha256")
      .update(input.childJobId, "utf8")
      .update("\0", "utf8")
      .update(input.output.outputId, "utf8")
      .update("\0", "utf8")
      .update(input.output.contentHash, "utf8")
      .digest("hex")
      .slice(0, 40);
    const quarantinePath = await linkIntoQuarantine(
      outputPath,
      quarantineDirectory,
      quarantineDigest,
    );
    try {
      await fs.unlink(outputPath);
    } catch {
      await fs.unlink(quarantinePath).catch(() => undefined);
      throw portError(
        "publish_failed",
        "publish",
        "The published enhancement could not be hidden from normal output visibility.",
        true,
      );
    }
    this.releasePublished(input.childJobId);
  }

  async cleanupRetained(childJobId: string): Promise<boolean> {
    const retained = this.retained.get(childJobId);
    if (!retained || this.publishing.has(childJobId)) return false;
    const removed = await removePreparedArtifact(retained.prepared);
    if (removed) this.retained.delete(childJobId);
    return removed;
  }

  async discardPrepared(childJobId: string): Promise<void> {
    await this.cleanupRetained(childJobId);
  }

  async discard(input: {
    readonly childJobId: string;
    readonly reason: VideoEnhancementRuntimeIssue;
  }): Promise<void> {
    const retained = this.retained.get(input.childJobId);
    if (retained) {
      if (!(await this.cleanupRetained(input.childJobId))) {
        throw portError(
          "publish_failed",
          "publish",
          "The retained enhancement artifact could not be safely discarded.",
          true,
        );
      }
      return;
    }

    const published = this.published.get(input.childJobId);
    if (published) {
      await this.quarantine({
        childJobId: input.childJobId,
        output: published.output,
        reason: input.reason,
      });
    }
  }

  async finalize(input: {
    readonly childJobId: string;
    readonly output: PublishedVideoEnhancementOutput;
  }): Promise<void> {
    const published = this.published.get(input.childJobId);
    if (!published || !publishedOutputMatches(input.output, published.output)) {
      throw portError(
        "output_conflict",
        "publish",
        "The durable completion does not match this adapter's published artifact.",
        false,
      );
    }
    this.releasePublished(input.childJobId);
  }

  /** Release post-publish tracking after the durable completion commits. */
  acknowledgePublished(childJobId: string): boolean {
    return this.releasePublished(childJobId);
  }

  async shutdown(): Promise<VideoEnhancementMediaAdapterShutdownResult> {
    this.closed = true;
    let removedUnpublishedArtifacts = 0;
    for (const childJobId of [...this.retained.keys()]) {
      if (await this.cleanupRetained(childJobId)) {
        removedUnpublishedArtifacts += 1;
      }
    }
    for (const childJobId of [...this.published.keys()]) {
      this.releasePublished(childJobId);
    }
    return Object.freeze({
      removedUnpublishedArtifacts,
      retainedUnpublishedArtifacts: this.retained.size,
    });
  }

  private assertOpen(stage: "validate" | "publish"): void {
    if (this.closed) {
      throw portError(
        "invalid_state",
        stage,
        "The video enhancement media adapter is shut down.",
        false,
      );
    }
  }

  private schedulePublishedExpiry(childJobId: string): void {
    const expiry = setTimeout(() => {
      this.releasePublished(childJobId);
    }, PUBLISHED_TRACKING_RETENTION_MS);
    expiry.unref?.();
    this.publishedExpiry.set(childJobId, expiry);
  }

  private releasePublished(childJobId: string): boolean {
    const published = this.published.get(childJobId);
    if (!published) return false;
    const expiry = this.publishedExpiry.get(childJobId);
    if (expiry) clearTimeout(expiry);
    this.publishedExpiry.delete(childJobId);
    this.outputOwners.delete(published.output.outputId);
    this.published.delete(childJobId);
    return true;
  }

  private async translateLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof VideoEnhancementMediaLifecycleError) {
        throw new VideoEnhancementRuntimePortError(
          error.code,
          error.message,
          error.retryable,
          error.stage,
          null,
        );
      }
      throw error;
    }
  }
}

function validatedFromPrepared(
  prepared: PreparedEnhancedVideoPublication,
): ValidatedVideoEnhancementMedia {
  return Object.freeze({
    stagedPath: prepared.metadataStagedPath,
    contentHash: prepared.publishedContainerSha256,
    sizeBytes: prepared.media.sizeBytes,
    durationSeconds: prepared.media.durationSeconds,
    width: prepared.media.width,
    height: prepared.media.height,
    frameRate: prepared.media.frameRate,
    provenanceRecordId: prepared.embeddedProvenance.provenanceRecordId,
    preProvenanceContainerSha256: prepared.preProvenanceContainerSha256,
    publishedContainerSha256: prepared.publishedContainerSha256,
    embeddedWorkflow: prepared.embeddedWorkflow,
    durableProvenance: prepared.durableProvenance,
  });
}

function publishedFromPrepared(
  outputId: string,
  prepared: PreparedEnhancedVideoPublication,
): PublishedVideoEnhancementOutput {
  return Object.freeze({
    outputId,
    path: prepared.finalPath,
    contentHash: prepared.publishedContainerSha256,
    sizeBytes: prepared.media.sizeBytes,
    durationSeconds: prepared.media.durationSeconds,
    width: prepared.media.width,
    height: prepared.media.height,
    frameRate: prepared.media.frameRate,
    workflow: prepared.embeddedWorkflow,
    provenanceRecordId: prepared.embeddedProvenance.provenanceRecordId,
    preProvenanceContainerSha256: prepared.preProvenanceContainerSha256,
    publishedContainerSha256: prepared.publishedContainerSha256,
    embeddedWorkflow: prepared.embeddedWorkflow,
    durableProvenance: prepared.durableProvenance,
  });
}

function assertMatchingExecution(
  job: StoredVideoEnhancementJob,
  staged: VideoEnhancementStagedSuccess,
): void {
  const ids = [
    job.childJobId,
    job.parentJobId,
    job.sourceOutputId,
    job.sourceOutput.generationId,
    job.request.requestId,
  ];
  if (
    ids.some(
      (value) =>
        value.length > MAX_ID_LENGTH || !PROVENANCE_ID_PATTERN.test(value),
    ) ||
    staged.childJobId !== job.childJobId ||
    staged.parentJobId !== job.parentJobId ||
    staged.requestId !== job.request.requestId ||
    !sourceMatchesStaged(job.sourceOutput, staged) ||
    !executionMatchesRequest(job, staged)
  ) {
    throw portError(
      "invalid_request",
      "provenance",
      "The staged enhancement does not match its persisted child and source.",
      false,
    );
  }
}

function executionMatchesRequest(
  job: StoredVideoEnhancementJob,
  staged: VideoEnhancementStagedSuccess,
): boolean {
  const upscale = staged.stages.find(
    (stage) => stage.parameters.stage === "upscale",
  );
  const interpolation = staged.stages.find(
    (stage) => stage.parameters.stage === "interpolate",
  );
  if (job.request.mode === "upscale") {
    return (
      staged.stages.length === 1 &&
      upscale?.parameters.stage === "upscale" &&
      upscale.parameters.presetId === job.request.upscalePreset &&
      interpolation === undefined
    );
  }
  if (job.request.mode === "interpolate") {
    return (
      staged.stages.length === 1 &&
      interpolation?.parameters.stage === "interpolate" &&
      interpolation.parameters.presetId === job.request.interpolationPreset &&
      upscale === undefined
    );
  }
  return (
    staged.stages.length === 2 &&
    staged.stages[0]?.parameters.stage === "upscale" &&
    staged.stages[1]?.parameters.stage === "interpolate" &&
    upscale?.parameters.stage === "upscale" &&
    upscale.parameters.presetId === job.request.upscalePreset &&
    interpolation?.parameters.stage === "interpolate" &&
    interpolation.parameters.presetId === job.request.interpolationPreset
  );
}

function sourceMatchesStaged(
  source: VideoGenerationOutputSnapshot,
  staged: VideoEnhancementStagedSuccess,
): boolean {
  return (
    pathsEqual(source.path, staged.source.path) &&
    source.contentHash === staged.source.sha256 &&
    source.sizeBytes === staged.source.sizeBytes &&
    source.durationSeconds === staged.source.durationSeconds &&
    source.width === staged.source.width &&
    source.height === staged.source.height &&
    source.frameRate.numerator === staged.source.frameRate.numerator &&
    source.frameRate.denominator === staged.source.frameRate.denominator
  );
}

function normalizeSourceWorkflow(
  value: Readonly<Record<string, unknown>>,
  source: VideoGenerationOutputSnapshot,
): VideoWorkflowMetadata {
  const mode = value.mode;
  if (
    value.kind !== "video" ||
    !(
      mode === "text2video" ||
      mode === "image2video" ||
      mode === "audio2video"
    ) ||
    !isBoundedText(value.tool, 256) ||
    !isBoundedText(value.version, 128) ||
    !isBoundedText(value.modelId, 256) ||
    typeof value.prompt !== "string" ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height) ||
    !isPositiveFinite(value.durationSeconds) ||
    !isPositiveFinite(value.fps) ||
    !isPositiveSafeInteger(value.frameCount) ||
    !isNonnegativeSafeInteger(value.steps) ||
    !isNonnegativeFinite(value.cfgScale) ||
    !isBoundedText(value.sampler, 256) ||
    !Number.isSafeInteger(value.seed) ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    value.width !== source.width ||
    value.height !== source.height ||
    Math.abs(value.durationSeconds - source.durationSeconds) >
      Math.max(
        source.frameRate.denominator / source.frameRate.numerator,
        0.25,
      ) ||
    Math.abs(
      value.fps - source.frameRate.numerator / source.frameRate.denominator,
    ) > 0.000_001
  ) {
    throw portError(
      "source_invalid",
      "provenance",
      "The source video workflow metadata is missing or malformed.",
      false,
    );
  }
  const workflow = Object.freeze({ ...value }) as VideoWorkflowMetadata;
  try {
    serializeVideoWorkflowMetadata(workflow);
  } catch {
    throw portError(
      "source_invalid",
      "provenance",
      "The source video workflow metadata is not embeddable.",
      false,
    );
  }
  return workflow;
}

function publicationDigest(job: StoredVideoEnhancementJob): string {
  return createHash("sha256")
    .update(job.childJobId, "utf8")
    .update("\0", "utf8")
    .update(job.request.requestId, "utf8")
    .update("\0", "utf8")
    .update(job.sourceOutputId, "utf8")
    .update("\0", "utf8")
    .update(job.sourceOutput.contentHash, "utf8")
    .digest("hex")
    .slice(0, 40);
}

function validateOutputId(
  outputId: string,
  childJobId: string,
  sourceOutputId: string,
): void {
  if (
    typeof outputId !== "string" ||
    outputId.length === 0 ||
    outputId.length > MAX_ID_LENGTH ||
    /[\r\n\0]/u.test(outputId) ||
    outputId === childJobId ||
    outputId === sourceOutputId
  ) {
    throw portError(
      "output_conflict",
      "publish",
      "The requested enhancement output ID is invalid or collides with an existing identity.",
      false,
    );
  }
}

function sourceMatches(
  value: VideoGenerationOutputSnapshot,
  expected: VideoGenerationOutputSnapshot,
): boolean {
  return (
    value.outputId === expected.outputId &&
    value.generationId === expected.generationId &&
    value.contentHash === expected.contentHash &&
    value.sizeBytes === expected.sizeBytes &&
    pathsEqual(value.path, expected.path)
  );
}

function validatedMatches(
  value: ValidatedVideoEnhancementMedia,
  expected: ValidatedVideoEnhancementMedia,
): boolean {
  try {
    return (
      pathsEqual(value.stagedPath, expected.stagedPath) &&
      value.contentHash === expected.contentHash &&
      value.sizeBytes === expected.sizeBytes &&
      value.durationSeconds === expected.durationSeconds &&
      value.width === expected.width &&
      value.height === expected.height &&
      value.frameRate.numerator === expected.frameRate.numerator &&
      value.frameRate.denominator === expected.frameRate.denominator &&
      value.provenanceRecordId === expected.provenanceRecordId &&
      value.preProvenanceContainerSha256 ===
        expected.preProvenanceContainerSha256 &&
      value.publishedContainerSha256 === expected.publishedContainerSha256 &&
      serializeVideoWorkflowMetadata(value.embeddedWorkflow) ===
        serializeVideoWorkflowMetadata(expected.embeddedWorkflow) &&
      JSON.stringify(value.durableProvenance) ===
        JSON.stringify(expected.durableProvenance)
    );
  } catch {
    return false;
  }
}

function publishedOutputMatches(
  value: PublishedVideoEnhancementOutput,
  expected: PublishedVideoEnhancementOutput,
): boolean {
  try {
    return (
      value.outputId === expected.outputId &&
      pathsEqual(value.path, expected.path) &&
      value.contentHash === expected.contentHash &&
      value.sizeBytes === expected.sizeBytes &&
      value.durationSeconds === expected.durationSeconds &&
      value.width === expected.width &&
      value.height === expected.height &&
      value.frameRate.numerator === expected.frameRate.numerator &&
      value.frameRate.denominator === expected.frameRate.denominator &&
      value.provenanceRecordId === expected.provenanceRecordId &&
      value.preProvenanceContainerSha256 ===
        expected.preProvenanceContainerSha256 &&
      value.publishedContainerSha256 === expected.publishedContainerSha256 &&
      serializeVideoWorkflowMetadata(value.workflow) ===
        serializeVideoWorkflowMetadata(expected.workflow) &&
      serializeVideoWorkflowMetadata(value.embeddedWorkflow) ===
        serializeVideoWorkflowMetadata(expected.embeddedWorkflow) &&
      JSON.stringify(value.durableProvenance) ===
        JSON.stringify(expected.durableProvenance)
    );
  } catch {
    return false;
  }
}

async function removePreparedArtifact(
  prepared: PreparedEnhancedVideoPublication,
): Promise<boolean> {
  try {
    const identity = await fileIdentity(prepared.metadataStagedPath);
    if (!fileIdentitiesEqual(identity, prepared.metadataStagedIdentity)) {
      return false;
    }
    await fs.unlink(prepared.metadataStagedPath);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return true;
    return false;
  }
}

async function hideFailedPreparation(
  metadataStagedPath: string,
  expectedSourceDirectory: string,
  digest: string,
): Promise<void> {
  try {
    const canonicalSourceDirectory = await fs.realpath(expectedSourceDirectory);
    const candidate = await canonicalExistingFile(metadataStagedPath);
    if (!pathsEqual(path.dirname(candidate), canonicalSourceDirectory)) return;
    const quarantineDirectory = path.join(
      canonicalSourceDirectory,
      QUARANTINE_DIRECTORY,
    );
    await ensureQuarantineDirectory(
      canonicalSourceDirectory,
      quarantineDirectory,
    );
    const quarantinePath = await linkIntoQuarantine(
      candidate,
      quarantineDirectory,
      digest,
    );
    try {
      await fs.unlink(candidate);
    } catch {
      await fs.unlink(quarantinePath).catch(() => undefined);
    }
  } catch {
    // An unproven file is never deleted. The dot-prefixed job-owned candidate
    // remains outside normal completion if it cannot be hidden safely.
  }
}

async function canonicalExistingFile(candidate: string): Promise<string> {
  if (
    !path.isAbsolute(candidate) ||
    path.extname(candidate).toLowerCase() !== ".mp4"
  ) {
    throw portError(
      "publish_failed",
      "publish",
      "The published enhancement path is invalid.",
      false,
    );
  }
  try {
    const requested = path.resolve(candidate);
    const linkStat = await fs.lstat(requested);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
      throw new Error("not canonical");
    }
    const canonical = await fs.realpath(requested);
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) {
      throw new Error("not canonical");
    }
    return canonical;
  } catch (error) {
    if (error instanceof VideoEnhancementRuntimePortError) throw error;
    throw portError(
      "publish_failed",
      "publish",
      "The published enhancement is unavailable for quarantine.",
      false,
    );
  }
}

async function ensureQuarantineDirectory(
  canonicalOutputDirectory: string,
  quarantineDirectory: string,
): Promise<void> {
  try {
    await fs.mkdir(quarantineDirectory);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) {
      throw portError(
        "publish_failed",
        "publish",
        "The enhancement quarantine directory could not be created.",
        true,
      );
    }
  }
  const canonicalQuarantine = await fs.realpath(quarantineDirectory);
  const stat = await fs.stat(canonicalQuarantine);
  if (
    !stat.isDirectory() ||
    !pathsEqual(path.dirname(canonicalQuarantine), canonicalOutputDirectory) ||
    path.basename(canonicalQuarantine) !== QUARANTINE_DIRECTORY
  ) {
    throw portError(
      "publish_failed",
      "publish",
      "The enhancement quarantine directory is not a safe local child.",
      false,
    );
  }
}

async function linkIntoQuarantine(
  outputPath: string,
  quarantineDirectory: string,
  digest: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_QUARANTINE_COLLISIONS; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = path.join(quarantineDirectory, `${digest}${suffix}.mp4`);
    try {
      await fs.link(outputPath, candidate);
      return candidate;
    } catch (error) {
      if (isNodeError(error, "EEXIST")) continue;
      throw portError(
        "publish_failed",
        "publish",
        "The enhancement output could not be moved into quarantine.",
        true,
      );
    }
  }
  throw portError(
    "output_conflict",
    "publish",
    "No collision-free enhancement quarantine path is available.",
    false,
  );
}

async function fileIdentity(target: string): Promise<VideoMediaFileIdentity> {
  const stat = await fs.stat(target);
  return Object.freeze({
    device: stat.dev,
    inode: stat.ino,
    sizeBytes: stat.size,
  });
}

function fileIdentitiesEqual(
  left: VideoMediaFileIdentity,
  right: VideoMediaFileIdentity,
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.sizeBytes === right.sizeBytes
  );
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\r\n\0]/u.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function portError(
  code: ConstructorParameters<typeof VideoEnhancementRuntimePortError>[0],
  stage: ConstructorParameters<typeof VideoEnhancementRuntimePortError>[3],
  message: string,
  retryable: boolean,
): VideoEnhancementRuntimePortError {
  return new VideoEnhancementRuntimePortError(
    code,
    message,
    retryable,
    stage,
    null,
  );
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
