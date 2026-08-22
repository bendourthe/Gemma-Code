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
import { isAudioDataUrl } from "./classifyAttachment";
import type { MicRecorder } from "./micRecorder";
import { createBrowserMicRecorder } from "./micRecorder";

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
  /**
   * v2.0.0 Phase 1 -- vision-chat image attach. Default true so Image Studio /
   * Video Lab are unchanged. Chat passes false for text-only models.
   */
  imageEnabled?: boolean;
  /** Tooltip when `imageEnabled` is false. */
  imageDisabledReason?: string;
  /**
   * v2.0.0 Phase 1 -- audio file + mic capture. Off by default so studios do
   * not grow a microphone control.
   */
  audioEnabled?: boolean;
  audioHint?: string;
  /** Tests inject a fake; production uses getUserMedia + MediaRecorder. */
  micRecorder?: MicRecorder;
  /**
   * v2.2.0 Phase 5 (5.4) -- voice modes for the mic menu. Chat passes Voice
   * loop / VAD / Hold to talk here so those capabilities stay reachable
   * without the five-button row that used to sit above the composer.
   */
  voiceModes?: readonly VoiceModeOption[];
}

/** One entry in the mic dropdown. */
export interface VoiceModeOption {
  readonly id: string;
  readonly label: string;
  readonly active?: boolean;
  onSelect(): void;
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
  imageEnabled = true,
  imageDisabledReason,
  audioEnabled = false,
  audioHint,
  micRecorder: micRecorderOverride,
  voiceModes = [],
}: MediaComposerProps): JSX.Element {
  const [text, setText] = useState("");
  // v2.2.0 Phase 5 (5.4): mic menu + auto-grow ref (focus state already exists).
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const micRecorderRef = useRef<MicRecorder | null>(micRecorderOverride ?? null);
  if (micRecorderOverride) micRecorderRef.current = micRecorderOverride;

  useEffect(() => {
    if (seededAttachment) setAttachments((prev) => [...prev, seededAttachment]);
  }, [seededAttachment]);

  // v2.2.0 Phase 5 (5.4): grow with the content up to the CSS max-height, then
  // let it scroll. Without this the single-row field would clip a long message.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    // v1.16.0 Phase 3: filter against `accept` rather than a hardcoded `image/`,
    // so a composer configured for PDFs actually accepts them.
    const accepted = Array.from(files).filter((f) => {
      if (!fileMatchesAccept(f, accept)) return false;
      if (!imageEnabled && f.type.startsWith("video/")) return false;
      if (
        !imageEnabled &&
        f.type.startsWith("image/") &&
        f.type !== "image/png" &&
        f.type !== "image/jpeg"
      ) {
        return false;
      }
      if (!audioEnabled && f.type.startsWith("audio/")) return false;
      return true;
    });
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
      if (file && fileMatchesAccept(file, accept)) {
        if (!imageEnabled && (file.type.startsWith("image/") || file.type.startsWith("video/"))) continue;
        if (!audioEnabled && file.type.startsWith("audio/")) continue;
        files.push(file);
      }
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

  const toggleMic = async (): Promise<void> => {
    if (!audioEnabled || disabled) return;
    if (!micRecorderRef.current) {
      micRecorderRef.current = createBrowserMicRecorder();
    }
    const recorder = micRecorderRef.current;
    try {
      if (recording) {
        const url = await recorder.stop();
        setRecording(false);
        if (url) setAttachments((prev) => [...prev, url]);
        return;
      }
      await recorder.start();
      setRecording(true);
    } catch {
      setRecording(false);
    }
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
                <div
                  data-testid={`media-composer-doc-${i}`}
                  title={isAudioDataUrl(src) ? "Attached audio" : "Attached document"}
                  style={docChipStyle}
                >
                  {chipLabel(src)}
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
      {recording ? (
        <div
          data-testid="media-composer-recording"
          role="status"
          aria-live="polite"
          style={{ color: "var(--accent-chatbot)", fontSize: "var(--text-xs)" }}
        >
          Recording -- microphone is open
        </div>
      ) : null}
      {/*
        v2.2.0 Phase 5 (5.4): ONE rounded surface. The + and send buttons used
        to sit outside the textarea as separate boxes, which is what made the
        composer look bolted together. They are now absolutely positioned
        inside the field, and the textarea reserves matching padding so typed
        text can never slide underneath them.
      */}
      <div
        data-testid="media-composer-surface"
        style={composerSurfaceStyle(focused)}
      >
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
          title={!imageEnabled ? imageDisabledReason : undefined}
          data-testid="media-composer-add"
          data-image-enabled={imageEnabled ? "true" : "false"}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          style={inFieldButtonStyle("left")}
        >
          +
        </button>

        <textarea
          ref={textareaRef}
          data-testid="media-composer-textarea"
          aria-label="Generation prompt"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          rows={1}
          style={inFieldTextareaStyle(audioEnabled)}
        />

        <div style={rightControlsStyle}>
          {audioEnabled ? (
            <>
              <button
                type="button"
                aria-label={recording ? "Stop recording" : "Record audio"}
                title={audioHint}
                data-testid="media-composer-mic"
                disabled={disabled}
                onClick={() => void toggleMic()}
                style={recording ? micActiveStyle : iconButtonStyle}
              >
                {recording ? "Stop" : "Mic"}
              </button>
              <button
                type="button"
                aria-label="Voice options"
                data-testid="media-composer-mic-menu-toggle"
                aria-expanded={micMenuOpen}
                disabled={disabled}
                onClick={() => setMicMenuOpen((v) => !v)}
                style={chevronButtonStyle}
              >
                {"▾"}
              </button>
            </>
          ) : null}
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

        {micMenuOpen && audioEnabled ? (
          <div
            data-testid="media-composer-mic-menu"
            role="menu"
            aria-label="Voice options"
            style={micMenuStyle}
          >
            {voiceModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="menuitem"
                data-testid={`media-composer-voice-${mode.id}`}
                aria-pressed={mode.active ? true : undefined}
                onClick={() => {
                  mode.onSelect();
                  setMicMenuOpen(false);
                }}
                style={micMenuItemStyle(mode.active)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
    </AccentBeam>
    </MotionSurface>
  );
}

function chipLabel(src: string): string {
  if (src.startsWith("data:audio/")) return "AUD";
  if (src.startsWith("data:application/pdf")) return "PDF";
  return "DOC";
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

/**
 * v2.2.0 Phase 5 (5.4) -- the single composer surface.
 *
 * The old layout put the + button, the textarea, and the send button side by
 * side as three separate boxes, which is what made the composer look bolted
 * together. One rounded container with the controls inside it reads as a
 * modern composer and stops the buttons competing with the text for width.
 */
function composerSurfaceStyle(focused: boolean): CSSProperties {
  return {
    position: "relative",
    display: "block",
    backgroundColor: "var(--bg-0)",
    border: `1px solid ${focused ? "var(--accent-chatbot, #4aa)" : "var(--border-subtle, #2a2a2a)"}`,
    borderRadius: "var(--radius-lg, 12px)",
    transition: "border-color 120ms ease",
  };
}

/** Buttons pinned inside the field, anchored to its bottom edge. */
function inFieldButtonStyle(side: "left" | "right"): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    bottom: 6,
    width: 32,
    height: 32,
    fontSize: "var(--text-lg)",
    lineHeight: 1,
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "transparent",
    color: "var(--fg-muted, #999)",
    cursor: "pointer",
  };
  return side === "left" ? { ...base, left: 8 } : { ...base, right: 8 };
}

/**
 * Padding reserves exactly the space the in-field controls occupy, so typed
 * text can never render underneath them however long the message gets.
 */
function inFieldTextareaStyle(audioEnabled: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    // Left: the + button. Right: send, plus mic and chevron when audio is on.
    paddingLeft: 48,
    paddingRight: audioEnabled ? 190 : 110,
    paddingTop: "var(--space-3, 8px)",
    paddingBottom: "var(--space-3, 8px)",
    backgroundColor: "transparent",
    color: "var(--fg-0)",
    border: "none",
    outline: "none",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    resize: "none",
    // Grow to roughly six lines, then scroll internally rather than pushing
    // the conversation off screen.
    maxHeight: "9rem",
    overflowY: "auto",
  };
}

const rightControlsStyle: CSSProperties = {
  position: "absolute",
  right: 8,
  bottom: 6,
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1, 4px)",
};

const iconButtonStyle: CSSProperties = {
  height: 32,
  padding: "0 var(--space-2, 6px)",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "transparent",
  color: "var(--fg-muted, #999)",
  cursor: "pointer",
  fontSize: "var(--text-xs)",
};

const micActiveStyle: CSSProperties = { ...iconButtonStyle, color: "var(--accent-chatbot)" };

const chevronButtonStyle: CSSProperties = {
  ...iconButtonStyle,
  padding: "0 2px",
  minWidth: 16,
};

const micMenuStyle: CSSProperties = {
  position: "absolute",
  right: 8,
  bottom: 44,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  minWidth: "10rem",
  padding: "var(--space-1, 4px)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-subtle, #2a2a2a)",
  background: "var(--bg-elevated, #1b1b1b)",
};

function micMenuItemStyle(active?: boolean): CSSProperties {
  return {
    textAlign: "left",
    padding: "var(--space-2, 6px)",
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-sm, 4px)",
    color: active ? "var(--accent-chatbot)" : "var(--fg-0)",
    cursor: "pointer",
    fontSize: "var(--text-sm)",
  };
}

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
