import {
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
import { AccentBeam } from "../../components/AccentBeam";
import { MetalAccent } from "../../components/MetalAccent";
import { MotionSurface, composerMotionCandidates } from "../../motion";
import { DOCUMENT_ACCEPT } from "../../shared/chat/documentAccept";
import { fileMatchesAccept, isImageDataUrl } from "../../shared/chat/MediaComposer";
import { filterSlashCommands, SLASH_COMMANDS } from "./slashCommands";

export interface CodingInputProps {
  disabled?: boolean;
  onSubmit: (text: string, attachments?: readonly string[]) => void;
  /** Traveling beam while a coding turn is in flight. */
  streaming?: boolean;
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

export function CodingInput({ disabled, onSubmit, streaming = false }: CodingInputProps): JSX.Element {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) return [];
    return filterSlashCommands(value).slice(0, 8);
  }, [value]);

  const canSubmit = !disabled && (value.trim().length > 0 || attachments.length > 0);

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
    <AccentBeam
      mode={streaming ? "traveling" : "breathing"}
      playing={Boolean(streaming || focused)}
      accentToken="--accent-coding"
      radiusToken="--radius-md"
      strength={streaming ? 0.9 : 0.7}
      surfaceId="coding-composer-beam"
      data-testid="coding-composer-beam"
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
                <span style={{ color: "var(--fg-muted)", marginLeft: "var(--space-2)" }}>
                  {s.description}
                </span>
              </button>
            </li>
          ))}
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
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2)" }}>
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
        <button
          type="button"
          aria-label="Add attachments"
          data-testid="coding-input-add"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          style={addBtnStyle}
        >
          +
        </button>
        <textarea
          data-testid="coding-input-textarea"
          aria-label="Coding chat input"
          value={value}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKey}
          onPaste={onPaste}
          placeholder={`Ask anything, or attach a PDF, image, or Office file. Type / for commands (${SLASH_COMMANDS.length} available).`}
          rows={3}
          style={{
            flex: 1,
            padding: "var(--space-2)",
            backgroundColor: "var(--bg-1)",
            color: "var(--fg-0)",
            border: "1px solid var(--border-1)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            resize: "vertical",
          }}
        />
        <MetalAccent
          accentToken="--accent-coding"
          surfaceId="coding-send"
          data-testid="coding-input-submit-metal"
          style={{ alignSelf: "flex-end" }}
        >
          <button
            type="button"
            data-testid="coding-input-submit"
            disabled={!canSubmit}
            onClick={submit}
            style={{
              padding: "var(--space-2) var(--space-4)",
              backgroundColor: "var(--accent-coding)",
              color: "var(--bg-0)",
              border: "none",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
            }}
          >
            Send
          </button>
        </MetalAccent>
      </div>
    </div>
    </AccentBeam>
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

const addBtnStyle: CSSProperties = {
  width: 36,
  height: 36,
  fontSize: "var(--text-lg)",
  lineHeight: 1,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-1)",
  background: "var(--bg-0)",
  color: "var(--fg-0)",
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
