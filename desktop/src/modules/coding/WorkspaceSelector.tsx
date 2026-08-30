import { useRef } from "react";
import { Folder, FolderPlus, X } from "lucide-react";
import { pickWorkspaceFolders } from "../../lib/workspacePicker";
import type { CodingWorkspaceSelection } from "../../lib/persistence";

export interface WorkspaceSelectorProps {
  selection: CodingWorkspaceSelection | null;
  disabled?: boolean;
  onReplacePrimary(paths: readonly string[]): void | Promise<void>;
  onAdd(paths: readonly string[]): void | Promise<void>;
  onRemove(path: string): void | Promise<void>;
  onError(message: string): void;
}

function folderName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

export function WorkspaceSelector({
  selection,
  disabled = false,
  onReplacePrimary,
  onAdd,
  onRemove,
  onError,
}: WorkspaceSelectorProps): JSX.Element {
  const latestRequest = useRef(0);
  const choose = async (mode: "replace" | "add"): Promise<void> => {
    const requestId = ++latestRequest.current;
    try {
      const paths = await pickWorkspaceFolders();
      if (requestId !== latestRequest.current) return;
      if (paths.length === 0) return;
      if (mode === "replace") await onReplacePrimary(paths);
      else await onAdd(paths);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      data-testid="coding-workspace-selector"
      aria-label="Workspace folders"
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2)" }}
    >
      <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>Workspace</span>
      {selection ? (
        <>
          {selection.roots.map((root, index) => (
            <span
              key={root}
              title={root}
              data-testid={index === 0 ? "coding-workspace-primary" : "coding-workspace-extra"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                maxWidth: "22rem",
                padding: "var(--space-1) var(--space-2)",
                border: "1px solid var(--border-1)",
                borderRadius: "999px",
                background: "color-mix(in srgb, var(--bg-1) 72%, transparent)",
              }}
            >
              <button
                type="button"
                disabled={disabled}
                aria-label={index === 0 ? `Change primary folder ${folderName(root)}` : root}
                onClick={index === 0 ? () => void choose("replace") : undefined}
                style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "inherit", background: "none", border: 0, padding: 0, cursor: index === 0 ? "pointer" : "default" }}
              >
                <Folder size={14} aria-hidden="true" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folderName(root)}</span>
              </button>
              {index > 0 && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove folder ${folderName(root)}`}
                  onClick={() => void onRemove(root)}
                  style={{ display: "inline-flex", color: "var(--fg-muted)", background: "none", border: 0, padding: 0, cursor: "pointer" }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            data-testid="coding-workspace-add"
            disabled={disabled || selection.roots.length >= 32}
            title="Add a local folder to this workspace"
            aria-label="Add workspace folder"
            onClick={() => void choose("add")}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "999px", border: "1px solid var(--border-1)", color: "var(--fg-muted)", background: "transparent", cursor: "pointer" }}
          >
            <FolderPlus size={15} aria-hidden="true" />
          </button>
        </>
      ) : (
        <span data-testid="coding-workspace-loading" style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>Loading home folder...</span>
      )}
    </div>
  );
}
