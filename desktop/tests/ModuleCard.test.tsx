import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Code2 } from "lucide-react";
import { ModuleCard } from "../src/components/ModuleCard";

function renderCard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <ModuleCard
              moduleId="coding"
              subtitle="Multi-LLM coding partner"
              body="Plan, edit, test, ship."
              cta="Open Code Assistant"
              to="/coding"
              icon={<Code2 size={18} />}
            />
          }
        />
        <Route path="/coding" element={<div data-testid="dest">coding</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ModuleCard", () => {
  it("renders title, subtitle, body, cta, preview slot", () => {
    renderCard();
    expect(screen.getByText("Agentic AI Coding")).toBeInTheDocument();
    expect(screen.getByText("Multi-LLM coding partner")).toBeInTheDocument();
    expect(screen.getByText("Plan, edit, test, ship.")).toBeInTheDocument();
    expect(screen.getByTestId("module-card-coding-cta")).toHaveTextContent("Open Code Assistant");
    expect(screen.getByTestId("module-card-coding-preview")).toBeInTheDocument();
  });

  it("clicking the CTA navigates to the target route", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("module-card-coding-cta"));
    expect(screen.getByTestId("dest")).toBeInTheDocument();
  });

  it("renders all four module variants", () => {
    const ids = ["chatbot", "coding", "image", "video"] as const;
    for (const id of ids) {
      const { unmount } = render(
        <MemoryRouter>
          <ModuleCard
            moduleId={id}
            subtitle="s"
            body="b"
            cta="c"
            to="/x"
            icon={<Code2 size={18} />}
          />
        </MemoryRouter>,
      );
      expect(screen.getByTestId(`module-card-${id}`)).toBeInTheDocument();
      unmount();
    }
  });
});
