import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  WIKI_MAX_PICTURE_BYTES,
  WikiCharacterQuerySchema,
  WikiMemoryPayloadSchema,
  WikiRemovePayloadSchema,
  WikiStickersPayloadSchema,
  WikiUploadQuerySchema,
  type WikiBackdropsResponse,
  type WikiCharacterResponse,
} from "@kazusa/client";
import { localAvatarUrl } from "../characters/avatar.ts";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { LOCATION_CONFIG } from "../location/config.ts";
import type { Place } from "../location/map.ts";
import { pictureVersion, readPictures, splitPictureName } from "../pictures.ts";
import {
  backdropUrl,
  backdropsBeside,
  readBackdrops,
} from "../scene/backdrops.ts";
import { SCENE_CONFIG } from "../scene/config.ts";
import { portraitUrl, readPortraits } from "../scene/portraits.ts";
import { declaredOutfits, stickerUrl } from "../stickers/stickers.ts";
import { readCharacterCard, worldWikiDir } from "../characters/card.ts";
import {
  EditConflict,
  pictureType,
  putPicture,
  readText,
  removePicture,
  writeTextOver,
  writeWhole,
} from "./files.ts";

/** A request's bytes, refused past `limit`. */
async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += piece.length;
    if (size > limit) throw new RangeError("too large");
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

const queryOf = (url: string | undefined): Record<string, string> =>
  Object.fromEntries(new URL(url ?? "/", "http://localhost").searchParams);

/** A refusal the person can act on: 400 with the reason. */
class Refusal extends Error {}

