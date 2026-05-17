import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TimelinePreviewer } from "../src/modules/video/TimelinePreviewer";

describe("TimelinePreviewer", () => {
  it("renders the empty state when no source is supplied", () => {
    render(<TimelinePreviewer src={null} fps={24} />);
    expect(screen.getByTestId("video-timeline-previewer-empty")).toBeInTheDocument();
  });

  it("renders the video element + controls when a source is supplied", () => {
    render(<TimelinePreviewer src="mock://clip.mp4" fps={24} />);
    expect(screen.getByTestId("video-timeline-previewer-video")).toBeInTheDocument();
    expect(screen.getByTestId("video-timeline-previewer-scrubber")).toBeInTheDocument();
    expect(screen.getByTestId("video-timeline-previewer-step-back")).toBeInTheDocument();
    expect(
      screen.getByTestId("video-timeline-previewer-step-forward"),
    ).toBeInTheDocument();
  });

  it("changing the scrubber updates the visible timecode", () => {
    render(<TimelinePreviewer src="mock://clip.mp4" fps={24} />);
    const scrubber = screen.getByTestId(
      "video-timeline-previewer-scrubber",
    ) as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: "1.5" } });
    expect(screen.getByTestId("video-timeline-previewer-timecode")).toHaveTextContent(
      "1.50s",
    );
  });

  it("step buttons advance by 1/fps", () => {
    render(<TimelinePreviewer src="mock://clip.mp4" fps={24} />);
    const tc = screen.getByTestId("video-timeline-previewer-timecode");
    // Initial timecode is 0.
    expect(tc.textContent).toMatch(/^0\.00s/);
    fireEvent.click(screen.getByTestId("video-timeline-previewer-step-forward"));
    // 1/24 ~= 0.04s
    expect(tc.textContent).toMatch(/^0\.04s/);
  });

  it("step-back at time 0 stays at 0 (clamped)", () => {
    render(<TimelinePreviewer src="mock://clip.mp4" fps={24} />);
    fireEvent.click(screen.getByTestId("video-timeline-previewer-step-back"));
    const tc = screen.getByTestId("video-timeline-previewer-timecode");
    expect(tc.textContent).toMatch(/^0\.00s/);
  });

  it("play / pause buttons do not throw even when video element is unattached", () => {
    render(<TimelinePreviewer src="mock://clip.mp4" fps={24} />);
    expect(() =>
      fireEvent.click(screen.getByTestId("video-timeline-previewer-play")),
    ).not.toThrow();
    expect(() =>
      fireEvent.click(screen.getByTestId("video-timeline-previewer-pause")),
    ).not.toThrow();
  });

  it("changing src resets the current time to 0", () => {
    const { rerender } = render(
      <TimelinePreviewer src="mock://clip1.mp4" fps={24} />,
    );
    const scrubber = screen.getByTestId(
      "video-timeline-previewer-scrubber",
    ) as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: "1.0" } });
    rerender(<TimelinePreviewer src="mock://clip2.mp4" fps={24} />);
    expect(screen.getByTestId("video-timeline-previewer-timecode").textContent).toMatch(
      /^0\.00s/,
    );
  });

  it("invalid fps (0) makes step buttons no-op", () => {
    render(<TimelinePreviewer src="mock://clip.mp4" fps={0} />);
    fireEvent.click(screen.getByTestId("video-timeline-previewer-step-forward"));
    const tc = screen.getByTestId("video-timeline-previewer-timecode");
    expect(tc.textContent).toMatch(/^0\.00s/);
  });
});
