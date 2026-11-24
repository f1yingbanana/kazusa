export type Need = { id: string; label: string; value: number };

export type Character = {
  id: string;
  name: string;
  reading: string;
  image: string;
  role: string;
  place: string;
  doing: string;
  mood: string;
  awake: boolean;
  wants: string;
  needs: Need[];
  memories: string[];
};

export type Message = {
  id: string;
  from: string;
  text: string;
  time: string;
};

export type Chat = {
  id: string;
  title: string;
  members: string[];
  place: string;
  unread: number;
  messages: Message[];
};

export type EventKind = "move" | "talk" | "thought" | "plan";

export type WorldEvent = {
  id: string;
  kind: EventKind;
  who: string;
  title: string;
  detail: string;
  time: string;
  dateTime: string;
  status?: "complete" | "current" | "upcoming";
};

export const world = {
  day: 14,
  weekday: "Tuesday",
  clock: "16:40",
  weather: "Clear, light wind off the river",
  town: "Shirasagi Ward",
};

export const characters: Character[] = [
  {
    id: "mio",
    name: "Mio Aizawa",
    reading: "あいざわ みお",
    image: "/lab/mio.png",
    role: "Second-year, library committee",
    place: "Kissa Hanamizuki",
    doing: "Waiting for Rin with two melon sodas",
    mood: "Hopeful",
    awake: true,
    wants: "Convince Rin to come to the river festival on Saturday.",
    needs: [
      { id: "energy", label: "Energy", value: 72 },
      { id: "social", label: "Social", value: 38 },
      { id: "fun", label: "Fun", value: 55 },
    ],
    memories: [
      "Rin said she was busy last weekend too.",
      "The festival poster went up at the station on Day 12.",
      "Haru offered to save a spot by the bridge.",
    ],
  },
  {
    id: "rin",
    name: "Rin Takamura",
    reading: "たかむら りん",
    image: "/lab/rin.png",
    role: "Disciplinary committee chair",
    place: "Main building, room 2-B",
    doing: "Finishing patrol reports, running late",
    mood: "Tense",
    awake: true,
    wants: "Clear the report backlog before the inspection on Thursday.",
    needs: [
      { id: "energy", label: "Energy", value: 31 },
      { id: "social", label: "Social", value: 64 },
      { id: "fun", label: "Fun", value: 18 },
    ],
    memories: [
      "Promised Mio she would stop by the café today.",
      "Kotone skipped hall duty again on Day 13.",
      "The inspection was moved up by a week.",
    ],
  },
  {
    id: "yuzuki",
    name: "Yuzuki Sena",
    reading: "せな ゆずき",
    image: "/lab/yuzuki.png",
    role: "Café part-timer",
    place: "Kissa Hanamizuki",
    doing: "Wiping the counter, half asleep",
    mood: "Drowsy",
    awake: true,
    wants: "Go home early and nap before the evening rush.",
    needs: [
      { id: "energy", label: "Energy", value: 12 },
      { id: "social", label: "Social", value: 70 },
      { id: "fun", label: "Fun", value: 46 },
    ],
    memories: [
      "Mio ordered two sodas but is sitting alone.",
      "The owner asked her to stay until seven.",
    ],
  },
  {
    id: "kotone",
    name: "Kotone Hayama",
    reading: "はやま ことね",
    image: "/lab/kotone.png",
    role: "Track team, sprinter",
    place: "Riverside track",
    doing: "Running intervals instead of hall duty",
    mood: "Fired up",
    awake: true,
    wants: "Beat her personal best before the district meet.",
    needs: [
      { id: "energy", label: "Energy", value: 58 },
      { id: "social", label: "Social", value: 49 },
      { id: "fun", label: "Fun", value: 88 },
    ],
    memories: [
      "Rin glared at her in the corridor this morning.",
      "Shaved a tenth off her 200m on Day 11.",
    ],
  },
  {
    id: "aoi",
    name: "Aoi Mizuhara",
    reading: "みずはら あおい",
    image: "/lab/aoi.png",
    role: "Literature club president",
    place: "Old library annex",
    doing: "Rereading a letter she never sent",
    mood: "Wistful",
    awake: true,
    wants: "Decide whether to give the letter to Haru.",
    needs: [
      { id: "energy", label: "Energy", value: 64 },
      { id: "social", label: "Social", value: 22 },
      { id: "fun", label: "Fun", value: 40 },
    ],
    memories: [
      "Haru borrowed her copy of Kokoro and returned it with a note.",
      "Mio asked her to help design the festival flyer.",
    ],
  },
  {
    id: "haru",
    name: "Haru Kirishima",
    reading: "きりしま はる",
    image: "/lab/haru.png",
    role: "Transfer student",
    place: "Sakuragi bridge",
    doing: "Listening to music by the water",
    mood: "Easygoing",
    awake: false,
    wants: "Find a quiet place to watch the fireworks.",
    needs: [
      { id: "energy", label: "Energy", value: 81 },
      { id: "social", label: "Social", value: 52 },
      { id: "fun", label: "Fun", value: 60 },
    ],
    memories: [
      "Aoi seemed nervous when he returned the book.",
      "Promised Mio he would scout the bridge spot.",
    ],
  },
];

