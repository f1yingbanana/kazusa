// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useQueryState, useQueryStates, parseAsString } from "nuqs";
import {
  withNuqsTestingAdapter,
  type UrlUpdateEvent,
} from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSelection } from "./use-selection";
import { entityRefParser } from "../lib/state/entity-ref";
import { openChatPatch } from "../lib/source/chats/display";
import { chatsParsers } from "../components/views/chats/search-params";
import { timelineParsers } from "../components/views/timeline/search-params";
import { worldParsers } from "../components/views/world/search-params";
import { wikiParsers } from "../components/views/wiki/search-params";

afterEach(cleanup);

describe("feature-owned query state", () => {
  it("opens a chat and its typed inspector selection in one shallow history update", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result } = renderHook(
      () => ({
        chat: useQueryStates({
          view: parseAsString,
          ...chatsParsers,
          sel: entityRefParser,
        }),
        inspector: useSelection(),
      }),
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?view=world&world.in=watch&external=keep",
          defaultOptions: { history: "push", shallow: true, scroll: false },
          onUrlUpdate,
          hasMemory: true,
        }),
      },
    );
    await act(async () => {
      await result.current.chat[1](
        openChatPatch(
          {
            id: "group:club",
            name: "Club",
            type: "group",
            members: ["user:me", "alice", "bob"],
          },
          "user:me",
        ),
      );
    });
    expect(result.current.inspector[0]).toEqual({
      kind: "chat",
      id: "group:club",
    });
    expect(onUrlUpdate).toHaveBeenCalledOnce();
    const event = onUrlUpdate.mock.calls[0]?.[0];
    expect(event?.searchParams.get("sel")).toBe("chat:group:club");
    expect(event?.searchParams.get("chats.id")).toBe("group:club");
    expect(event?.searchParams.get("world.in")).toBe("watch");
    expect(event?.options).toMatchObject({
      history: "push",
      shallow: true,
      scroll: false,
    });

    await act(async () => {
      await result.current.inspector[1]({ kind: "character", id: "user:you" });
    });
    expect(result.current.chat[0].sel).toEqual({
      kind: "character",
      id: "user:you",
    });
  });

  it("parses existing timeline links, batches separate hooks, and clears only their keys", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result } = renderHook(
      () => ({
        timeline: useQueryStates(timelineParsers),
        view: useQueryState("view", parseAsString),
      }),
      {
        wrapper: withNuqsTestingAdapter({
          searchParams:
            "?view=world&tl.actors=alice,bob&tl.watch=1&tl.kinds=task.started,invalid&wiki.page=home",
          onUrlUpdate,
          hasMemory: true,
        }),
      },
    );
    expect(result.current.timeline[0]).toEqual({
      "tl.actors": ["alice", "bob"],
      "tl.watch": true,
      "tl.kinds": ["task.started"],
    });
    await act(async () => {
      const viewUpdate = result.current.view[1]("timeline", {
        history: "replace",
      });
      const filtersUpdate = result.current.timeline[1](
        { "tl.actors": ["user:you"], "tl.watch": false },
        { history: "replace" },
      );
      await Promise.all([viewUpdate, filtersUpdate]);
    });
    expect(onUrlUpdate).toHaveBeenCalledOnce();
    expect(onUrlUpdate.mock.calls[0]?.[0].options.history).toBe("replace");
    await act(async () => {
      await result.current.timeline[1](null);
    });
    const search = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams;
    expect(search?.has("tl.actors")).toBe(false);
    expect(search?.has("tl.watch")).toBe(false);
    expect(search?.has("tl.kinds")).toBe(false);
    expect(search?.get("wiki.page")).toBe("home");
    expect(search?.get("view")).toBe("timeline");
  });

  it("rejects invalid selection, world, and wiki values at the query boundary", () => {
    const { result } = renderHook(
      () => ({
        selection: useSelection()[0],
        world: useQueryStates(worldParsers)[0],
        wiki: useQueryStates(wikiParsers)[0],
      }),
      {
        wrapper: withNuqsTestingAdapter({
          searchParams:
            "?sel=unknown:alice&world.by=invalid&world.kind=toString&world.as=invalid&wiki.kind=invalid&wiki.edit=invalid&wiki.tab=invalid",
        }),
      },
    );
    expect(result.current.selection).toBeNull();
    expect(result.current.world["world.by"]).toBeNull();
    expect(result.current.world["world.kind"]).toBeNull();
    expect(result.current.world["world.as"]).toBeNull();
    expect(result.current.wiki["wiki.kind"]).toBeNull();
    expect(result.current.wiki["wiki.edit"]).toBeNull();
    expect(result.current.wiki["wiki.tab"]).toBeNull();
  });
});
