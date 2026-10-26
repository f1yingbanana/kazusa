import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Instantiate the SDK's generic factory in type space only.
declare const openKeyedStore: OpenClawPluginApi["runtime"]["state"]["openKeyedStore"];

/** Narrow native store contract, also usable by in-memory test stores. */
export type StateStore<T> = Pick<
  ReturnType<typeof openKeyedStore<T>>,
  "lookup" | "register" | "entries"
> & {
  readonly entriesInKeyRange?: (options: {
    readonly keyStartInclusive: string;
    readonly keyEndExclusive: string;
    readonly limit: number;
    readonly order?: "asc" | "desc";
  }) => Promise<Array<{ readonly key: string; readonly value: T }>>;
};