export const characterById = Object.fromEntries(
  characters.map((c) => [c.id, c]),
) as Record<string, Character>;

export const chats: Chat[] = [
  {
    id: "cafe",
    title: "Kissa Hanamizuki",
    members: ["mio", "yuzuki", "you"],
    place: "Café, window seat",
    unread: 2,
    messages: [
      { id: "c1", from: "yuzuki", text: "Your second soda is getting warm…", time: "16:21" },
      { id: "c2", from: "mio", text: "She said she'd come! She's just late. Probably.", time: "16:22" },
      { id: "c3", from: "you", text: "Want me to message her?", time: "16:30" },
      { id: "c4", from: "mio", text: "No no, that'd look desperate. Okay maybe one message.", time: "16:31" },
      { id: "c5", from: "yuzuki", text: "I'll put it back in the fridge. For Rin.", time: "16:38" },
    ],
  },
  {
    id: "committee",
    title: "Disciplinary committee",
    members: ["rin", "kotone", "you"],
    place: "Group chat",
    unread: 0,
    messages: [
      { id: "d1", from: "rin", text: "Hayama. Hall duty. Where are you.", time: "15:05" },
      { id: "d2", from: "kotone", text: "Track!! District meet is in nine days!!", time: "15:06" },
      { id: "d3", from: "rin", text: "That is not an answer to the question.", time: "15:06" },
      { id: "d4", from: "kotone", text: "It's a great answer though", time: "15:07" },
    ],
  },
  {
    id: "annex",
    title: "Aoi",
    members: ["aoi", "you"],
    place: "Direct message",
    unread: 1,
    messages: [
      { id: "a1", from: "aoi", text: "Can I ask you something strange?", time: "14:12" },
      { id: "a2", from: "you", text: "Always.", time: "14:15" },
      { id: "a3", from: "aoi", text: "If you wrote something honest to someone, would you rather they read it, or never know?", time: "14:17" },
    ],
  },
  {
    id: "bridge",
    title: "Festival scouting",
    members: ["haru", "mio", "you"],
    place: "Group chat",
    unread: 0,
    messages: [
      { id: "b1", from: "mio", text: "Bridge spot secured?", time: "12:40" },
      { id: "b2", from: "haru", text: "West side. Great view, no crowd. Bring a mat.", time: "12:52" },
    ],
  },
];

export const events: WorldEvent[] = [
  {
    id: "e1",
    kind: "plan",
    who: "mio",
    title: "Mio plans a café date",
    detail: "She wants a calm place to ask Rin about the festival.",
    time: "Day 14 · 13:10",
    dateTime: "2026-11-23T13:10",
    status: "complete",
  },
  {
    id: "e2",
    kind: "talk",
    who: "aoi",
    title: "Aoi asks you a strange question",
    detail: "Something about an honest letter and whether to send it.",
    time: "Day 14 · 14:17",
    dateTime: "2026-11-23T14:17",
    status: "complete",
  },
  {
    id: "e3",
    kind: "move",
    who: "kotone",
    title: "Kotone heads to the riverside track",
    detail: "Hall duty is skipped for the second day in a row.",
    time: "Day 14 · 15:02",
    dateTime: "2026-11-23T15:02",
    status: "complete",
  },
  {
    id: "e4",
    kind: "thought",
    who: "rin",
    title: "Rin realises she's running late",
    detail: "The reports can wait an hour. Mio probably can't.",
    time: "Day 14 · 16:34",
    dateTime: "2026-11-23T16:34",
    status: "current",
  },
  {
    id: "e5",
    kind: "move",
    who: "rin",
    title: "Rin leaves for Kissa Hanamizuki",
    detail: "Expected to arrive around 16:55, out of breath.",
    time: "Day 14 · 16:45",
    dateTime: "2026-11-23T16:45",
    status: "upcoming",
  },
  {
    id: "e6",
    kind: "plan",
    who: "haru",
    title: "Haru meets Mio at the bridge",
    detail: "To walk the festival route before Saturday.",
    time: "Day 14 · 18:30",
    dateTime: "2026-11-23T18:30",
    status: "upcoming",
  },
];

export const eventKinds: { value: EventKind | "all"; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "move", label: "Moves" },
  { value: "talk", label: "Talk" },
  { value: "thought", label: "Thoughts" },
  { value: "plan", label: "Plans" },
];

export const styles = [
  { value: "halo", label: "Halo", blurb: "Airy, rounded, soft sky light" },
  { value: "cel", label: "Cel", blurb: "Flat ink lines, slanted tabs, stickers" },
  { value: "dusk", label: "Dusk", blurb: "Visual-novel night, quiet textboxes" },
] as const;

export const palettes = [
  { value: "sky", label: "Sky" },
  { value: "sakura", label: "Sakura" },
  { value: "matcha", label: "Matcha" },
  { value: "yuuhi", label: "Yuuhi" },
] as const;

export type StyleId = (typeof styles)[number]["value"];
export type PaletteId = (typeof palettes)[number]["value"];
