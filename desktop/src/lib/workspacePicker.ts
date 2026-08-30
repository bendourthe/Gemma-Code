import { invokeCommand } from "./ipc";

export type WorkspaceDialogOpen = (options: {
  directory: true;
  multiple: true;
  title: string;
}) => Promise<string | string[] | null>;

let openOverride: WorkspaceDialogOpen | null = null;
let pickerTail: Promise<void> = Promise.resolve();

export function setWorkspaceDialogOverride(open: WorkspaceDialogOpen | null): void {
  openOverride = open;
}

async function resolveOpen(): Promise<WorkspaceDialogOpen> {
  if (openOverride) return openOverride;
  const dialog = await import("@tauri-apps/plugin-dialog");
  return dialog.open as WorkspaceDialogOpen;
}

async function openAndCanonicalize(): Promise<readonly string[]> {
  const open = await resolveOpen();
  const selected = await open({
    directory: true,
    multiple: true,
    title: "Add folders to workspace",
  });
  if (selected === null) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  if (paths.length === 0) return [];
  const reply = await invokeCommand<string[]>("canonicalize_workspace_roots", { paths });
  if (!reply.ok) throw new Error(reply.message);
  return Object.freeze([...reply.value]);
}

/** Serialize native dialogs so rapid clicks cannot overlap OS picker windows. */
export function pickWorkspaceFolders(): Promise<readonly string[]> {
  const request = pickerTail.then(openAndCanonicalize, openAndCanonicalize);
  pickerTail = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}