type StickersFile = {
  outfits?: Record<string, string>;
  stickers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

/**
 * What the Wiki edits beside pages, for the world's owner: a character's
 * MEMORY.md, looks and stickers, and the world's backdrops. Every path is built
 * from a roster id and names `WikiNameSchema` allows, so nothing reaches
 * outside a workspace or the backdrop library.
 */
export function registerWikiEditor(
  api: OpenClawPluginApi,
  deps: {
    /** The map's places, for which show a backdrop. */
    readonly places: () => ReadonlyMap<string, Place> | undefined;
  },
): void {
  const route = createRouteRegistrar(api);
  const wikiDir = worldWikiDir(api);
  const { times } = SCENE_CONFIG.parse(api.pluginConfig?.scene ?? {});
  const backdropsDir = backdropsBeside(
    LOCATION_CONFIG.parse(api.pluginConfig?.location ?? {}).wikiDir,
  );

  const workspaceOf = (id: string | undefined): string => {
    const config = currentConfig(api);
    if (!id || !listAgentIds(config).includes(id))
      throw new Refusal(`${id ?? "Nobody"} isn't a character in this world.`);
    return api.runtime.agent.resolveAgentWorkspaceDir(config, id);
  };

  const stickersFile = (workspace: string) =>
    path.join(workspace, "stickers", "stickers.json");
  const readStickersFile = (workspace: string): StickersFile => {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(stickersFile(workspace), "utf8"),
      );
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as StickersFile)
        : {};
    } catch {
      return {};
    }
  };

  const character = async (id: string): Promise<WikiCharacterResponse> => {
    const workspace = workspaceOf(id);
    const card = readCharacterCard(wikiDir, id)?.page;
    const outfits = declaredOutfits(workspace);
    const manifest = readStickersFile(workspace);
    const name = card?.name ?? id;
    const avatarUrl = await localAvatarUrl(api, id, currentConfig(api));
    const looks = manifest.stickers ?? {};
    return {
      id,
      name,
      ...(avatarUrl ? { avatarUrl } : {}),
      memory: readText(path.join(workspace, "MEMORY.md")),
      outfits: Object.fromEntries(outfits),
      portraits: [...readPortraits(workspace).portraits.values()].map(
        (portrait) => ({
          name: portrait.name,
          url: portraitUrl(id, portrait),
          ...(portrait.outfit ? { outfit: portrait.outfit } : {}),
          mood: portrait.mood,
        }),
      ),
      stickers: (readPictures(path.join(workspace, "stickers")) ?? []).map(
        (picture) => {
          const { prefix, rest } = splitPictureName(picture.name, outfits);
          const look = looks[picture.name]?.look;
          return {
            name: picture.name,
            url: stickerUrl(id, {
              name: picture.name,
              v: pictureVersion(picture.modified),
            }),
            ...(prefix ? { outfit: prefix } : {}),
            mood: rest,
            ...(typeof look === "string" ? { look } : {}),
          };
        },
      ),
      times: times.map((time) => time.name),
    };
  };

  /** Runs a route's work; a refusal, conflict or bad payload says why. */
  const handle =
    (work: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        await work(req, res);
      } catch (error) {
        if (error instanceof EditConflict)
          sendJson(res, 409, { error: error.message, current: error.current });
        else if (error instanceof Refusal)
          sendJson(res, 400, { error: error.message });
        else if (error instanceof Error && error.name === "ZodError")
          sendJson(res, 400, {
            error: "That isn't something the Wiki can save.",
          });
        else throw error;
      }
    };

  route(
    "wiki/character",
    "GET",
    handle(async (req, res) => {
      const { id } = WikiCharacterQuerySchema.parse(queryOf(req.url));
      sendJson(res, 200, (await character(id)) satisfies WikiCharacterResponse);
    }),
  );

  route(
    "wiki/memory/save",
    "POST",
    handle(async (req, res) => {
      const payload = WikiMemoryPayloadSchema.parse(await readJsonBody(req));
      const file = path.join(workspaceOf(payload.id), "MEMORY.md");
      sendJson(res, 200, writeTextOver(file, payload.text, payload.base));
    }),
  );

  /** Where a picture of this kind goes, and the name it is filed under. */
  const placeOf = (query: {
    readonly kind: string;
    readonly owner?: string | undefined;
    readonly set?: string | undefined;
    readonly name?: string | undefined;
  }): {
    readonly dir: string;
    readonly stem: string;
    readonly scope: string;
  } => {
    const need = <T>(value: T | undefined, what: string): T => {
      if (value === undefined) throw new Refusal(`Say which ${what}.`);
      return value;
    };
    switch (query.kind) {
      case "avatar":
        return {
          dir: workspaceOf(query.owner),
          stem: "avatar",
          scope: need(query.owner, "character"),
        };
      case "portrait":
        return {
          dir: path.join(workspaceOf(query.owner), "portraits"),
          stem: need(query.name, "look"),
          scope: `${need(query.owner, "character")}/portraits`,
        };
      case "sticker":
        return {
          dir: path.join(workspaceOf(query.owner), "stickers"),
          stem: need(query.name, "sticker"),
          scope: `${need(query.owner, "character")}/stickers`,
        };
      case "backdrop": {
        const set = need(query.set, "backdrop set");
        return {
          dir: path.join(backdropsDir, set),
          stem: need(query.name, "time of day"),
          scope: `backdrops/${set}`,
        };
      }
      default:
        throw new Refusal("That isn't a kind of picture.");
    }
  };

  route(
    "wiki/picture",
    "POST",
    handle(async (req, res) => {
      const query = WikiUploadQuerySchema.parse(queryOf(req.url));
      const where = placeOf(query);
      let bytes: Buffer;
      try {
        bytes = await readBytes(req, WIKI_MAX_PICTURE_BYTES);
      } catch {
        throw new Refusal("That picture is larger than 20 MB.");
      }
      const type = pictureType(bytes, req.headers["content-type"]);
      if (!type)
        throw new Refusal(
          "That isn't a picture the Wiki takes: use WebP, PNG, JPEG, GIF or AVIF.",
        );
      const file = putPicture(where.dir, where.stem, bytes, type.ext);
      sendJson(res, 200, { file });
    }),
  );

  route(
    "wiki/picture/remove",
    "POST",
    handle(async (req, res) => {
      const payload = WikiRemovePayloadSchema.parse(await readJsonBody(req));
      const name = payload.kind === "avatar" ? undefined : payload.name;
      const where = placeOf({ ...payload, name });
      const removed = removePicture(where.dir, where.stem);
      if (removed === 0) throw new Refusal("There is no such picture.");
      sendJson(res, 200, { removed });
    }),
  );

  route(
    "wiki/stickers/save",
    "POST",
    handle(async (req, res) => {
      const payload = WikiStickersPayloadSchema.parse(await readJsonBody(req));
      const workspace = workspaceOf(payload.id);
      const manifest = readStickersFile(workspace);
      const outfits = { ...(manifest.outfits ?? {}) };
      for (const [word, worn] of Object.entries(payload.outfits ?? {}))
        if (worn === null) delete outfits[word];
        else outfits[word] = worn;
      const stickers = { ...(manifest.stickers ?? {}) };
      for (const [name, look] of Object.entries(payload.looks ?? {})) {
        const { look: _old, ...rest } = stickers[name] ?? {};
        if (look === null || look === "") {
          if (Object.keys(rest).length) stickers[name] = rest;
          else delete stickers[name];
        } else stickers[name] = { ...rest, look };
      }
      const next: StickersFile = {
        ...manifest,
        ...(Object.keys(outfits).length ? { outfits } : { outfits: undefined }),
        ...(Object.keys(stickers).length
          ? { stickers }
          : { stickers: undefined }),
      };
      writeWhole(stickersFile(workspace), `${JSON.stringify(next, null, 2)}\n`);
      sendJson(res, 200, { ok: true });
    }),
  );

  route(
    "wiki/backdrops",
    "GET",
    handle(async (_req, res) => {
      const places = [...(deps.places()?.values() ?? [])];
      const library = readBackdrops(backdropsDir);
      sendJson(res, 200, {
        sets: [...library.sets].map(([name, set]) => ({
          name,
          files: [...set.files.values()].map((file) => ({
            name: file.name,
            url: backdropUrl(name, file),
            ...(file.state === undefined ? {} : { state: file.state }),
            time: file.time,
          })),
          states: Object.fromEntries(set.states),
          places: places
            .filter((place) => place.backdrop === name)
            .map((place) => ({ id: place.id, name: place.name })),
        })),
        times: times.map((time) => time.name),
      } satisfies WikiBackdropsResponse);
    }),
  );
}
