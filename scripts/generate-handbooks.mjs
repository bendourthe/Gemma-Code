#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { marked } from "marked";

const root = process.cwd();
const handbookRoot = join(root, "docs", "handbooks");
const sources = [join(handbookRoot, "markdown"), join(handbookRoot, "technical")];
const outputRoot = join(handbookRoot, "html");
const checkOnly = process.argv.includes("--check");

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function outputPath(source) {
  const section = sources.find((candidate) => source.startsWith(candidate));
  const prefix = section === sources[1] ? "technical" : "";
  return join(outputRoot, prefix, relative(section, source).replace(/\.md$/i, ".html"));
}

function render(source) {
  const markdown = readFileSync(source, "utf8");
  const digest = createHash("sha256").update(markdown).digest("hex");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? "Nexus handbook";
  const body = marked.parse(markdown, { gfm: true });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="source-sha256" content="${digest}">
  <title>${title}</title>
  <style>body{font:16px/1.6 system-ui,sans-serif;max-width:72rem;margin:auto;padding:2rem;color:#172033;background:#f7f9fc}a{color:#075eb8}code,pre{font-family:ui-monospace,monospace}pre{overflow:auto;padding:1rem;background:#e9eef6;border-radius:.5rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bac5d6;padding:.5rem;text-align:left}</style>
</head>
<body>
${body}</body>
</html>
`;
}

const files = sources.flatMap(markdownFiles).sort();
if (files.length === 0) {
  console.error("generate-handbooks: no Markdown sources found");
  process.exit(1);
}

const drift = [];
for (const source of files) {
  const target = outputPath(source);
  const expected = render(source);
  if (checkOnly) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== expected) {
      drift.push(relative(root, target));
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, expected, "utf8");
}

if (drift.length > 0) {
  console.error(`generate-handbooks: ${drift.length} generated file(s) are missing or stale`);
  for (const file of drift) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`generate-handbooks: ${files.length} source(s) ${checkOnly ? "match" : "generated"}`);
