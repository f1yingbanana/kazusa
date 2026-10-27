import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import typescript from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts"];

export default defineConfig([
  globalIgnores([
    "**/.turbo/**",
    "**/.state/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/.next/**",
    "**/*.tsbuildinfo",
  ]),

  js.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },

  typescript.configs.recommendedTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
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

  {
    files: TEST_FILES,
    ...vitest.configs.recommended,
  },
  {
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
    files: ["**/*.{js,mjs,cjs}", "vitest.config.ts"],
    ...typescript.configs.disableTypeChecked,
  },

  prettier,
]);
