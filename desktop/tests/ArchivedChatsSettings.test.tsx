import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArchivedChatsSettings, type ArchivedChatsClient } from "../src/pages/settings/ArchivedChatsSettings";

describe("ArchivedChatsSettings", () => {
  it("groups pillars, shows partial errors, and removes a restored row", async () => {
    const client: ArchivedChatsClient = {
      list: vi.fn(async () => ({
        sessions: [
          { pillar: "chatbot" as const, id: "c1", title: "Chat one", archivedAt: "2026-08-29T00:00:00.000Z", originalParent: "Folder" },
          { pillar: "agents" as const, id: "a1", title: "Agent one", archivedAt: "2026-08-29T01:00:00.000Z", originalParent: null },
        ],
        errors: [{ pillar: "videos" as const, message: "store busy" }],
      })),
      restore: vi.fn(async () => ({ parentFallback: false })),
    };
    render(<ArchivedChatsSettings client={client} />);
    expect(await screen.findByText("Chatbot")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText(/videos: store busy/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]!);
    await waitFor(() => expect(screen.queryByText("Chat one")).not.toBeInTheDocument());
    expect(client.restore).toHaveBeenCalledWith("chatbot", "c1");
  });
});
