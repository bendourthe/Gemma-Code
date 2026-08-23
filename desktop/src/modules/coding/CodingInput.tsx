import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Send } from "lucide-react";
import { AccentBeam, type AccentBeamAccentToken } from "../../components/AccentBeam";
import { MotionSurface, composerMotionCandidates } from "../../motion";
import { DOCUMENT_ACCEPT } from "../../shared/chat/documentAccept";
import { fileMatchesAccept, isImageDataUrl } from "../../shared/chat/MediaComposer";
import {
  filterSlashCommandsWithHub,
  SLASH_COMMANDS,
  type HubCommandDescriptor,
} from "./slashCommands";
import { useHubCommands } from "./useHubCommands";

export interface CodingInputProps {
  disabled?: boolean;
  onSubmit: (text: string, attachments?: readonly string[]) => void;
  /** Traveling beam while a coding turn is in flight. */
  streaming?: boolean;
  /**
   * v2.2.0 Phase 3 (3.3) test seam: pre-resolved hub commands. Production
   * omits this and the composer loads them from the sidecar.
   */
  hubCommands?: readonly HubCommandDescriptor[];
}

function readFilesAsDataUrls(files: readonly File[]): Promise<string[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(file);
        }),
    ),
  ).then((urls) => urls.filter(Boolean));
}

