import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier/flat";
import tailwindcss from "eslint-plugin-tailwindcss";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import typescript from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx"];

/** The Next.js client: browser code, Tailwind classes, vitest unit tests. */
export default defineConfig([
  globalIgnores([
    ".next/",
    "next-env.d.ts",
    "node_modules/",
    "test-results/",
    "**/*.tsbuildinfo",
  ]),

  js.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },

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
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // eslint-plugin-tailwindcss config (Tailwind v4 reads the CSS entry file)
  {
    ...tailwindcss.configs.recommended,
    rules: {
      ...tailwindcss.configs.recommended.rules,
      // Hooks Sonner's own stylesheet; not a utility.
      "tailwindcss/no-custom-classname": ["warn", { whitelist: ["toaster"] }],
    },
    settings: {
      tailwindcss: {
        cssConfigPath: `${import.meta.dirname}/app/globals.css`,
      },
    },
  },

  { files: TEST_FILES, ...vitest.configs.recommended },
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
    files: ["**/*.{js,mjs,cjs}"],
    ...typescript.configs.disableTypeChecked,
  },

  prettier,
]);
