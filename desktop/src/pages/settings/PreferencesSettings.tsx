/**
 * v2.4.8 follow-up (2026-09-07) -- Settings > Preferences.
 *
 * The first tab, and the one Settings opens on. It holds the choices that are
 * the user's opinion rather than the installer's: whether to be asked before a
 * model switch stops work on the GPU, which model each category selects by
 * default, and the order the pickers list them in. Everything here is stored
 * per install (localStorage, the `nexus.ui.*` keys) and read by the pickers
 * through `modelPreferences`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Switch } from "../../components/ui";
import { createIpcModelsClient } from "./ipcModelsClient";
import type { ListedModelDto } from "./modelsTypes";
import {
  CATALOG_TAB_DEFS,
  catalogTabsFor,
  type CatalogTab,
} from "../../shared/models/catalogTabs";
import {
  readDefaultModel,
  readModelOrder,
  reorder,
  writeDefaultModel,
  writeModelOrder,
} from "../../shared/models/modelPreferences";
import {
  askBeforeModelSwitch,
  setAskBeforeModelSwitch,
} from "../../shared/models/modelSwitchPreference";

export interface PreferencesSettingsProps {
  /** Injected in tests; production reads the sidecar catalog. */
  readonly listModels?: () => Promise<readonly ListedModelDto[]>;
}

export function PreferencesSettings({
  listModels,
}: PreferencesSettingsProps = {}): JSX.Element {
  const [models, setModels] = useState<readonly ListedModelDto[]>([]);
  const [ask, setAsk] = useState(() => askBeforeModelSwitch());
  // Bumped after a write so the lists re-read what was stored.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const source = listModels ?? (() => createIpcModelsClient().list());
    void Promise.resolve(source()).then(
      (all) => {
        if (!cancelled) setModels(all);
      },
      () => {
        if (!cancelled) setModels([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [listModels]);

  const installedByTab = useMemo(() => {
    const byTab = new Map<CatalogTab, ListedModelDto[]>();
    for (const model of models) {
      if (!model.installed) continue;
      for (const tab of catalogTabsFor(model)) {
        const bucket = byTab.get(tab) ?? [];
        bucket.push(model);
        byTab.set(tab, bucket);
      }
    }
    return byTab;
  }, [models]);

  return (
    <section data-testid="settings-preferences" style={pageStyle}>
      <header>
        <h1 style={{ margin: 0 }}>Preferences</h1>
        <p style={mutedStyle}>
          How Nexus behaves for you. These choices stay on this computer.
        </p>
      </header>

      <div style={cardStyle}>
        <h2 style={headingStyle}>Switching models</h2>
        <Switch
          testId="prefs-ask-before-switch"
          checked={ask}
          onChange={(next) => {
            setAsk(next);
            setAskBeforeModelSwitch(next);
          }}
          label="Ask before switching models"
        />
        <p style={mutedStyle}>
          Only one model fits on the GPU at a time. When this is on, Nexus asks
          before it unloads the current model, because anything still
          generating stops. Turning it off switches straight away.
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={headingStyle}>Models by category</h2>
        <p style={mutedStyle}>
          Pick the model each category starts with, and the order the picker
          lists them in. Only models you have downloaded appear here.
        </p>
        {CATALOG_TAB_DEFS.map((def) => (
          <CategoryPreference
            key={`${def.id}-${revision}`}
            tab={def.id}
            label={def.label}
            installed={installedByTab.get(def.id) ?? []}
            onChanged={() => setRevision((n) => n + 1)}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryPreference({
  tab,
  label,
  installed,
  onChanged,
}: {
  tab: CatalogTab;
  label: string;
  installed: readonly ListedModelDto[];
  onChanged: () => void;
}): JSX.Element {
  const [order, setOrder] = useState<readonly string[]>(() => readModelOrder(tab));
  const [chosen, setChosen] = useState<string | null>(() => readDefaultModel(tab));

  /** Stored order first, then anything installed the user has not placed. */
  const rows = useMemo(() => {
    const byId = new Map(installed.map((model) => [model.id, model]));
    const placed = order.flatMap((id) => {
      const model = byId.get(id);
      return model ? [model] : [];
    });
    const rest = installed.filter((model) => !order.includes(model.id));
    return [...placed, ...rest];
  }, [installed, order]);

  const move = useCallback(
    (id: string, direction: "up" | "down") => {
      const next = reorder(
        rows.map((model) => model.id),
        id,
        direction,
      );
      setOrder(next);
      writeModelOrder(tab, next);
      onChanged();
    },
    [rows, tab, onChanged],
  );

  const choose = useCallback(
    (id: string) => {
      const next = chosen === id ? null : id;
      setChosen(next);
      writeDefaultModel(tab, next);
      onChanged();
    },
    [chosen, tab, onChanged],
  );

  return (
    <div data-testid={`prefs-category-${tab}`} style={categoryStyle}>
      <h3 style={{ margin: 0, fontSize: "var(--text-sm)" }}>{label}</h3>
      {rows.length === 0 ? (
        <p style={mutedStyle}>No models downloaded for {label.toLowerCase()} yet.</p>
      ) : (
        <ol style={listStyle}>
          {rows.map((model, index) => (
            <li key={model.id} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}>{model.displayName}</span>
              <Button
                type="button"
                variant="ghost"
                testId={`prefs-default-${tab}-${model.id}`}
                aria-pressed={chosen === model.id}
                onClick={() => choose(model.id)}
                style={chosen === model.id ? chosenStyle : undefined}
              >
                {chosen === model.id ? "Default" : "Make default"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                testId={`prefs-up-${tab}-${model.id}`}
                aria-label={`Move ${model.displayName} up`}
                disabled={index === 0}
                onClick={() => move(model.id, "up")}
              >
                Up
              </Button>
              <Button
                type="button"
                variant="ghost"
                testId={`prefs-down-${tab}-${model.id}`}
                aria-label={`Move ${model.displayName} down`}
                disabled={index === rows.length - 1}
                onClick={() => move(model.id, "down")}
              >
                Down
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3, 12px)",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
  padding: "var(--space-3, 12px)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-1)",
  background: "var(--bg-elevated)",
};

const headingStyle: CSSProperties = { margin: 0, fontSize: "var(--text-md)" };

const mutedStyle: CSSProperties = {
  margin: 0,
  color: "var(--fg-muted)",
  fontSize: "var(--text-sm)",
};

const categoryStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1, 4px)",
  paddingTop: "var(--space-2, 8px)",
  borderTop: "1px solid var(--border-subtle)",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1, 4px)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2, 8px)",
  fontSize: "var(--text-sm)",
};

const chosenStyle: CSSProperties = {
  borderColor: "color-mix(in srgb, var(--accent-primary, #6366f1) 60%, transparent)",
  color: "var(--fg-0)",
};
