/**
 * v2.2.4 Phase 2 -- Settings URL tab deep-link (DF-17).
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import { SettingsPage } from "../src/pages/settings/SettingsPage";

function UrlDriver(): JSX.Element {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <button type="button" onClick={() => setSearchParams({ tab: "models" })}>
        go-models
      </button>
      <SettingsPage initialTab="skills" />
    </>
  );
}

describe("SettingsPage URL tabs", () => {
  it("opens the Models tab from ?tab=models even when initialTab is skills", () => {
    render(
      <MemoryRouter initialEntries={["/settings?tab=models"]}>
        <SettingsPage initialTab="skills" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("settings-models")).toBeInTheDocument();
  });

  it("switches to Models when the query changes while Settings stays mounted", () => {
    render(
      <MemoryRouter initialEntries={["/settings?tab=skills"]}>
        <UrlDriver />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("settings-skills")).toBeInTheDocument();
    fireEvent.click(screen.getByText("go-models"));
    expect(screen.getByTestId("settings-models")).toBeInTheDocument();
  });
});
