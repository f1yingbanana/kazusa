/**
 * The retrieval evaluation: 104 cases over worlds.ts. `category` says what a
 * case exercises; `semantic` cases need real embeddings and are run by
 * `scripts/memory-eval.ts --fixtures --embed`, not by the unit test.
 */
export interface RetrievalCase {
  readonly world: "saltmere" | "northwind" | "kepler";
  readonly category: string;
  readonly name: string;
  readonly agent: string;
  /** Who says it: [display name, id]. Omitted with `prompt`. */
  readonly from?: readonly [string, string];
  readonly text?: string;
  /** A whole delivery, when the shape of the delivery is the point. */
  readonly prompt?: string;
  readonly task?: string;
  readonly here?: readonly string[];
  readonly awaiting?: readonly string[];
  readonly semantic?: boolean;
  /** Must come up. */
  readonly expect?: readonly string[];
  /** Must not come up. */
  readonly forbid?: readonly string[];
  readonly first?: string;
  readonly depth?: Readonly<Record<string, string>>;
  /** Must appear in what the character reads. */
  readonly shows?: readonly string[];
  /** Must not appear in what the character reads. */
  readonly hides?: readonly string[];
  /** At most this many full entries. */
  readonly maxFull?: number;
}

const ALEX = ["Alex", "user:alex"] as const;
const JUN = ["Jun Hoshi", "jun-hoshi"] as const;
const REN = ["Ren Adeyemi", "ren-adeyemi"] as const;
const salt = (
  category: string,
  name: string,
  agent: string,
  text: string,
  rest: Partial<RetrievalCase> = {},
): RetrievalCase => ({
  world: "saltmere",
  category,
  name,
  agent,
  from: JUN,
  text,
  ...rest,
});
const north = (
  category: string,
  name: string,
  agent: string,
  text: string,
  rest: Partial<RetrievalCase> = {},
): RetrievalCase => ({
  world: "northwind",
  category,
  name,
  agent,
  from: ALEX,
  text,
  ...rest,
});
const ship = (
  category: string,
  name: string,
  agent: string,
  text: string,
  rest: Partial<RetrievalCase> = {},
): RetrievalCase => ({
  world: "kepler",
  category,
  name,
  agent,
  from: REN,
  text,
  ...rest,
});

const MARA = "mara-vell";
const PRIYA = "priya-nair";

