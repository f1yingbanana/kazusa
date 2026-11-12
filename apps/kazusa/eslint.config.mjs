import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import typescript from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts"];

/**
 * Everything under apps/kazusa shares this config: the OpenClaw plugin
 * (plugins/kazusa) is the only code, and it runs on Node.
 */
export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    // OpenClaw writes caches (bundled UI assets, ...) under each world.
    "**/.state/**",
  ]),

  js.configs.recommended,
  { languageOptions: { globals: globals.node } },

  typescript.configs.recommendedTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Typed linting; each file resolves the nearest tsconfig (the plugin's).
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  { files: TEST_FILES, ...vitest.configs.recommended },
  {
    // Tests poke at untyped fixtures and mock internals on purpose.
    files: TEST_FILES,
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...typescript.configs.disableTypeChecked,
  },

  // Last, so it turns off whatever would fight Prettier.
  prettier,
]);
