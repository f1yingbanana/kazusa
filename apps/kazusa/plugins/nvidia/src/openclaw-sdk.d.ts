/**
 * OpenClaw publishes these SDK subpaths without type declarations. Only what
 * this plugin uses is declared, as the shipped JavaScript reads it.
 */

declare module "openclaw/plugin-sdk/provider-catalog-live-runtime" {
  export interface LiveModel {
    readonly id: string;
    readonly name: string;
    readonly reasoning?: boolean;
    readonly input: readonly string[];
    readonly contextWindow?: number;
    readonly maxTokens?: number;
    readonly cost?: {
      readonly input: number;
      readonly output: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
    };
    readonly compat?: Readonly<Record<string, unknown>>;
    readonly params?: Readonly<Record<string, unknown>>;
  }

  export interface LiveProvider {
    readonly baseUrl: string;
    readonly api: string;
    readonly models: readonly LiveModel[];
  }

  /**
   * An OpenAI-compatible `/models` listing as models: rows that can't chat are
   * left out, and a row whose id is in `fallback` keeps that model's metadata.
   */
  export function buildOpenAICompatibleLiveModels(
    rows: readonly unknown[],
    fallback: { readonly models: readonly LiveModel[] },
  ): LiveModel[];

  /** Fetches a JSON listing once per `ttlMs`, shared across callers. */
  export function getCachedLiveProviderModelRows(params: {
    readonly providerId: string;
    readonly endpoint: string;
    readonly timeoutMs?: number;
    readonly ttlMs?: number;
    readonly requireHttps?: boolean;
    readonly policy?: unknown;
    readonly lookupFn?: unknown;
    readonly auditContext?: string;
    readonly readRows: (payload: unknown) => readonly unknown[];
  }): Promise<readonly unknown[]>;
}

declare module "openclaw/plugin-sdk/provider-entry" {
  import type {
    LiveModel,
    LiveProvider,
  } from "openclaw/plugin-sdk/provider-catalog-live-runtime";

  export function defineSingleProviderPluginEntry(entry: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly manifest: unknown;
    readonly provider: {
      /** Defaults to the plugin's id. */
      readonly id?: string;
      readonly label: string;
      readonly docsPath?: string;
      readonly preserveLiteralProviderPrefix?: boolean;
      readonly catalog: {
        readonly discoveryMode: "strict";
        readonly buildProvider: () => LiveProvider | Promise<LiveProvider>;
        readonly buildStaticProvider: () => LiveProvider;
        readonly liveModelDiscovery: {
          readonly projectRows: (
            rows: readonly unknown[],
            fallback: LiveProvider,
          ) => LiveModel[];
        };
      };
    };
  }): unknown;
}
