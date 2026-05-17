// Flat ESLint config for the desktop workspace. Mirrors the root project's
// strict settings but scopes globals to browser + node since the workspace
// has both a React app and a Node sidecar.
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "src-tauri/target/**", "sidecar/dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "sidecar/src/**/*.ts", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        console: "readonly",
        process: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        KeyboardEvent: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        React: "readonly",
        NodeJS: "readonly",
        JSX: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
];
