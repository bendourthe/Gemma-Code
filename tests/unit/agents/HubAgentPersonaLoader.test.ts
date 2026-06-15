import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  HubAgentPersonaLoader,
  translateHubTools,
  personaFromMarkdown,
} from "../../../modules/coding/agents/HubAgentPersonaLoader.js";

describe("translateHubTools (HUB.P3.AGENT)", () => {
  it("maps Hub human tool names to Nexus registry ids", () => {
    expect(translateHubTools("Read, Glob, Grep, Bash")).toEqual([
      "read_file",
      "list_directory",
      "grep_codebase",
      "run_terminal",
    ]);
  });

  it("drops unknown / unsafe tools (e.g. Task) and dedupes", () => {
    expect(translateHubTools("Read, Task, Read, WebSearch")).toEqual([
      "read_file",
      "web_search",
    ]);
  });

  it("returns [] for empty/undefined", () => {
    expect(translateHubTools(undefined)).toEqual([]);
    expect(translateHubTools("")).toEqual([]);
  });
});

describe("personaFromMarkdown", () => {
  it("parses name/description/tools + body", () => {
    const md = `---\nname: code-reviewer\ndescription: Reviews code.\ntools: Read, Grep, Bash\n---\nYou are a senior reviewer.`;
    const p = personaFromMarkdown(md, "fallback");
    expect(p).not.toBeNull();
    expect(p!.name).toBe("code-reviewer");
    expect(p!.description).toBe("Reviews code.");
    expect(p!.toolScope).toEqual(["read_file", "grep_codebase", "run_terminal"]);
    expect(p!.systemPrompt).toBe("You are a senior reviewer.");
  });

  it("returns null when there is no frontmatter or no body", () => {
    expect(personaFromMarkdown("no frontmatter here", "x")).toBeNull();
    expect(personaFromMarkdown("---\nname: a\n---\n", "x")).toBeNull();
  });

  it("falls back to the filename when name is absent", () => {
    const md = `---\ndescription: d\ntools: Read\n---\nbody`;
    expect(personaFromMarkdown(md, "architect")!.name).toBe("architect");
  });
});

describe("HubAgentPersonaLoader", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-agents-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeAgent(name: string, tools: string, body: string): void {
    fs.writeFileSync(
      path.join(dir, `${name}.md`),
      `---\nname: ${name}\ndescription: ${name} agent\ntools: ${tools}\n---\n${body}`,
      "utf-8",
    );
  }

  it("loads + indexes agent files and lists names sorted", () => {
    writeAgent("architect", "Read, Grep", "Design systems.");
    writeAgent("code-reviewer", "Read, Bash", "Review code.");
    const loader = new HubAgentPersonaLoader(dir);
    expect(loader.listNames()).toEqual(["architect", "code-reviewer"]);
    expect(loader.get("architect")!.toolScope).toEqual(["read_file", "grep_codebase"]);
    expect(loader.loadAll()).toHaveLength(2);
  });

  it("is inert (empty) when the agents dir is null or missing", () => {
    expect(new HubAgentPersonaLoader(null).loadAll()).toEqual([]);
    expect(new HubAgentPersonaLoader(path.join(dir, "nope")).loadAll()).toEqual([]);
  });

  it("toSpecialist returns a hub-provenance Specialist with translated scope", () => {
    writeAgent("security-reviewer", "Read, Grep, Bash", "Find vulns.");
    const loader = new HubAgentPersonaLoader(dir);
    const spec = loader.toSpecialist("security-reviewer");
    expect(spec).not.toBeNull();
    expect(spec!.provenance).toBe("hub");
    expect(spec!.role).toBe("security-reviewer");
    expect(spec!.toolScope).toEqual(["read_file", "grep_codebase", "run_terminal"]);
    expect(spec!.systemPrompt).toBe("Find vulns.");
    expect(loader.toSpecialist("does-not-exist")).toBeNull();
  });
});
