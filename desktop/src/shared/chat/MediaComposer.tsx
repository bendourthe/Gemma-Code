/**
 * v1.15.0 Phase 5 (Issue 5) -- attachment-capable chat composer for the media
 * studios (Image Studio / Video Lab).
 *
 * Unlike the text-only `ChatInput`, this composer lets the user attach one or
 * more images by clicking "+", dragging files onto it, or pasting from the
 * clipboard. Attachments show as removable thumbnail chips and are emitted as
 * base64 data URLs alongside the prompt text. Enter sends, Shift+Enter inserts
 * a newline. Send is enabled when there is text OR at least one attachment (an
 * image-only request is valid -- the studio's intent layer supplies a default
 * prompt).
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { AccentBeam, type AccentBeamAccentToken } from "../../components/AccentBeam";
import { MetalAccent } from "../../components/MetalAccent";
import { metalTokenFromCssVar } from "../../components/metalGl";
import { MotionSurface, composerMotionCandidates } from "../../motion";

export interface MediaComposerProps {
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (text: string, attachments: readonly string[]) => void;
  accept?: string;
  submitAccentVar?: string;
  /** Label on the hero submit control. Image / Video pass "Generate". */
  submitLabel?: string;
  /** When set (and it changes), appended to the pending attachments ("Use as source"). */
  seededAttachment?: string | null;
  /** Traveling beam while a reply / generation is in flight. */
  streaming?: boolean;
}

/**
 * v1.16.0 Phase 3 (adoption item A5) -- does this file match the `accept` list?
 *
 * Before this phase the composer hard-filtered on `image/`, so a PDF dropped on
 * it was silently discarded no matter what `accept` said. Honouring `accept`
 * makes the same composer usable for document parsing while leaving the image
 * studios (which pass the default `image/*`) behaving exactly as before.
 *
 * Supports the three forms an `accept` attribute actually takes: a wildcard
 * subtype (`image/*`), an exact MIME type (`application/pdf`), and an extension
 * (`.pdf`) for the browsers/platforms that report an empty `file.type`.
 */
export function fileMatchesAccept(file: File, accept: string): boolean {
  const patterns = accept
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return patterns.some((pattern) => {
    if (pattern === "*/*" || pattern === "*") return true;
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    if (pattern.endsWith("/*")) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/** True for a data URL the thumbnail strip can render with an `<img>`. */
export function isImageDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/");
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

export function MediaComposer({
  disabled,
  placeholder = "Describe what you want to generate, or drop an image...",
  onSubmit,
  accept = "image/*",
  submitAccentVar = "--accent-image",
  submitLabel = "Send",
  seededAttachment,
  streaming = false,
}: MediaComposerProps): JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (seededAttachment) setAttachments((prev) => [...prev, seededAttachment]);
  }, [seededAttachment]);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    // v1.16.0 Phase 3: filter against `accept` rather than a hardcoded `image/`,
    // so a composer configured for PDFs actually accepts them.
    const accepted = Array.from(files).filter((f) => fileMatchesAccept(f, accept));
    if (accepted.length === 0) return;
    const urls = await readFilesAsDataUrls(accepted);
    setAttachments((prev) => [...prev, ...urls]);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    void addFiles(e.target.files);
    e.target.value = ""; // allow re-selecting the same file
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && fileMatchesAccept(file, accept)) files.push(file);
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

  const canSubmit = !disabled && (text.trim().length > 0 || attachments.length > 0);

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit(text.trim(), attachments);
    setText("");
    setAttachments([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const removeAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const candidates = useMemo(
    () => composerMotionCandidates({ streaming, focused }),
    [streaming, focused],
  );

  return (
    <MotionSurface
      surfaceId="media-composer"
      candidates={candidates}
    >
    <AccentBeam
      mode={streaming ? "traveling" : "breathing"}
      playing={Boolean(streaming || focused)}
      accentToken={beamAccentFrom(submitAccentVar)}
      radiusToken="--radius-md"
      strength={streaming ? 0.9 : 0.7}
      surfaceId="media-composer-beam"
      data-testid="media-composer-beam"
    >
    <div
      data-testid="media-composer"
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
      style={composerStyle(dragActive)}
    >
      {attachments.length > 0 && (
        <div
          data-testid="media-composer-thumbs"
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}
        >
          {attachments.map((src, i) => (
            <div key={i} data-testid={`media-composer-thumb-${i}`} style={{ position: "relative" }}>
              {isImageDataUrl(src) ? (
                <img
                  src={src}
                  alt="Pending attachment"
                  style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--radius-sm)" }}
                />
              ) : (
                // v1.16.0 Phase 3: a PDF has no renderable preview here, so it
                // gets a labelled chip rather than a broken <img>.
                <div
                  data-testid={`media-composer-doc-${i}`}
                  title="Attached document"
                  style={docChipStyle}
                >
                  PDF
                </div>
              )}
              <button
                type="button"
                aria-label="Remove attachment"
                data-testid={`media-composer-remove-${i}`}
                onClick={() => removeAttachment(i)}
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
          accept={accept}
          multiple
          data-testid="media-composer-file"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          aria-label="Add attachments"
          data-testid="media-composer-add"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          style={addBtnStyle}
        >
          +
        </button>
        <textarea
          data-testid="media-composer-textarea"
          aria-label="Generation prompt"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={2}
          style={textareaStyle}
        />
        <MetalAccent
          accentToken={metalTokenFromCssVar(submitAccentVar)}
          surfaceId="media-composer-submit"
          data-testid="media-composer-submit-metal"
        >
          <button
            type="button"
            data-testid="media-composer-submit"
            disabled={!canSubmit}
            onClick={submit}
            style={submitStyle(submitAccentVar)}
          >
            {submitLabel}
          </button>
        </MetalAccent>
      </div>
    </div>
    </AccentBeam>
    </MotionSurface>
  );
}

function beamAccentFrom(token: string): AccentBeamAccentToken {
  if (token === "--accent-chatbot") return "--accent-chatbot";
  if (token === "--accent-video") return "--accent-video";
  if (token === "--accent-image") return "--accent-image";
  return "--accent-coding";
}

function composerStyle(dragActive: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
    padding: "var(--space-2)",
    border: `1px solid ${dragActive ? "var(--accent-image)" : "var(--border-1)"}`,
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--bg-1)",
  };
}

const textareaStyle: CSSProperties = {
  flex: 1,
  padding: "var(--space-2)",
  backgroundColor: "var(--bg-0)",
  color: "var(--fg-0)",
  border: "1px solid var(--border-1)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-sm)",
  resize: "vertical",
};

/** v1.16.0 Phase 3 -- chip for a non-image attachment (a PDF). */
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

function submitStyle(accentVar: string): CSSProperties {
  return {
    padding: "var(--space-2) var(--space-4)",
    backgroundColor: `var(${accentVar})`,
    color: "var(--bg-0)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  };
}
