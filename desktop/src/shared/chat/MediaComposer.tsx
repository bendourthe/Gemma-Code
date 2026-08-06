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
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";

export interface MediaComposerProps {
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (text: string, attachments: readonly string[]) => void;
  accept?: string;
  submitAccentVar?: string;
  /** When set (and it changes), appended to the pending attachments ("Use as source"). */
  seededAttachment?: string | null;
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
  seededAttachment,
}: MediaComposerProps): JSX.Element {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (seededAttachment) setAttachments((prev) => [...prev, seededAttachment]);
  }, [seededAttachment]);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    const urls = await readFilesAsDataUrls(images);
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
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
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

  return (
    <div
      data-testid="media-composer"
      data-drag-active={dragActive}
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
              <img
                src={src}
                alt="Pending attachment"
                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--radius-sm)" }}
              />
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
          aria-label="Add images"
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
        <button
          type="button"
          data-testid="media-composer-submit"
          disabled={!canSubmit}
          onClick={submit}
          style={submitStyle(submitAccentVar)}
        >
          Send
        </button>
      </div>
    </div>
  );
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
