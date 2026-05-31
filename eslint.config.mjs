import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "modules/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended"].rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          "ts-nocheck": "allow-with-description",
          "ts-check": false,
          "minimumDescriptionLength": 20,
        },
      ],
      "no-console": "error",
      // Phase 3 (v0.6.0) -- pen-test F-006 / security-audit F-008.
      // Block `el.innerHTML = a + b` patterns at the TS-source level. Webview
      // JS that lives inside template-literal strings is opaque to ESLint;
      // the rule serves as a regression guard for any code that promotes
      // those patterns to true TypeScript modules (Phase 6 decomposition).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression[left.property.name='innerHTML'][right.type='BinaryExpression'][right.operator='+']",
          message:
            "innerHTML = ... + ... is fragile; use createElement + textContent or a sanitized template helper (see src/panels/webview/util.ts).",
        },
      ],
    },
  },
  {
    ignores: ["out/**", "node_modules/**", "tests/**"],
  },
];
