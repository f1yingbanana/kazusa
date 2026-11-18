import { z } from "zod";

/** What a wiki page is about, which also picks its folder. */
export const WikiKindSchema = z.enum(["person", "concept", "day"]);
export type WikiKind = z.infer<typeof WikiKindSchema>;

/*
 * What the Wiki edits beside pages: a character's MEMORY.md, looks and
 * stickers, and the world's backdrops. A text is saved over the version it was
 * read at (`base`), so a night's sleep written meanwhile is never lost.
 */

/** A picture's or set's name: lowercase words joined by `-`. */
export const WikiNameSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

/** A text file as read: its words and a hash of them, `null` while missing. */
export const EditedTextSchema = z.object({
  text: z.string(),
  hash: z.string().nullable(),
});
export type EditedText = z.infer<typeof EditedTextSchema>;

/** A look (`[<outfit>-]<mood>`), as the portrait and sticker share. */
export const WikiPictureSchema = z.object({
  name: WikiNameSchema,
  url: z.string(),
  /** The outfit's word, when the name starts with a declared one. */
  outfit: z.string().optional(),
  /** The rest of the name. */
  mood: z.string(),
});
export type WikiPicture = z.infer<typeof WikiPictureSchema>;

export const WikiStickerSchema = WikiPictureSchema.extend({
  /** What it shows, mood first, as `stickers.json` says. */
  look: z.string().optional(),
});
export type WikiSticker = z.infer<typeof WikiStickerSchema>;

/**
 * A page's id, and so its file name: lowercase letters, digits, `_` and `-`,
 * the same for characters, places and every other page.
 */
export const WikiIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, digits, _ or -.")
  .max(128);

export const WikiCharacterQuerySchema = z.object({ id: z.string().min(1) });

/** `GET /kazusa/wiki/character?id=`: what a character has beside their page. */
export const WikiCharacterResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  /** MEMORY.md: what they keep in mind, rewritten by each night's sleep. */
  memory: EditedTextSchema,
  /** Outfit word → what is worn, as `stickers.json` declares them. */
  outfits: z.record(z.string(), z.string()),
  portraits: z.array(WikiPictureSchema),
  stickers: z.array(WikiStickerSchema),
  /** The world's times of day. */
  times: z.array(z.string()),
});
export type WikiCharacterResponse = z.infer<typeof WikiCharacterResponseSchema>;

/** Saves MEMORY.md over the version read. */
export const WikiMemoryPayloadSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  base: z.string().nullable(),
});
export type WikiMemoryPayload = z.infer<typeof WikiMemoryPayloadSchema>;

/** What a picture is: where it goes and how it is named. */
export const WikiPictureKindSchema = z.enum([
  "avatar",
  "portrait",
  "sticker",
  "backdrop",
]);
export type WikiPictureKind = z.infer<typeof WikiPictureKindSchema>;

/**
 * `POST /kazusa/wiki/picture?…` with the picture's bytes as the body and its
 * type as `Content-Type`. `owner` is the character (not for a backdrop), `set`
 * the backdrop set, `name` the picture's name without its extension (not for an
 * avatar).
 */
export const WikiUploadQuerySchema = z.object({
  kind: WikiPictureKindSchema,
  owner: z.string().min(1).optional(),
  set: WikiNameSchema.optional(),
  name: WikiNameSchema.optional(),
});
export type WikiUploadQuery = z.infer<typeof WikiUploadQuerySchema>;

/** Pictures the Wiki takes: raster only, never SVG. */
export const WIKI_PICTURE_TYPES = [
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/avif",
] as const;

/** At most this many bytes a picture. */
export const WIKI_MAX_PICTURE_BYTES = 20 * 1024 * 1024;

/** Deletes a picture for good. */
export const WikiRemovePayloadSchema = z.object({
  kind: WikiPictureKindSchema,
  owner: z.string().min(1).optional(),
  set: WikiNameSchema.optional(),
  name: WikiNameSchema.optional(),
});
export type WikiRemovePayload = z.infer<typeof WikiRemovePayloadSchema>;

/** Changes to `stickers.json`: outfits and looks; `null` drops one. */
export const WikiStickersPayloadSchema = z.object({
  id: z.string().min(1),
  outfits: z
    .record(WikiNameSchema, z.string().trim().min(1).max(500).nullable())
    .optional(),
  looks: z
    .record(WikiNameSchema, z.string().trim().max(500).nullable())
    .optional(),
});
export type WikiStickersPayload = z.infer<typeof WikiStickersPayloadSchema>;

