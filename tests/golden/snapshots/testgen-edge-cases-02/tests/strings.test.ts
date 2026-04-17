import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/strings.js";

test("slugify converts spaces to hyphens", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify trims result", () => {
  assert.equal(slugify("  hi  "), "hi");
});
