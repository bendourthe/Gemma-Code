import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FineTuningSettings } from "../src/pages/settings/FineTuningSettings";
import {
  createMockFineTuningClient,
  MOCK_UNSUPPORTED_TUNING,
} from "../src/pages/settings/mockFineTuningClient";

describe("FineTuningSettings", () => {
  it("hides actions on unsupported hardware", async () => {
    render(
      <FineTuningSettings client={createMockFineTuningClient(MOCK_UNSUPPORTED_TUNING)} />,
    );
    await waitFor(() => expect(screen.getByTestId("fine-tuning-hidden")).toBeInTheDocument());
    expect(screen.queryByTestId("fine-tuning-provision")).not.toBeInTheDocument();
  });

  it("provisions, builds a redacted preview, and starts a job", async () => {
    const user = userEvent.setup();
    render(<FineTuningSettings client={createMockFineTuningClient()} />);
    await waitFor(() => expect(screen.getByTestId("fine-tuning-provision")).toBeInTheDocument());
    await user.click(screen.getByTestId("fine-tuning-provision"));
    await waitFor(() =>
      expect(screen.getByTestId("fine-tuning-provision-state").textContent).toMatch(/ready/i),
    );
    await user.type(screen.getByTestId("fine-tuning-sources"), "/tmp/chats");
    await user.click(screen.getByTestId("fine-tuning-build-dataset"));
    await waitFor(() => expect(screen.getByTestId("fine-tuning-dataset-preview")).toBeInTheDocument());
    expect(screen.getByTestId("fine-tuning-dataset-preview").textContent).toContain("<redacted>");
    await user.click(screen.getByTestId("fine-tuning-start"));
    await waitFor(() => expect(screen.getByTestId("fine-tuning-job-j-mock")).toBeInTheDocument());
    expect(screen.getByTestId("fine-tuning-job-j-mock").textContent).toMatch(/done/);
  });
});
