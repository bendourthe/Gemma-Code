/**
 * v2.1.0 Phase 5 -- Settings > Fine-tuning.
 *
 * Opt-in Unsloth Core provision, dataset builder (redacted preview), and
 * QLoRA job list. Hidden actions when the host is outside the allowlist.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Select, TextField } from "../../components/ui";
import type {
  FineTuningClient,
  TuningBaseModelDto,
  TuningDatasetDto,
  TuningJobDto,
  TuningStatusDto,
} from "./fineTuningTypes";

export interface FineTuningSettingsProps {
  client: FineTuningClient;
}

export function FineTuningSettings({ client }: FineTuningSettingsProps): JSX.Element {
  const [status, setStatus] = useState<TuningStatusDto | null>(null);
  const [preflight, setPreflight] = useState<string | null>(null);
  const [dataset, setDataset] = useState<TuningDatasetDto | null>(null);
  const [jobs, setJobs] = useState<TuningJobDto[]>([]);
  const [models, setModels] = useState<TuningBaseModelDto[]>([]);
  const [source, setSource] = useState("");
  const [baseModelId, setBaseModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await client.status();
        if (!active) return;
        setStatus(s);
        const [listed, bases] = await Promise.all([
          client.listJobs(),
          client.listBaseModels(s.vramGB),
        ]);
        if (!active) return;
        setJobs(listed);
        setModels(bases);
        setBaseModelId((current) => current || bases[0]?.id || "");
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <section data-testid="fine-tuning-settings" style={sectionStyle}>
      <header>
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Fine-tuning</h2>
        <p style={mutedStyle}>
          Local QLoRA on Unsloth Core (Apache library + LGPL zoo). Studio and the
          Unsloth CLI are never installed. Datasets pass through secret redaction
          and never leave this machine.
        </p>
      </header>

      {error ? (
        <p data-testid="fine-tuning-error" role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}

      {status === null ? (
        <p data-testid="fine-tuning-loading" style={mutedStyle}>
          Checking training hardware...
        </p>
      ) : (
        <>
          <p data-testid="fine-tuning-hardware" style={mutedStyle}>
            {status.supported ? status.reason : status.reason}
          </p>
          <p data-testid="fine-tuning-pins" style={mutedStyle}>
            Pins: {status.pins.map((p) => `${p.name} ${p.version ?? ""} (${p.license})`).join("; ")}
          </p>

          {!status.supported ? (
            <p data-testid="fine-tuning-hidden" style={mutedStyle}>
              Fine-tuning stays hidden on this host. NVIDIA (any OS) or AMD on
              Linux with at least 16 GB VRAM is required.
            </p>
          ) : (
            <>
              <p data-testid="fine-tuning-provision-state" style={mutedStyle}>
                Runtime: {status.provisionStatus}
                {status.provisionError ? ` -- ${status.provisionError}` : ""}
              </p>
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <Button
                  type="button"
                  testId="fine-tuning-provision"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setStatus(await client.provision());
                    })
                  }
                >
                  Provision Unsloth Core
                </Button>
                <Button
                  type="button"
                  testId="fine-tuning-preflight"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await client.preflight();
                      setPreflight(result.ok ? "ok" : result.message);
                    })
                  }
                >
                  Preflight
                </Button>
              </div>
              {preflight ? (
                <p data-testid="fine-tuning-preflight-result" style={mutedStyle}>
                  {preflight}
                </p>
              ) : null}

              <label style={mutedStyle}>
                Dataset sources (one path per line)
                <TextField
                  multiline
                  testId="fine-tuning-sources"
                  value={source}
                  onChange={setSource}
                  rows={3}
                  style={{ display: "block", width: "100%", marginTop: "var(--space-1)" }}
                />
              </label>
              <Button
                type="button"
                testId="fine-tuning-build-dataset"
                disabled={busy || source.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    const paths = source
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    setDataset(await client.buildDataset(paths));
                  })
                }
              >
                Build dataset
              </Button>
              {dataset ? (
                <div data-testid="fine-tuning-dataset-preview">
                  <p style={mutedStyle}>
                    Wrote {dataset.written} records ({dataset.redacted} redacted) to{" "}
                    {dataset.outputPath}
                  </p>
                  <pre style={previewStyle}>{JSON.stringify(dataset.preview, null, 2)}</pre>
                </div>
              ) : null}

              <label style={mutedStyle}>
                Base model
                <Select
                  data-testid="fine-tuning-base-model"
                  value={baseModelId}
                  onChange={(e) => setBaseModelId(e.target.value)}
                  style={{ display: "block", marginTop: "var(--space-1)" }}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                      {m.vision ? " (vision)" : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                type="button"
                testId="fine-tuning-start"
                disabled={busy || !dataset || !baseModelId}
                onClick={() =>
                  void run(async () => {
                    if (!dataset) return;
                    await client.startJob({
                      baseModelId,
                      datasetId: dataset.id,
                      datasetPath: dataset.outputPath,
                    });
                    setJobs(await client.listJobs());
                  })
                }
              >
                Start QLoRA job
              </Button>

              <ul data-testid="fine-tuning-jobs" style={{ paddingLeft: "1.2rem" }}>
                {jobs.map((job) => (
                  <li key={job.id} data-testid={`fine-tuning-job-${job.id}`}>
                    {job.id}: {job.state}
                    {job.error ? ` (${job.error})` : ""}
                    {job.state !== "done" && job.state !== "quarantined" && job.state !== "export-failed" ? (
                      <Button
                        type="button"
                        testId={`fine-tuning-cancel-${job.id}`}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await client.cancelJob(job.id);
                            setJobs(await client.listJobs());
                          })
                        }
                        style={{ marginLeft: "var(--space-2)" }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-4) var(--space-6)",
  flex: 1,
  overflowY: "auto",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--fg-muted)",
  fontSize: "var(--text-sm)",
  margin: 0,
};

const alertStyle: React.CSSProperties = {
  color: "var(--accent-danger, #f87171)",
  fontSize: "var(--text-sm)",
  margin: 0,
};

const previewStyle: React.CSSProperties = {
  fontSize: "var(--text-xs)",
  background: "var(--bg-2)",
  padding: "var(--space-2)",
  overflowX: "auto",
};