export const CASES: readonly RetrievalCase[] = [
  // Recognition: who is in front of them comes first, unasked.
  salt(
    "recognition",
    "sender with a page, no name in the text",
    MARA,
    "are you eating properly?",
    {
      from: ["Tobin Vell", "tobin-vell"],
      first: "tobin-vell",
      shows: ["still check he has eaten"],
    },
  ),
  north("recognition", "the player, by chat id", PRIYA, "got a minute?", {
    first: "alex",
    shows: ["`user:alex`"],
  }),
  salt(
    "recognition",
    "sender with no personal page, same ward",
    MARA,
    "nice weather",
    {
      from: ["Bram Stokes", "bram-stokes"],
      depth: { "bram-stokes": "familiar" },
    },
  ),
  salt("recognition", "their guess about the sender shows", MARA, "hello", {
    from: ["Tobin Vell", "tobin-vell"],
    shows: ["You guess they think: Thinks I look down on him"],
  }),
  salt("recognition", "open threads with the sender show", MARA, "hello", {
    from: ["Tobin Vell", "tobin-vell"],
    shows: ["rent for February"],
  }),
  salt("recognition", "newest notes show, older do not", MARA, "hello", {
    from: ["Tobin Vell", "tobin-vell"],
    shows: ["Oswin shouted", "ten coppers"],
    hides: ["name day"],
  }),
  north("recognition", "person present, silent", PRIYA, "the build is red", {
    here: ["dan-okafor"],
    expect: ["dan-okafor"],
  }),
  salt(
    "recognition",
    "a stranger in front of them shows their lead",
    "hope-marrow",
    "excuse me",
    {
      from: ["Eloise", "eloise-becu"],
      here: ["oswin-hale"],
      expect: ["oswin-hale"],
      shows: ["anchor tattoo"],
      depth: { "oswin-hale": "familiar" },
    },
  ),
  salt("recognition", "two senders both come up", MARA, "", {
    prompt:
      "[Tue 2026-03-10 12:01]\n- [Tobin Vell `tobin-vell` Tue 2026-03-10 12:00] (chat:direct:tobin-vell): hey\n- [Ilse Dray `ilse-dray` Tue 2026-03-10 12:01] (chat:direct:ilse-dray): hello",
    expect: ["tobin-vell", "ilse-dray"],
  }),
  north(
    "recognition",
    "those owed a reply stay behind the speaker",
    PRIYA,
    "quick question",
    { awaiting: ["lena-fischer", "dan-okafor"], first: "alex" },
  ),

  // Names: how people actually refer to one another.
  salt("names", "full name", MARA, "have you spoken with Oswin Hale?", {
    expect: ["oswin-hale"],
  }),
  salt("names", "first name", MARA, "where is Ilse?", {
    expect: ["ilse-dray"],
  }),
  salt("names", "family name", MARA, "Stokes looks rich lately", {
    expect: ["bram-stokes"],
  }),
  salt(
    "names",
    "their own nickname for someone",
    MARA,
    "Old Anchor was asking about you",
    { expect: ["oswin-hale"] },
  ),
  north(
    "names",
    "a nickname only their page has",
    PRIYA,
    "the Headset just promised another feature",
    { expect: ["lena-fischer"] },
  ),
  salt(
    "names",
    "a shared family name brings up both",
    "ilse-dray",
    "the Vell family owes the guild",
    { expect: ["mara-vell", "tobin-vell"] },
  ),
  salt(
    "names",
    "accented name written with accents",
    "hope-marrow",
    "Éloise wants the ledger",
    { expect: ["eloise-becu"] },
  ),
  salt("names", "non-Latin name", MARA, "星 淳 came by the docks", {
    expect: ["jun-hoshi"],
    from: ["Ilse Dray", "ilse-dray"],
  }),
  north("names", "non-Latin colleague", PRIYA, "张伟 pushed to main", {
    expect: ["wei-zhang"],
  }),
  north("names", "a place alias", PRIYA, "are you at HQ?", {
    expect: ["office_hq"],
  }),
  north("names", "a project alias", PRIYA, "how is Atlas going?", {
    expect: ["project_atlas"],
  }),
  salt("names", "a multi-word alias", MARA, "does the Lamp Guild know?", {
    expect: ["lamplighters"],
  }),

  // Depth: what they would know decides how much comes up.
  salt("depth", "own guild: intimate", MARA, "tell me about the Lamplighters", {
    depth: { lamplighters: "intimate" },
    expect: ["lamplighters"],
  }),
  salt(
    "depth",
    "another guild in their ward: familiar",
    MARA,
    "what do the Harbor Watch do?",
    {
      depth: { harbor_watch: "familiar" },
      shows: ["Blue coats"],
      hides: ["north pier"],
    },
  ),
  salt(
    "depth",
    "another ward's guild: heard of",
    MARA,
    "what about the Apothecaries?",
    {
      depth: { apothecaries: "heard of" },
      shows: ["only heard of it"],
      hides: ["green-doored"],
    },
  ),
  salt(
    "depth",
    "local to another guild: unknown",
    "hope-marrow",
    "what is the Lamp Oath?",
    { forbid: ["lamp_oath"] },
  ),
  salt(
    "depth",
    "local to their own guild: known",
    MARA,
    "what does the Lamp Oath say?",
    { expect: ["lamp_oath"], depth: { lamp_oath: "intimate" } },
  ),
  salt(
    "depth",
    "famous everywhere",
    "hope-marrow",
    "tell me about the Founding of Saltmere",
    {
      expect: ["founding_of_saltmere"],
      depth: { founding_of_saltmere: "familiar" },
    },
  ),
  salt(
    "depth",
    "a famous person, known to all",
    "ilse-dray",
    "what is Alaric Voss like?",
    { expect: ["alaric-voss"], depth: { "alaric-voss": "familiar" } },
  ),
  salt(
    "depth",
    "an obscure person elsewhere: unknown",
    "hope-marrow",
    "do you know Ilse Dray?",
    { forbid: ["ilse-dray"], from: ["Éloise Bécu", "eloise-becu"] },
  ),
  salt(
    "depth",
    "another ward's room: unknown",
    MARA,
    "is Apothecary Row open?",
    { forbid: ["apothecary_row"] },
  ),
  salt(
    "depth",
    "beside their home: intimate",
    MARA,
    "anyone at the Watch House?",
    { expect: ["watch_house"], depth: { watch_house: "intimate" } },
  ),
  north(
    "depth",
    "another team's page: familiar lead, no inner detail",
    PRIYA,
    "how is the Sales Team?",
    { depth: { sales_team: "familiar" }, hides: ["Meridian Freight"] },
  ),
  north(
    "depth",
    "another team's project: unknown",
    "lena-fischer",
    "what is Project Atlas?",
    { forbid: ["project_atlas"] },
  ),
  north(
    "depth",
    "a competitor is heard of",
    "mark-silva",
    "is Helix Labs hiring?",
    { expect: ["helix_labs"], depth: { helix_labs: "heard of" } },
  ),
  ship(
    "depth",
    "`knows` gives more than the deck",
    "cass-holloway",
    "any coolant trouble at the reactor core?",
    { depth: { reactor_core: "intimate" }, shows: ["falsified"] },
  ),
  ship(
    "depth",
    "without `knows`, the deck's depth",
    "ren-adeyemi",
    "any trouble at the Reactor Core?",
    {
      from: ["Cass Holloway", "cass-holloway"],
      depth: { reactor_core: "familiar" },
      hides: ["falsified"],
    },
  ),
  ship(
    "depth",
    "the other deck's place is unknown",
    "ren-adeyemi",
    "ever been to the Arboretum?",
    { from: ["Cass Holloway", "cass-holloway"], forbid: ["arboretum"] },
  ),

  // Exclusive knowledge.
  north(
    "exclusive",
    "a `Known by:` section reaches its reader",
    PRIYA,
    "what is the Atlas rollback plan?",
    { shows: ["restore last month's snapshot"] },
  ),
  north(
    "exclusive",
    "and only them",
    "dan-okafor",
    "what is the Atlas rollback plan?",
    {
      from: ["Priya Nair", "priya-nair"],
      expect: ["project_atlas"],
      hides: ["restore last month's snapshot"],
    },
  ),
  north(
    "exclusive",
    "a `known_by` page reaches its reader",
    "grace-kim",
    "where are we on the Layoffs Plan?",
    { expect: ["layoffs_plan"], depth: { layoffs_plan: "intimate" } },
  ),
  north(
    "exclusive",
    "and nobody else, named outright",
    PRIYA,
    "have you heard about the Layoffs Plan?",
    { forbid: ["layoffs_plan"] },
  ),
  north(
    "exclusive",
    "and nobody else, by its words",
    PRIYA,
    "will they cut a fifth of staff after the fiscal close?",
    { forbid: ["layoffs_plan"] },
  ),
  salt(
    "exclusive",
    "`knows` reaches a secret page",
    "bram-stokes",
    "how is the Undertow doing?",
    { from: ["Mara Vell", "mara-vell"], expect: ["smuggling_ring"] },
  ),
  salt(
    "exclusive",
    "a secret place by its words, outsider",
    MARA,
    "crates on stilts above black water",
    { forbid: ["drowned_cellar"] },
  ),
  salt(
    "exclusive",
    "a section for one person, by its words",
    "hope-marrow",
    "will the Regent remove the seventh seat?",
    { hides: ["means to remove"] },
  ),

  // Private places.
  north("private", "their own home", "grace-kim", "is your office free?", {
    from: ["Priya Nair", "priya-nair"],
    here: ["grace_office"],
    depth: { grace_office: "intimate" },
  }),
  north(
    "private",
    "someone else's office",
    PRIYA,
    "have you seen Grace's Office?",
    { forbid: ["grace_office"] },
  ),
  salt("private", "someone else's room", "tobin-vell", "how is Mara's Loft?", {
    from: ["Ilse Dray", "ilse-dray"],
    forbid: ["mara_loft"],
  }),
  salt("private", "their own room", MARA, "is Mara's Loft still leaking?", {
    expect: ["mara_loft"],
    depth: { mara_loft: "intimate" },
  }),
  salt("private", "standing in it is contact", "tobin-vell", "nice place", {
    from: ["Mara Vell", "mara-vell"],
    here: ["mara_loft"],
    depth: { mara_loft: "familiar" },
  }),

  // Beliefs: personal views stand, wrong or not, and stay private.
  salt(
    "beliefs",
    "their view leads over canon",
    MARA,
    "what do you make of the Tide Tax?",
    { shows: ["racket"], hides: ["on each spring tide"] },
  ),
  salt(
    "beliefs",
    "hearsay keeps its source and hedge",
    MARA,
    "where does the Tide Tax money go?",
    { shows: ["Jun Hoshi told you", "(suspect)"] },
  ),
  salt(
    "beliefs",
    "the same person, two different minds",
    "tobin-vell",
    "how is Oswin Hale?",
    {
      from: ["Mara Vell", "mara-vell"],
      shows: ["covers for his men"],
      hides: ["bully"],
    },
  ),
  salt(
    "beliefs",
    "the other side of the same pair",
    MARA,
    "how is Oswin Hale?",
    { shows: ["bully"], hides: ["covers for his men"] },
  ),
  salt(
    "beliefs",
    "another character's page is never read, by name",
    "hope-marrow",
    "my own night ledger",
    { forbid: ["night_ledger"] },
  ),
  salt(
    "beliefs",
    "another character's page, by its words",
    "tobin-vell",
    "every lamp that fails and who was on the round",
    { forbid: ["night_ledger"] },
  ),
  salt("beliefs", "guesses differ between siblings", "tobin-vell", "hi", {
    from: ["Mara Vell", "mara-vell"],
    shows: ["Thinks I sold out"],
    hides: ["look down on him"],
  }),
  north(
    "beliefs",
    "a personal view of a rival",
    PRIYA,
    "would you ever go to Helix Labs?",
    { shows: ["turned down their offer"], hides: ["poached"] },
  ),

  // Topics: words their own memory shares with the message.
  salt(
    "topics",
    "a personal page by content",
    MARA,
    "who has been stealing the oil?",
    { expect: ["night_ledger"] },
  ),
  salt(
    "topics",
    "a personal note by content",
    MARA,
    "does anyone take bribes around here?",
    { expect: ["oswin-hale"], shows: ["bribes"] },
  ),
  north(
    "topics",
    "a bullet deep in a section",
    PRIYA,
    "should we drain the canary first?",
    { expect: ["deploy_checklist"], shows: ["Drain the canary"] },
  ),
  north(
    "topics",
    "a plural against a singular",
    PRIYA,
    "any database migrations pending?",
    { expect: ["deploy_checklist"] },
  ),
  north(
    "topics",
    "their own notes on a customer",
    "lena-fischer",
    "what does Meridian procurement care about?",
    { expect: ["meridian_notes"] },
  ),
  salt(
    "topics",
    "their own recipe",
    "hope-marrow",
    "got anything for joint pain?",
    { from: ["Éloise Bécu", "eloise-becu"], expect: ["willow_bark_remedy"] },
  ),
  salt(
    "topics",
    "public knowledge by its words",
    "ilse-dray",
    "what is that bell people hear under the bay?",
    { expect: ["drowned_bell"] },
  ),
  north(
    "topics",
    "company knowledge by its words",
    "dan-okafor",
    "do I need receipts for travel?",
    { from: ["Priya Nair", "priya-nair"], expect: ["expense_policy"] },
  ),
  ship(
    "topics",
    "ship knowledge by its words",
    "oona-pryce",
    "how much water do citizens get?",
    { expect: ["water_ration"] },
  ),
  salt(
    "topics",
    "a day remembered",
    MARA,
    "why were you arguing about the coat?",
    { expect: ["2026-03-09"] },
  ),

  // Paraphrase: no words in common; only embeddings can find these.
  salt(
    "paraphrase",
    "theft in other words",
    MARA,
    "someone is pilfering fuel from the street lights",
    { semantic: true, expect: ["night_ledger"] },
  ),
  salt(
    "paraphrase",
    "corruption in other words",
    MARA,
    "is that sergeant crooked?",
    {
      semantic: true,
      from: ["Ilse Dray", "ilse-dray"],
      expect: ["oswin-hale"],
    },
  ),
  salt(
    "paraphrase",
    "an illness in other words",
    "hope-marrow",
    "sailors keep coming in shivering and drenched",
    {
      semantic: true,
      from: ["Éloise Bécu", "eloise-becu"],
      expect: ["black_tide_fever"],
    },
  ),
  salt(
    "paraphrase",
    "a remedy in other words",
    "hope-marrow",
    "my knees ache every morning, any tonic?",
    {
      semantic: true,
      from: ["Éloise Bécu", "eloise-becu"],
      expect: ["willow_bark_remedy"],
    },
  ),
  salt(
    "paraphrase",
    "a legend in other words",
    MARA,
    "they say something tolls beneath the waves",
    { semantic: true, expect: ["drowned_bell"] },
  ),
  north(
    "paraphrase",
    "shipping code in other words",
    PRIYA,
    "anything I must do before we push to production?",
    { semantic: true, expect: ["deploy_checklist"] },
  ),
  north(
    "paraphrase",
    "a promotion in other words",
    PRIYA,
    "still hoping to move up a level this year?",
    { semantic: true, expect: ["alex"] },
  ),
  north(
    "paraphrase",
    "reimbursement in other words",
    "dan-okafor",
    "how do I get my plane ticket paid back?",
    {
      semantic: true,
      from: ["Priya Nair", "priya-nair"],
      expect: ["expense_policy"],
    },
  ),
  north(
    "paraphrase",
    "a client in other words",
    "lena-fischer",
    "their buyer likes to talk about his handicap",
    { semantic: true, expect: ["meridian_notes"] },
  ),
  ship(
    "paraphrase",
    "power plant in other words",
    "ren-adeyemi",
    "what keeps the lights on around here?",
    {
      semantic: true,
      from: ["Cass Holloway", "cass-holloway"],
      expect: ["reactor_core"],
    },
  ),
  ship(
    "paraphrase",
    "an uprising in other words",
    "oona-pryce",
    "are the crew planning to overthrow the bridge?",
    { semantic: true, expect: ["mutiny_rumor"] },
  ),
  ship(
    "paraphrase",
    "a paraphrase cannot reach a secret",
    "ren-adeyemi",
    "those maintenance records are faked, aren't they?",
    {
      semantic: true,
      from: ["Cass Holloway", "cass-holloway"],
      hides: ["falsified"],
    },
  ),

  // Traps: what should not fire.
  salt(
    "traps",
    "a name that is an ordinary word, lower case",
    MARA,
    "there is hope for us yet",
    { forbid: ["hope-marrow"] },
  ),
  salt(
    "traps",
    "the same word opening a sentence",
    MARA,
    "Hope is all we have",
    { forbid: ["hope-marrow"] },
  ),
  salt(
    "traps",
    "really the person, mid-sentence",
    MARA,
    "I saw Hope at the market",
    { expect: ["hope-marrow"] },
  ),
  north("traps", "a verb that is a name", PRIYA, "please mark this as done", {
    forbid: ["mark-silva"],
  }),
  north(
    "traps",
    "the name, mid-sentence",
    "lena-fischer",
    "ask Mark about it",
    { expect: ["mark-silva"] },
  ),
  north(
    "traps",
    "an adjective that is a name",
    PRIYA,
    "she handled it with grace",
    { forbid: ["grace-kim"] },
  ),
  north("traps", "small talk stays small", PRIYA, "hey, how are you?", {
    first: "alex",
    maxFull: 2,
  }),
  salt("traps", "a greeting brings no lore", MARA, "good morning!", {
    maxFull: 1,
    forbid: ["founding_of_saltmere", "saltmere"],
  }),
  salt(
    "traps",
    "their own card never comes up",
    MARA,
    "Mara Vell, is that you?",
    { forbid: ["mara-vell"] },
  ),

  // History: the world changes, and only some hear of it.
  salt(
    "history",
    "news reaches those who know the page",
    "hope-marrow",
    "any change to the tide tax?",
    { shows: ["doubles the tide tax"] },
  ),
  salt(
    "history",
    "an unannounced event stays hidden",
    "hope-marrow",
    "any change to the tide tax?",
    { hides: ["privately plans"] },
  ),
  salt(
    "history",
    "future news has not happened",
    MARA,
    "will the tide tax last?",
    { hides: ["repealed"] },
  ),
  salt(
    "history",
    "a change since they last looked is not yet known",
    MARA,
    "any fire at the Salt Market?",
    { expect: ["salt_market"], hides: ["guts the north aisle"] },
  ),
  north(
    "history",
    "public news on a company page",
    "mark-silva",
    "how does the Q3 Review work now?",
    { shows: ["forced ranking"], hides: ["results are published"] },
  ),
  ship(
    "history",
    "news on a famous page",
    "oona-pryce",
    "any change to the water ration?",
    { shows: ["cut by a tenth"] },
  ),

  ship(
    "history",
    "recent news finds them unmentioned",
    "oona-pryce",
    "good evening",
    { expect: ["water_ration"], shows: ["cut by a tenth"] },
  ),
  salt("history", "older news does not", "hope-marrow", "good evening", {
    forbid: ["tide_tax"],
  }),
  salt(
    "history",
    "news only reaches those who could know the page",
    "hope-marrow",
    "good evening",
    { forbid: ["watch_muster"] },
  ),
  salt("history", "and does reach them", "oswin-hale", "good evening", {
    expect: ["watch_muster"],
    shows: ["Muster moves to dawn"],
  }),

  // Context: the turn beyond the message.
  north("context", "the current task brings a name to mind", PRIYA, "ok", {
    task: "Reviewing Dan Okafor's change",
    expect: ["dan-okafor"],
  }),
  salt("context", "a sighting names who was seen", MARA, "", {
    prompt:
      "[Tue 2026-03-10 12:00]\n- [Tue 2026-03-10 12:00] You see Oswin Hale `oswin-hale` crossing the pier.",
    expect: ["oswin-hale"],
  }),
  north("context", "the current place with a personal view", PRIYA, "morning", {
    here: ["coffee_bar"],
    shows: ["only place I talk to anyone from Sales"],
  }),
  salt("context", "a linked day comes up beside the person", MARA, "hello", {
    from: ["Tobin Vell", "tobin-vell"],
    expect: ["2026-03-09"],
  }),
] as const;
