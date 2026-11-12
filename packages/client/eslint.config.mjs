import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import typescript from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts"];

/**
 * The wire contract shared by the server and the browser, so it assumes neither
 * runtime's globals: anything it needs must come from the standard library or
 * its own imports.
 */
export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**"]),

  js.configs.recommended,

  typescript.configs.recommendedTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  { files: TEST_FILES, ...vitest.configs.recommended },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...typescript.configs.disableTypeChecked,
  },

  prettier,
]);
