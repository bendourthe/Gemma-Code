import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocalModelStatusDock } from "../src/components/LocalModelStatusDock";
import type {
  TelemetryStream,
  TelemetrySubscriber,
} from "../src/components/LocalModelStatus.types";

function manualStream(): TelemetryStream {
  const subs = new Set<TelemetrySubscriber>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

describe("LocalModelStatusDock", () => {
  it("renders the dock container in the muted state when stream is null", () => {
    render(<LocalModelStatusDock stream={null} />);
    expect(screen.getByTestId("local-model-status-dock")).toBeInTheDocument();
    expect(screen.getByTestId("local-model-status").dataset["state"]).toBe("muted");
  });

  it("forwards an attached stream into the widget", () => {
    const stream = manualStream();
    render(<LocalModelStatusDock stream={stream} />);
    expect(screen.getByTestId("local-model-status").dataset["state"]).toBe("loading");
  });
});
