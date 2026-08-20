/**
 * v1.20.0 Phase 1 (A1) -- parse_document enablement (env wins, default off).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  PARSE_DOCUMENT_ENV,
  isParseDocumentEnabled,
  parseParseDocumentEnv,
} from "../../../../core/documents/parseDocumentEnabled.js";

const prev = process.env[PARSE_DOCUMENT_ENV];

afterEach(() => {
  if (prev === undefined) delete process.env[PARSE_DOCUMENT_ENV];
  else process.env[PARSE_DOCUMENT_ENV] = prev;
});

describe("parseParseDocumentEnv", () => {
  it("treats 1/true/on/yes as true", () => {
    expect(parseParseDocumentEnv("1")).toBe(true);
    expect(parseParseDocumentEnv("TRUE")).toBe(true);
    expect(parseParseDocumentEnv("on")).toBe(true);
    expect(parseParseDocumentEnv("yes")).toBe(true);
  });

  it("treats 0/false/off/no as false", () => {
    expect(parseParseDocumentEnv("0")).toBe(false);
    expect(parseParseDocumentEnv("false")).toBe(false);
    expect(parseParseDocumentEnv("off")).toBe(false);
    expect(parseParseDocumentEnv("no")).toBe(false);
  });

  it("returns undefined for missing or unknown values", () => {
    expect(parseParseDocumentEnv(undefined)).toBeUndefined();
    expect(parseParseDocumentEnv("maybe")).toBeUndefined();
  });
});

describe("isParseDocumentEnabled", () => {
  it("defaults off", () => {
    expect(isParseDocumentEnabled({ env: {} })).toBe(false);
  });

  it("honours a stored settings boolean when env is unset", () => {
    expect(isParseDocumentEnabled({ env: {}, settingsValue: true })).toBe(true);
    expect(isParseDocumentEnabled({ env: {}, settingsValue: false })).toBe(false);
  });

  it("lets env win over settings", () => {
    expect(
      isParseDocumentEnabled({ env: { [PARSE_DOCUMENT_ENV]: "0" }, settingsValue: true }),
    ).toBe(false);
    expect(
      isParseDocumentEnabled({ env: { [PARSE_DOCUMENT_ENV]: "1" }, settingsValue: false }),
    ).toBe(true);
  });
});
