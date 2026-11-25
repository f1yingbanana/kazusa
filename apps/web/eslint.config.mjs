import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettier from "eslint-config-prettier/flat";
import tailwindcss from "eslint-plugin-tailwindcss";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import typescript from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx"];

/**
 * Class names in ui/ and features/ that only work, or only look right, while
 * app/shadcn.css is loaded: its colours, fonts, named radii, tw-animate and
 * utilities, and the bare state variants it redefines. Use the ui-* colours,
 * rounded-full or an exact rounded-[…], and data-[…] variants instead.
 */
const SHADCN_CLASS =
  "(^|\\s|:)(" +
  [
    "(bg|text|border|ring|inset-ring|outline|fill|stroke|from|via|to|divide|shadow|decoration|caret|accent|placeholder)-(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|online|chart-\\d|sidebar)(-[a-z]+)*(\\x2F\\d+)?",
    "font-(sans|mono)",
    "rounded(-[a-z]{1,2})?(-(xs|sm|md|lg|xl|[234]xl))?",
    "data-(open|closed|checked|unchecked|selected|disabled|active|horizontal|vertical):",
    "(animate|fade|zoom|slide|spin)-(in|out)",
    "(no-scrollbar|scroll-fade|shimmer|wiki-checker)",
  ].join("|") +
  ")(?=\\s|$|:)";

const SHADCN_CLASS_MESSAGE =
  "This class depends on app/shadcn.css, which goes away with the old UI. Use ui-* colours, rounded-full or rounded-[…], and data-[…] variants.";

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

  // The rebuild keeps three layers apart so the old UI can be deleted in one go:
  // ui/ is a generic component library on ui-sdk, features/ builds the app from
  // it, and features/legacy.ts is the only door back into components/. Neither
  // may use a class that only app/shadcn.css defines.
  {
    files: ["ui/**", "features/**"],
    rules: {
      // Its fix rewrites leading-[1.4] as leading-1.4, a spacing multiple in v4.
      "tailwindcss/no-unnecessary-arbitrary-value": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${SHADCN_CLASS}/]`,
          message: SHADCN_CLASS_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${SHADCN_CLASS}/]`,
          message: SHADCN_CLASS_MESSAGE,
        },
      ],
    },
  },
  {
    files: ["ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "@kazusa/*", "nuqs", "swr", "zustand", "sonner"],
              message:
                "ui/ is a generic component library: it knows nothing about Kazusa or its data.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["features/**"],
    ignores: ["features/legacy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/*"],
              message:
                "Borrow old components through features/legacy.ts, so what is left to port stays in one place.",
            },
            {
              group: ["@ui-sdk/*"],
              message: "Build from ui/, which wraps ui-sdk in our look.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["components/**", "app/**", "lib/**", "hooks/**"],
    ignores: ["app/halo/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/ui/*", "@/features/*"],
              message:
                "The old UI doesn't use the new one; that keeps components/ deletable.",
            },
          ],
        },
      ],
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