export const WikiBackdropSetSchema = z.object({
  name: WikiNameSchema,
  files: z.array(
    z.object({
      name: WikiNameSchema,
      url: z.string(),
      state: z.string().optional(),
      time: z.string(),
    }),
  ),
  /** State word → what it means, as `backdrops.json` declares them. */
  states: z.record(z.string(), z.string()),
  /** The places that show it. */
  places: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type WikiBackdropSet = z.infer<typeof WikiBackdropSetSchema>;

/** `GET /kazusa/wiki/backdrops`: the library places choose from. */
export const WikiBackdropsResponseSchema = z.object({
  sets: z.array(WikiBackdropSetSchema),
  times: z.array(z.string()),
});
export type WikiBackdropsResponse = z.infer<typeof WikiBackdropsResponseSchema>;

/** How well a group knows a page. */
export const WikiLevelSchema = z.enum(["heard of", "knows", "close"]);
export type WikiLevel = z.infer<typeof WikiLevelSchema>;

/** One group that knows a page; `everyone` is every character. */
export const WikiGroupSchema = z.object({
  ref: z.string(),
  level: WikiLevelSchema,
});
export type WikiGroup = z.infer<typeof WikiGroupSchema>;

/** A character in a group, and how closely. */
export const WikiMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** How involved: an associate (`heard of`), a member, a close member. */
  level: z.enum(["heard of", "knows", "close"]),
});
export type WikiMember = z.infer<typeof WikiMemberSchema>;

/** The front matter fields Kazusa reads, as the Wiki's form edits them. */
export const WikiPageFormFieldsSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()),
  /** What anyone who has heard of it knows: one line. */
  summary: z.string().optional(),
  /**
   * Who knows it: each group (`everyone` for all) and how well. A person is in
   * every group that knows them or is close to them.
   */
  groups: z.array(WikiGroupSchema),
  /** On a character's page: the groups they are in, and how involved. */
  in: z.array(WikiGroupSchema).optional(),
  /** A person's home place. */
  home: z.string().optional(),
  /** The place or group it sits in. */
  parent: z.string().optional(),
  /** Components of a concept: something people are in, a place. */
  group: z.boolean().optional(),
  place: z.boolean().optional(),
  /** A place's backdrop set. */
  backdrop: z.string().optional(),
  /** A place's walk, in minutes, from the area it is in. */
  entryMinutes: z.number().min(0).optional(),
  /** A place's routes to others, each with its ways, the usual first. */
  connections: z
    .array(
      z.object({
        to: z.string(),
        ways: z.array(z.object({ by: z.string(), minutes: z.number().min(0) })),
        note: z.string().optional(),
      }),
    )
    .optional(),
  /** On a character's own page about someone: who they are to them. */
  relation: z.string().optional(),
});
export type WikiPageFormFields = z.infer<typeof WikiPageFormFieldsSchema>;

/** `GET /kazusa/wiki/form?id=&agent=&kind=`: a page split for the form. */
export const WikiPageFormSchema = z.object({
  id: z.string(),
  kind: WikiKindSchema,
  exists: z.boolean(),
  hash: z.string().nullable(),
  fields: WikiPageFormFieldsSchema,
  /** Fields Kazusa reads but sets elsewhere (the map, sleep): kept as they are. */
  kept: z.array(z.string()),
  /** Fields Kazusa doesn't read: they belong in the text. */
  other: z.array(z.object({ key: z.string(), value: z.string() })),
  /** The opening: what anyone who knows it knows. */
  lead: z.string(),
  /**
   * What those close to it know, as Markdown: a `## Title` line starts each
   * topic, and a topic comes up when the conversation touches it.
   */
  close: z.string(),
  /** On a character's own page, what only they know, the same way. */
  only: z.string(),
  /** For a group: the characters in it, from their pages' `in`. */
  members: z.array(WikiMemberSchema).optional(),
});
export type WikiPageForm = z.infer<typeof WikiPageFormSchema>;

/** `POST /kazusa/wiki/form/save`: the form back as a page, over `base`. */
export const WikiPageFormSavePayloadSchema = z.object({
  id: WikiIdSchema,
  agent: z.string().min(1).optional(),
  kind: WikiKindSchema.optional(),
  base: z.string().nullable(),
  fields: WikiPageFormFieldsSchema,
  lead: z.string(),
  close: z.string(),
  only: z.string(),
  /** For a group: who is in it, written to each character's `in`. */
  members: z
    .array(
      z.object({
        id: z.string(),
        level: z.enum(["heard of", "knows", "close"]),
      }),
    )
    .max(2000)
    .optional(),
  /** Move the fields Kazusa doesn't read into a Details section. */
  moveOther: z.boolean().optional(),
});
export type WikiPageFormSavePayload = z.infer<
  typeof WikiPageFormSavePayloadSchema
>;

const WikiPersonSchema = z.object({ id: z.string(), name: z.string() });

/**
 * `GET /kazusa/wiki/reach?id=`: who in the cast knows a page how well, as the
 * page now stands. A character's own page isn't counted for them.
 */
export const WikiReachResponseSchema = z.object({
  /** Know it well: they get its sections when one comes up. */
  well: z.array(WikiPersonSchema),
  /** Know it: they get its opening. */
  knows: z.array(WikiPersonSchema),
  /** Have heard of it: they get its summary line. */
  heard: z.array(WikiPersonSchema),
  /** How many know nothing of it. */
  none: z.number(),
  /** For a group: who in the cast is in it. */
  members: z.array(WikiPersonSchema),
});
export type WikiReachResponse = z.infer<typeof WikiReachResponseSchema>;
