import { useCallback, useEffect, useState } from "react";
import { ipcCall } from "../../lib/ipc";
import type { ArchivedSessionDtoT, SessionPillarT } from "../../../sidecar/src/protocol";
import { Button } from "../../components/ui";

export interface ArchivedChatsClient {
  list(): Promise<{
    sessions: readonly ArchivedSessionDtoT[];
    errors: readonly { pillar: SessionPillarT; message: string }[];
  }>;
  restore(pillar: SessionPillarT, id: string): Promise<{ parentFallback?: boolean }>;
}

export function createIpcArchivedChatsClient(): ArchivedChatsClient {
  return {
    async list() {
      const reply = await ipcCall<{
        sessions: ArchivedSessionDtoT[];
        errors: Array<{ pillar: SessionPillarT; message: string }>;
      }>("sessions.listArchived", {});
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
    async restore(pillar, id) {
      const reply = await ipcCall<{ parentFallback?: boolean }>("sessions.restore", { pillar, id });
      if (!reply.ok) throw new Error(reply.message);
      return reply.value;
    },
  };
}

const GROUPS: readonly { pillar: SessionPillarT; label: string }[] = [
  { pillar: "chatbot", label: "Chatbot" },
  { pillar: "agents", label: "Agents" },
  { pillar: "images", label: "Images" },
  { pillar: "videos", label: "Videos" },
];

export function ArchivedChatsSettings({ client = createIpcArchivedChatsClient() }: { client?: ArchivedChatsClient }): JSX.Element {
  const [sessions, setSessions] = useState<readonly ArchivedSessionDtoT[]>([]);
  const [errors, setErrors] = useState<readonly { pillar: SessionPillarT; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFatalError(null);
    try {
      const result = await client.list();
      setSessions(result.sessions);
      setErrors(result.errors);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function restore(session: ArchivedSessionDtoT): Promise<void> {
    if (pendingId) return;
    setPendingId(session.id);
    setNotice(null);
    try {
      const result = await client.restore(session.pillar, session.id);
      setSessions((current) => current.filter((row) => !(row.id === session.id && row.pillar === session.pillar)));
      setNotice(result.parentFallback ? "Restored to the root because the original location no longer exists." : "Chat restored.");
    } catch (error) {
      setNotice(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section data-testid="archived-chats-settings" aria-labelledby="archived-chats-title" style={{ padding: "var(--space-6)", overflow: "auto" }}>
      <h1 id="archived-chats-title">Archived chats</h1>
      <p style={{ color: "var(--fg-muted)" }}>Restore archived chats to their original tab and location when it still exists.</p>
      {loading ? <p role="status">Loading archived chats...</p> : null}
      {fatalError ? <p role="alert">Could not load archived chats: {fatalError} <Button type="button" onClick={() => void refresh()}>Retry</Button></p> : null}
      {errors.map((error) => <p key={error.pillar} role="status">{error.pillar}: {error.message}</p>)}
      {!loading && !fatalError && sessions.length === 0 ? <p data-testid="archived-chats-empty">No archived chats.</p> : null}
      {GROUPS.map((group) => {
        const rows = sessions.filter((session) => session.pillar === group.pillar);
        if (rows.length === 0) return null;
        return (
          <section key={group.pillar} aria-labelledby={`archives-${group.pillar}`}>
            <h2 id={`archives-${group.pillar}`}>{group.label}</h2>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {rows.map((session) => (
                <li key={session.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", padding: "var(--space-3)", borderBottom: "1px solid var(--border-1)" }}>
                  <span><strong>{session.title}</strong><br /><small>{new Date(session.archivedAt).toLocaleString()} · {session.originalParent ?? "Root"}</small></span>
                  <Button type="button" disabled={pendingId !== null} onClick={() => void restore(session)}>{pendingId === session.id ? "Restoring..." : "Restore"}</Button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
