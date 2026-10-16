import babelParser from "@babel/eslint-parser";

// Syntax-only lint complements the project's TypeScript 7 typecheck.
const rules = {
  "constructor-super": "error", "eqeqeq": ["error", "always"],
  "no-async-promise-executor": "error", "no-constant-condition": "error",
  "no-debugger": "error", "no-dupe-args": "error", "no-dupe-else-if": "error",
  "no-duplicate-case": "error", "no-ex-assign": "error", "no-fallthrough": "error",
  "no-promise-executor-return": "error", "no-self-assign": "error",
  "no-unreachable": "error", "no-unsafe-finally": "error", "valid-typeof": "error",
};
export default [
  { ignores: [".next*/**", ".local/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  { files: ["**/*.{js,mjs,ts,tsx}"], rules },
  ...[false, true].map((isTSX) => ({
    files: [isTSX ? "**/*.tsx" : "**/*.ts"],
    languageOptions: { parser: babelParser, parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: isTSX ? ["typescript", "jsx"] : ["typescript"] } } } },
  })),
];
