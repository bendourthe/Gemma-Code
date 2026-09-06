export type DeleteTarget =
  { kind: "folder"; id: string | null } | { kind: "chat"; id: string };

export interface DeleteConfirmCopy {
  readonly question: string;
  readonly irreversible: string;
  readonly folderWarning: string | null;
}

export function parseTreeNodeKey(key: string): DeleteTarget | null {
  if (key.startsWith("folder:")) {
    const id = key.slice("folder:".length);
    return { kind: "folder", id: id === "ROOT" ? null : id };
  }
  if (key.startsWith("chat:")) {
    return { kind: "chat", id: key.slice("chat:".length) };
  }
  return null;
}

export function deleteConfirmCopy(
  targets: readonly DeleteTarget[],
  itemNoun = "session",
): DeleteConfirmCopy {
  const chats = targets.filter((target) => target.kind === "chat");
  const folders = targets.filter(
    (target) => target.kind === "folder" && target.id !== null,
  );
  const irreversible = "This action cannot be undone.";
  const pluralNoun = itemNoun === "session" ? "sessions" : "chats";
  const singularNoun = itemNoun === "session" ? "session" : "chat";
  let question: string;
  if (chats.length > 0 && folders.length > 0) {
    question = "Delete the selected items?";
  } else if (folders.length > 1) {
    question = "Delete the selected folders?";
  } else if (folders.length === 1) {
    question = "Delete the selected folder?";
  } else if (chats.length > 1) {
    question = `Delete the selected ${pluralNoun}?`;
  } else {
    question = `Delete the selected ${singularNoun}?`;
  }
  const folderWarning =
    folders.length === 0
      ? null
      : folders.length === 1
        ? "Contents of the selected folder will be deleted too."
        : "Contents of the selected folders will be deleted too.";
  return { question, irreversible, folderWarning };
}

export function rangeSelectKeys(
  keys: readonly string[],
  fromIdx: number,
  toIdx: number,
): string[] {
  if (keys.length === 0) return [];
  const start = Math.max(0, Math.min(fromIdx, toIdx));
  const end = Math.min(keys.length - 1, Math.max(fromIdx, toIdx));
  return keys.slice(start, end + 1);
}
