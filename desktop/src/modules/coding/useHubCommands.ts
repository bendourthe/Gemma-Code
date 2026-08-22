// v2.2.0 Phase 3 (3.3) -- load the installed Nexus-Hub commands once per mount.
//
// Kept out of CodingInput so the composer stays a pure render surface and the
// IPC call is trivially stubbable in tests. Failures are non-fatal by design:
// a missing catalog, a dead backend, or a dev environment with no Tauri
// runtime all degrade to "built-ins only" plus the composer's hint, never an
// error state on the typing surface.

import { useEffect, useState } from "react";

import { ipcCall } from "../../lib/ipc";
import type { HubCommandDescriptor } from "./slashCommands";

export interface HubCommandsState {
  commands: readonly HubCommandDescriptor[];
  /** False when the hub catalog is absent (drives the composer's hint). */
  catalogPresent: boolean;
}

interface CommandsListDto {
  commands: HubCommandDescriptor[];
  catalogPresent: boolean;
}

export function useHubCommands(
  override?: readonly HubCommandDescriptor[],
): HubCommandsState {
  const [state, setState] = useState<HubCommandsState>({
    commands: override ?? [],
    catalogPresent: override !== undefined && override.length > 0,
  });

  useEffect(() => {
    if (override !== undefined) {
      setState({ commands: override, catalogPresent: override.length > 0 });
      return;
    }
    let cancelled = false;
    void (async () => {
      const reply = await ipcCall<CommandsListDto>("commands.list", {});
      if (cancelled) return;
      if (!reply.ok) {
        setState({ commands: [], catalogPresent: false });
        return;
      }
      setState({
        commands: reply.value.commands ?? [],
        catalogPresent: Boolean(reply.value.catalogPresent),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [override]);

  return state;
}