export function CodingInput({
  disabled,
  onSubmit,
  streaming = false,
  hubCommands,
}: CodingInputProps): JSX.Element {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const discovered = useHubCommands(hubCommands);
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) return [];
    return filterSlashCommandsWithHub(value, discovered.commands);
  }, [value, discovered.commands]);

  const canSubmit = !disabled && (value.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const accepted = Array.from(files).filter((f) => fileMatchesAccept(f, DOCUMENT_ACCEPT));
    if (accepted.length === 0) return;
    const urls = await readFilesAsDataUrls(accepted);
    setAttachments((prev) => [...prev, ...urls]);
  };

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit(value.trim(), attachments);
    setValue("");
    setAttachments([]);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && fileMatchesAccept(file, DOCUMENT_ACCEPT)) files.push(file);
    }
    if (files.length > 0) {
      e.preventDefault();
      void readFilesAsDataUrls(files).then((urls) =>
        setAttachments((prev) => [...prev, ...urls]),
      );
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragActive(false);
    void addFiles(e.dataTransfer?.files ?? null);
  };

  const pickSuggestion = (idx: number): void => {
    const cmd = suggestions[idx];
    if (!cmd) return;
    setValue(cmd.template);
  };

  const candidates = useMemo(
    () => composerMotionCandidates({ streaming, focused }),
    [streaming, focused],
  );

  return (
    <MotionSurface
      surfaceId="coding-composer"
      candidates={candidates}
    >
    <div
      data-testid="coding-input"
      data-drag-active={dragActive}
      onFocus={() => setFocused(true)}
      onBlur={(e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
    >
      {suggestions.length > 0 && (
        <ul
          data-testid="coding-input-suggestions"
          aria-label="Slash command suggestions"
          style={{
            listStyle: "none",
            margin: 0,
            padding: "var(--space-2)",
            backgroundColor: "var(--bg-1)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
            maxHeight: "18rem",
            overflowY: "auto",
          }}
        >
          {suggestions.map((s, i) => (
            <li key={s.name}>
              <button
                type="button"
                data-testid={`slash-${s.name}`}
                onClick={() => pickSuggestion(i)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  color: "var(--fg-0)",
                  border: "none",
                  padding: "var(--space-1) var(--space-2)",
                  cursor: "pointer",
                }}
              >
                <strong>/{s.name}</strong>
                {s.namespace === "nexus-hub" && (
                  <span
                    data-testid={`slash-${s.name}-source`}
                    style={{
                      marginLeft: "var(--space-2)",
                      fontSize: "var(--text-xs)",
                      color: "var(--accent-coding)",
                    }}
                  >
                    Nexus-Hub
                  </span>
                )}
                <span style={{ color: "var(--fg-muted)", marginLeft: "var(--space-2)" }}>
                  {s.description}
                </span>
              </button>
            </li>
          ))}
          {!discovered.catalogPresent && value.startsWith("/") && (
            <li
              data-testid="slash-no-catalog-hint"
              style={{
                color: "var(--fg-muted)",
                fontSize: "var(--text-xs)",
                padding: "var(--space-1) var(--space-2)",
              }}
            >
              Built-in commands only. Install the Nexus-Hub harness in Settings &gt; Skills
              for more.
            </li>
          )}
        </ul>
      )}
      {attachments.length > 0 && (
        <div
          data-testid="coding-input-thumbs"
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}
        >
          {attachments.map((src, i) => (
            <div key={i} data-testid={`coding-input-thumb-${i}`} style={{ position: "relative" }}>
              {isImageDataUrl(src) ? (
                <img
                  src={src}
                  alt="Pending attachment"
                  style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--radius-sm)" }}
                />
              ) : (
                <div
                  data-testid={`coding-input-doc-${i}`}
                  title="Attached document"
                  style={docChipStyle}
                >
                  DOC
                </div>
              )}
              <button
                type="button"
                aria-label="Remove attachment"
                data-testid={`coding-input-remove-${i}`}
                onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                style={removeBtnStyle}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      {/*
        v2.2.3 Phase 2 (2.2): the beam wraps the INNER typing surface and is
        always the brand cyan, not the coding pillar pink. It is the only
        focus/streaming ring.
      */}
      <AccentBeam
        mode={streaming ? "traveling" : "breathing"}
        playing={Boolean(streaming || focused)}
        accentToken={BEAM_ACCENT}
        radiusToken={BEAM_RADIUS}
        strength={streaming ? 0.9 : 0.7}
        surfaceId="coding-composer-beam"
        data-testid="coding-composer-beam"
      >
      <div data-testid="coding-input-surface" style={composerSurfaceStyle}>
        <input
          ref={fileInputRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          multiple
          data-testid="coding-input-file"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
        <textarea
          ref={textareaRef}
          data-testid="coding-input-textarea"
          aria-label="Coding chat input"
          value={value}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKey}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`Ask anything, or attach a PDF, image, or Office file. Type / for commands (${SLASH_COMMANDS.length} available).`}
          rows={1}
          style={inFieldTextareaStyle}
        />
        <div data-testid="coding-input-actions" style={rightControlsStyle}>
          <button
            type="button"
            aria-label="Add attachments"
            data-testid="coding-input-add"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            style={clusterIconStyle}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Send"
            data-testid="coding-input-submit"
            disabled={!canSubmit}
            onClick={submit}
            style={submitStyle}
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      </AccentBeam>
    </div>
    </MotionSurface>
  );
}

const docChipStyle: CSSProperties = {
  width: 64,
  height: 64,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-1)",
  background: "var(--bg-2)",
  color: "var(--fg-muted)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
};

/*
 * v2.2.3 Phase 2 (2.2): the beam is the only focus ring, always brand cyan;
 * the surface keeps one static hairline (no focused pink border).
 */
const BEAM_ACCENT = "--accent-chatbot" satisfies AccentBeamAccentToken;
const BEAM_RADIUS = "--radius-lg" as const;

const composerSurfaceStyle: CSSProperties = {
  position: "relative",
  display: "block",
  backgroundColor: "var(--bg-0)",
  border: "1px solid var(--border-subtle, #2a2a2a)",
  borderRadius: "var(--radius-lg, 12px)",
};

const inFieldTextareaStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  paddingLeft: "var(--space-3, 8px)",
  paddingRight: 84,
  paddingTop: "var(--space-3, 8px)",
  paddingBottom: "var(--space-3, 8px)",
  backgroundColor: "transparent",
  color: "var(--fg-0)",
  border: "none",
  outline: "none",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  resize: "none",
  maxHeight: "9rem",
  overflowY: "auto",
};

const rightControlsStyle: CSSProperties = {
  position: "absolute",
  right: 8,
  bottom: 6,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1, 4px)",
};

const clusterIconStyle: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  fontSize: "var(--text-lg)",
  lineHeight: 1,
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "transparent",
  color: "var(--fg-muted, #999)",
  cursor: "pointer",
};

/* v2.2.3 Phase 2 (2.2): send icon is neutral fg, never a pillar hue. */
const submitStyle: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "transparent",
  color: "var(--fg-0)",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
};

const removeBtnStyle: CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  width: 18,
  height: 18,
  borderRadius: "50%",
  border: "none",
  background: "var(--bg-deep, #000)",
  color: "var(--fg-0)",
  cursor: "pointer",
  fontSize: 11,
  lineHeight: "18px",
  padding: 0,
};
