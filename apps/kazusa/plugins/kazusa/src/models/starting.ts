import type { ModelOption } from "@kazusa/client";
import type { StateStore } from "../state.ts";
import { preferred, type ModelsConfig } from "./config.ts";
import type { ModelSelection } from "./selection.ts";

/**
 * The best chat model (`config.chat`) that a provider with a working key
 * serves, as a ref.
 */
export function startingModel(
  models: readonly ModelOption[],
  config: ModelsConfig,
): string | undefined {
  return preferred(
    models.filter((model) => model.available),
    config.chat,
    config.providers,
    (model) => model,
  )?.ref;
}

export interface StartingModel {
  /** The stored starting model; waits for one being worked out at start. */
  readonly current: () => Promise<string | undefined>;
  /** Works it out again from a catalog and stores it. */
  readonly update: (
    models: readonly ModelOption[],
  ) => Promise<string | undefined>;
  /**
   * Works it out from a catalog still being fetched, e.g. at start; turns wait
   * for it.
   */
  readonly updateFrom: (
    models: Promise<readonly ModelOption[]>,
  ) => Promise<string | undefined>;
}

const STARTING_KEY = "starting";
// Plugin registrations share one pending start-up lookup.
const PENDING = Symbol.for("kazusa.models.startingPending");
const pending = globalThis as { [PENDING]?: Promise<unknown> };

/**
 * The world's starting model, kept beside the picks in Kazusa's `"models"`
 * store so a turn never waits on the catalog. It follows keys: it is worked out
 * again at Gateway start and from each world catalog read, which Settings does
 * after every key saved or removed.
 */
export function createStartingModel(
  store: StateStore<ModelSelection>,
  config: ModelsConfig,
): StartingModel {
  const update = async (
    models: readonly ModelOption[],
  ): Promise<string | undefined> => {
    // No models at all is a catalog not ready yet, not a world without keys.
    if (!models.length) return (await store.lookup(STARTING_KEY))?.model;
    const ref = startingModel(models, config);
    if ((await store.lookup(STARTING_KEY))?.model !== ref)
      await store.register(STARTING_KEY, ref ? { model: ref } : {});
    return ref;
  };
  return {
    current: async () => {
      await pending[PENDING]?.catch(() => undefined);
      return (await store.lookup(STARTING_KEY))?.model;
    },
    update,
    updateFrom: (models) => {
      const work = models.then(update);
      pending[PENDING] = work;
      return work.finally(() => {
        if (pending[PENDING] === work) delete pending[PENDING];
      });
    },
  };
}
