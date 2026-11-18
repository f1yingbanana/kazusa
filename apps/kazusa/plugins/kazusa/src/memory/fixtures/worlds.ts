import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Synthetic worlds for the retrieval evaluation: different genres and different
 * kinds of groups, so the framework is never tested only on the world it ships
 * with. `world/` is canon, `agents/<id>/wiki/` is one character's mind.
 */
export interface FixtureWorld {
  readonly now: string;
  readonly files: Readonly<Record<string, string>>;
}

const page = (front: string, name: string, body = "", sections = ""): string =>
  `---\n${front}\n---\n\n# ${name}\n\n${body}\n${sections ? `\n${sections}\n` : ""}`;

const SALTMERE: FixtureWorld = {
  now: "2026-03-10T12:00:00Z",
  files: {
    "world/concepts/saltmere.md": page(
      "known:\n  everyone: knows",
      "Saltmere",
      "A tidal port city ruled by a regent, famous for salt and storms.",
    ),
    "world/concepts/eastquay.md": page(
      "group: true\nknown:\n  everyone: heard of\nsummary: The rough dockside ward of Saltmere.",
      "Eastquay",
      "Fishing crews, warehouses and narrow stairs down to the water.",
    ),
    "world/concepts/highgate.md": page(
      "group: true\nknown:\n  everyone: heard of\nsummary: The wealthy hill ward above the harbor.",
      "Highgate",
      "Stone townhouses, physicians and the old university.",
    ),
    "world/concepts/lamplighters.md": page(
      "group: true\nknown:\n  everyone: heard of\n  eastquay: knows\naliases:\n  - Lamplighters' Guild\n  - Lamp Guild\nsummary: The guild that keeps Saltmere's street lamps burning.",
      "Lamplighters",
      "They walk the wards at dusk with long poles and oil cans.",
      "## Guild accounts\n\nThe guild quietly skims oil money to pay widows of drowned members.",
    ),
    "world/concepts/harbor_watch.md": page(
      "group: true\nknown:\n  everyone: heard of\n  eastquay: knows\naliases:\n  - the Watch\n  - Harbor Watch\nsummary: The city guard of the docks.",
      "Harbor Watch",
      "Blue coats who patrol the quays and collect harbor dues.",
      "## Patrol rota\n\nNight patrols skip the north pier on feast days.",
    ),
    "world/concepts/apothecaries.md": page(
      "group: true\nknown:\n  everyone: heard of\n  highgate: knows\naliases:\n  - Apothecaries' Guild\nsummary: Licensed makers of medicines.",
      "Apothecaries",
      "They sell tinctures from a row of green-doored shops.",
      "## Cure for black tide\n\nThe guild knows that kelp ash and vinegar break the fever.",
    ),
    "world/concepts/lamp_oath.md": page(
      "known:\n  lamplighters: close",
      "Lamp Oath",
      "Every lamplighter swears never to let a street go dark.",
      "## Words of the oath\n\nI carry the small fire so that no one is lost on the stairs.",
    ),
    "world/concepts/tide_tax.md": page(
      "summary: A levy on every cargo landed in Saltmere.\nknown:\n  everyone: knows",
      "Tide Tax",
      "Paid at the salt market on each spring tide.",
      "## History\n\n- 2026-03-05 · news — The Regent doubles the tide tax for the storm season.\n- 2026-03-09 — The Regent privately plans to abolish the tax next year.\n- 2026-04-01 · news — The tide tax is repealed.",
    ),
    "world/concepts/black_tide_fever.md": page(
      "known:\n  everyone: heard of\n  highgate: knows\nsummary: A coastal fever that comes with the dark spring tides.",
      "Black Tide Fever",
      "Sailors shake and sweat for a week; many recover.",
      "",
    ),
    "world/concepts/smuggling_ring.md": page(
      "summary: A ring moving untaxed salt through flooded cellars.",
      "The Undertow",
      "They move untaxed salt at night through the flooded cellars.",
    ),
    "world/concepts/drowned_bell.md": page(
      "summary: A legend that a bell rings under the bay before a disaster.\nknown:\n  everyone: heard of",
      "Drowned Bell",
      "Fishermen swear they hear it before great storms.",
    ),
    "world/concepts/watch_muster.md": page(
      "known:\n  harbor_watch: close\nsummary: The Watch's weekly roll call.",
      "Watch Muster",
      "Every man answers his name on the pier.",
      "## History\n\n- 2026-03-09 · news — Muster moves to dawn for the storm season.",
    ),
    "world/concepts/founding_of_saltmere.md": page(
      "summary: How three fishing clans became one city.\nknown:\n  everyone: knows",
      "Founding of Saltmere",
      "Three clans signed the Tide Charter after the great flood.",
    ),
    "world/concepts/regent_council.md": page(
      "known:\n  everyone: heard of\n  highgate: knows\nsummary: The nobles who advise the Regent.",
      "Regent Council",
      "Seven seats, mostly Highgate families.",
    ),
    "world/concepts/eastquay_docks.md": page(
      "place_id: eastquay_docks\nknown:\n  eastquay: knows\naliases:\n  - the docks\nsummary: Salt-crusted quays and stacked crates.",
      "Eastquay Docks",
      "Gulls, tar smell and shouting crews.",
    ),
    "world/concepts/lamp_hall.md": page(
      "place_id: lamp_hall\nknown:\n  lamplighters: close\n  eastquay: knows\nparent: eastquay_docks\naliases:\n  - the hall\nsummary: The guild's oil-smelling meeting hall.",
      "Lamp Hall",
      "Racks of poles and a long table scarred by oil cans.",
    ),
    "world/concepts/mara_loft.md": page(
      "place_id: mara_loft\nparent: eastquay_docks\nsummary: A small attic over a net-maker's shop.",
      "Mara's Loft",
      "One window, a cot and a shelf of lamp glass.",
    ),
    "world/concepts/watch_house.md": page(
      "place_id: watch_house\nknown:\n  harbor_watch: close\n  eastquay: knows\nparent: eastquay_docks\nsummary: A squat stone guardhouse by the pier.",
      "Watch House",
      "Cells below, a muster room above.",
    ),
    "world/concepts/highgate_square.md": page(
      "place_id: highgate_square\nknown:\n  highgate: knows\nsummary: A clean square of pale stone.",
      "Highgate Square",
      "A fountain and a clock that keeps correct time.",
    ),
    "world/concepts/apothecary_row.md": page(
      "place_id: apothecary_row\nknown:\n  apothecaries: close\n  highgate: knows\nparent: highgate_square\nsummary: A lane of green-doored medicine shops.",
      "Apothecary Row",
      "Everything smells of cloves.",
    ),
    "world/concepts/regents_keep.md": page(
      "place_id: regents_keep\naliases:\n  - the Keep\nsummary: The grey fortress over the harbor mouth.\nknown:\n  everyone: knows",
      "Regent's Keep",
      "Its beacon can be seen from every ward.",
    ),
    "world/concepts/salt_market.md": page(
      "place_id: salt_market\nsummary: The covered market where all salt is traded.\nknown:\n  everyone: heard of",
      "Salt Market",
      "Long tables under a tarred roof.",
      "## History\n\n- 2026-03-08 — A fire guts the north aisle of the market.",
    ),
    "world/concepts/drowned_cellar.md": page(
      "place_id: drowned_cellar\nsummary: A half-flooded smugglers' cellar.",
      "Drowned Cellar",
      "Crates on stilts above black water.",
    ),
    "world/characters/mara-vell.md": page(
      "in:\n  Lamplighters: close\n  eastquay: knows\nhome: mara_loft",
      "Mara Vell",
      "A wiry lamplighter with burn-scarred fingers.",
    ),
    "world/characters/tobin-vell.md": page(
      "in:\n  Harbor Watch: close\n  eastquay: knows\nhome: watch_house",
      "Tobin Vell",
      "A tall young watchman in a too-clean blue coat.",
    ),
    "world/characters/ilse-dray.md": page(
      "in:\n  Lamplighters: close\n  eastquay: knows",
      "Ilse Dray",
      "An old lamplighter who walks with a hitch.",
    ),
    "world/characters/oswin-hale.md": page(
      "in:\n  Harbor Watch: close\n  eastquay: knows",
      "Oswin Hale",
      "A heavy sergeant with an anchor tattoo.",
    ),
    "world/characters/hope-marrow.md": page(
      "in:\n  Apothecaries: close\n  highgate: knows",
      "Hope Marrow",
      "A precise young apothecary with ink on her cuffs.",
    ),
    "world/characters/eloise-becu.md": page(
      "name: Éloise Bécu\nin:\n  Apothecaries: close\n  highgate: knows",
      "Éloise Bécu",
      "A foreign physician with a sharp accent.",
    ),
    "world/characters/bram-stokes.md": page(
      "in:\n  eastquay: knows",
      "Bram Stokes",
      "A friendly net-mender with too much money.",
    ),
    "world/characters/alaric-voss.md": page(
      "known:\n  everyone: knows\nin:\n  highgate: knows\nsummary: The Regent of Saltmere.",
      "Alaric Voss",
      "The Regent, a gaunt man who rarely leaves the Keep.",
    ),
    "world/characters/jun-hoshi.md": page(
      "name: Jun Hoshi\naliases:\n  - 星 淳\nin:\n  eastquay: knows",
      "Jun Hoshi",
      "A sailor from the far islands.",
    ),
    "agents/mara-vell/wiki/characters/tobin-vell.md": page(
      "relation: little brother\nsummary: My brother; joined the Watch to spite me.",
      "Tobin Vell",
      "He thinks the coat makes him a man. I still check he has eaten.",
      "## What they think of me\n\nThinks I look down on him for taking the Watch's coin. (think so)\n\n## Open threads\n\n- He still owes me the rent for February.\n\n## Notes\n\n- 2026-03-08 · seen it · sure — Saw him flinch when Oswin shouted.\n- 2026-02-20 · seen it · sure — Lent him ten coppers.\n- 2026-01-10 · seen it · sure — He came home drunk on his name day.",
    ),
    "agents/mara-vell/wiki/characters/ilse-dray.md": page(
      "relation: mentor\nsummary: Taught me the rounds.",
      "Ilse Dray",
      "Her knee is worse than she admits.",
      "## What they think of me\n\nProbably sees me as careless with oil. (suspect)",
    ),
    "agents/mara-vell/wiki/characters/oswin-hale.md": page(
      'relation: enemy\naliases: ["Old Anchor"]\nsummary: The sergeant who bullies my brother.',
      "Oswin Hale",
      "A bully with a badge. People on the docks call him Old Anchor.",
      "## Notes\n\n- 2026-03-01 · told by ilse-dray · think so — He takes bribes from the fish sellers.",
    ),
    "agents/mara-vell/wiki/characters/hope-marrow.md": page(
      "relation: acquaintance\nsummary: Sold me burn salve.",
      "Hope Marrow",
      "Polite, and charged me double.",
    ),
    "agents/mara-vell/wiki/concepts/lamp_hall.md": page(
      "learned: been there\nseen: 2026-03-09",
      "Lamp Hall",
      "Where I hang my pole and avoid the guild master.",
    ),
    "agents/mara-vell/wiki/concepts/salt_market.md": page(
      "learned: been there\nseen: 2026-03-01",
      "Salt Market",
      "I buy cheap wicks from the north aisle.",
    ),
    "agents/mara-vell/wiki/concepts/tide_tax.md": page(
      "name: Tide Tax",
      "Tide Tax",
      "A racket to pay for the Regent's parties.",
      "## Notes\n\n- 2026-03-06 · told by jun-hoshi · suspect — The money goes straight to the Keep's wine cellar.",
    ),
    "agents/mara-vell/wiki/concepts/drowned_bell.md": page(
      "name: Drowned Bell",
      "Drowned Bell",
      "I heard it the night our father was lost, and nobody believes me.",
      "",
    ),
    "agents/mara-vell/wiki/concepts/night_ledger.md": page(
      "name: My night ledger",
      "My night ledger",
      "I keep a count of every lamp that fails and who was on the round. It is how I will prove the oil is being stolen.",
    ),
    "agents/mara-vell/wiki/days/2026-03-09.md": page(
      "touched: [tobin-vell, lamp_hall]\nsummary: Argued with Tobin about the coat.",
      "March 9",
      "Long round in the rain. Argued with Tobin about the coat outside the hall.",
    ),
    "agents/tobin-vell/wiki/characters/mara-vell.md": page(
      "relation: older sister\nsummary: Thinks she is my mother.",
      "Mara Vell",
      "She works herself to the bone and calls it pride.",
      "## What they think of me\n\nThinks I sold out, and is probably right. (sure)",
    ),
    "agents/tobin-vell/wiki/characters/oswin-hale.md": page(
      "relation: sergeant\nsummary: Loud but fair.",
      "Oswin Hale",
      "He shouts, but he covers for his men.",
    ),
    "agents/hope-marrow/wiki/concepts/willow_bark_remedy.md": page(
      "name: Willow bark remedy",
      "Willow bark remedy",
      "My own recipe for joint pain: steep the bark overnight with honey.",
    ),
    "agents/hope-marrow/wiki/characters/mara-vell.md": page(
      "relation: customer\nsummary: Burned fingers, pays late.",
      "Mara Vell",
      "Comes in for salve and argues about the price.",
    ),
    "agents/alaric-voss/wiki/concepts/regent_council.md": page(
      "name: Regent Council",
      "Regent Council",
      "Seven seats, and I hold one.",
      "## Seating quarrel\n\nThe Regent means to remove the seventh seat.",
    ),
    "agents/bram-stokes/wiki/concepts/smuggling_ring.md": page(
      "name: Smuggling ring",
      "Smuggling ring",
      "Our ring: untaxed salt at night, through the flooded cellars.",
    ),
    "agents/bram-stokes/wiki/concepts/drowned_cellar.md": page(
      "learned: always known",
      "Drowned Cellar",
      "Keep the lower crates dry and never bring anyone by the east stair.",
    ),
  },
};

const NORTHWIND: FixtureWorld = {
  now: "2026-06-15T09:00:00Z",
  files: {
    "world/concepts/northwind_co.md": page(
      "group: true\naliases:\n  - Northwind\nsummary: A mid-sized logistics software company.\nknown:\n  everyone: heard of",
      "Northwind Co",
      "About four hundred people, mostly remote since the move.",
    ),
    "world/concepts/helix_labs.md": page(
      "summary: A well-funded competitor.\nknown:\n  everyone: heard of",
      "Helix Labs",
      "They poached two directors last spring.",
    ),
    "world/concepts/platform_team.md": page(
      "group: true\nknown:\n  everyone: heard of\n  northwind_co: knows\naliases:\n  - Platform\nsummary: Keeps the routing engine running.",
      "Platform Team",
      "On call around the clock.",
      "## Team norms\n\nNobody merges on Fridays without Dan's sign-off.",
    ),
    "world/concepts/sales_team.md": page(
      "group: true\nknown:\n  everyone: heard of\n  northwind_co: knows\naliases:\n  - Sales\nsummary: Sells to freight companies.",
      "Sales Team",
      "Quota-driven and always travelling.",
      "## Pipeline\n\nThe Meridian Freight deal is worth half the quarter.",
    ),
    "world/concepts/project_atlas.md": page(
      "known:\n  platform_team: close\naliases:\n  - Atlas\nsummary: The rewrite of the routing engine.",
      "Project Atlas",
      "A two-year rewrite, already six months late.",
    ),
    "world/concepts/layoffs_plan.md": page(
      "summary: A confidential plan to cut a fifth of staff.",
      "Layoffs Plan",
      "A fifth of staff, announced after the fiscal close.",
    ),
    "world/concepts/q3_review.md": page(
      "known:\n  everyone: heard of\n  northwind_co: knows\nsummary: The company-wide performance review.",
      "Q3 Review",
      "Everyone writes a self-assessment.",
      "## History\n\n- 2026-06-10 · news — Reviews move to a forced ranking this year.\n- 2026-07-01 · news — Review results are published.",
    ),
    "world/concepts/expense_policy.md": page(
      "known:\n  everyone: heard of\n  northwind_co: knows\nsummary: The rules for travel and receipts.",
      "Expense Policy",
      "Receipts are required above fifty dollars and flights need approval.",
    ),
    "world/concepts/office_hq.md": page(
      "place_id: office_hq\nknown:\n  northwind_co: knows\naliases:\n  - the office\n  - HQ\nsummary: Three floors of a converted warehouse.",
      "Northwind HQ",
      "Exposed brick and terrible acoustics.",
    ),
    "world/concepts/server_room.md": page(
      "place_id: server_room\nknown:\n  platform_team: close\n  northwind_co: knows\nparent: office_hq\nsummary: A cold room full of humming racks.",
      "Server Room",
      "Badge access only.",
    ),
    "world/concepts/sales_floor.md": page(
      "place_id: sales_floor\nknown:\n  sales_team: close\n  northwind_co: knows\nparent: office_hq\nsummary: An open floor with a gong.",
      "Sales Floor",
      "Someone rings the gong for every deal.",
    ),
    "world/concepts/grace_office.md": page(
      "place_id: grace_office\nparent: office_hq\nsummary: The corner office.",
      "Grace's Office",
      "A standing desk and no chairs for visitors.",
    ),
    "world/concepts/coffee_bar.md": page(
      "place_id: coffee_bar\nknown:\n  northwind_co: knows\nparent: office_hq\nsummary: The second-floor coffee bar.",
      "Coffee Bar",
      "The espresso machine is the only thing everyone agrees on.",
      "## History\n\n- 2026-06-14 — The espresso machine breaks down and is carted off.",
    ),
    "world/characters/priya-nair.md": page(
      "in:\n  Platform: close\n  Northwind: knows\nhome: server_room",
      "Priya Nair",
      "A staff engineer who answers pages from the elevator.",
    ),
    "world/characters/dan-okafor.md": page(
      "in:\n  Platform: close\n  Northwind: knows",
      "Dan Okafor",
      "The team lead, soft-spoken and impossible to rush.",
    ),
    "world/characters/lena-fischer.md": page(
      "in:\n  Sales: close\n  Northwind: knows",
      "Lena Fischer",
      "A top seller who never takes her headset off.",
    ),
    "world/characters/mark-silva.md": page(
      "in:\n  Sales: close\n  Northwind: knows",
      "Mark Silva",
      "A cheerful account manager.",
    ),
    "world/characters/grace-kim.md": page(
      "known:\n  everyone: knows\nin:\n  Northwind: knows\nhome: grace_office\nsummary: The CEO of Northwind.",
      "Grace Kim",
      "The founder and CEO, known for blunt all-hands.",
    ),
    "world/characters/wei-zhang.md": page(
      "name: Wei Zhang\naliases:\n  - 张伟\nin:\n  Platform: close\n  Northwind: knows",
      "Wei Zhang",
      "A junior engineer who sends very long messages.",
    ),
    "world/characters/alex.md": page(
      "name: Alex\nin:\n  Northwind: knows",
      "Alex",
      "An engineering manager.",
    ),
    "agents/priya-nair/wiki/characters/alex.md": page(
      "peer_id: user:alex\nname: Alex\nrelation: manager\nsummary: My manager; means well.",
      "Alex",
      "Shields the team from most meetings. Promised me a promotion case this cycle.",
      "## What they think of me\n\nThinks I'm reliable but difficult. (think so)\n\n## Open threads\n\n- The promotion packet is still unwritten.\n\n## Notes\n\n- 2026-06-12 · seen it · sure — Cancelled our one-on-one again.",
    ),
    "agents/priya-nair/wiki/characters/dan-okafor.md": page(
      "relation: team lead\nsummary: Slow, careful, usually right.",
      "Dan Okafor",
      "He reviews every line and I have stopped arguing.",
    ),
    "agents/priya-nair/wiki/characters/lena-fischer.md": page(
      'relation: sparring partner\naliases: ["the Headset"]\nsummary: Promises customers things we cannot build.',
      "Lena Fischer",
      "We call her the Headset. She sold a feature that does not exist.",
      "## Notes\n\n- 2026-06-01 · told by wei-zhang · suspect — She is interviewing at Helix Labs.",
    ),
    "agents/priya-nair/wiki/concepts/deploy_checklist.md": page(
      "name: Deploy checklist",
      "Deploy checklist",
      "My own steps before a release.",
      "## Steps\n\n- Drain the canary before touching the database.\n- Never deploy with a migration pending.\n- Check the pager is on loud.",
    ),
    "agents/priya-nair/wiki/concepts/project_atlas.md": page(
      "name: Project Atlas",
      "Project Atlas",
      "A vanity project, but the only way the routing engine survives.",
      "## Rollback plan\n\nIf Atlas fails, restore last month's snapshot and blame the vendor.",
    ),
    "agents/grace-kim/wiki/concepts/layoffs_plan.md": page(
      "name: Layoffs Plan",
      "Layoffs Plan",
      "A fifth of staff, announced after the fiscal close. Nobody else may know before then.",
    ),
    "agents/priya-nair/wiki/concepts/helix_labs.md": page(
      "name: Helix Labs",
      "Helix Labs",
      "I turned down their offer. The money was obscene and the product is a demo.",
    ),
    "agents/priya-nair/wiki/concepts/coffee_bar.md": page(
      "learned: been there\nseen: 2026-06-01",
      "Coffee Bar",
      "The only place I talk to anyone from Sales.",
    ),
    "agents/lena-fischer/wiki/characters/priya-nair.md": page(
      "relation: blocker\nsummary: Says no to everything.",
      "Priya Nair",
      "Brilliant, and the reason my deals slip.",
      "## What they think of me\n\nThinks I'm a liar with a quota. (sure)",
    ),
    "agents/lena-fischer/wiki/concepts/meridian_notes.md": page(
      "name: Meridian notes",
      "Meridian notes",
      "Their procurement lead hates long contracts and loves golf.",
    ),
    "agents/mark-silva/wiki/characters/lena-fischer.md": page(
      "relation: colleague\nsummary: Top of the board.",
      "Lena Fischer",
      "Generous with leads when she is winning.",
    ),
  },
};

const KEPLER: FixtureWorld = {
  now: "2150-01-20T00:00:00Z",
  files: {
    "world/concepts/ark_kepler.md": page(
      "summary: A generation ship in its third century of flight.\nknown:\n  everyone: knows",
      "Ark Kepler",
      "Nine decks, four thousand people, no way home.",
    ),
    "world/concepts/lower_decks.md": page(
      "group: true\nknown:\n  everyone: heard of\naliases:\n  - Lowers\nsummary: The crowded engineering decks.",
      "Lower Decks",
      "Hot, loud and proud of it.",
    ),
    "world/concepts/upper_decks.md": page(
      "group: true\nknown:\n  everyone: heard of\naliases:\n  - Uppers\nsummary: The garden decks of the ship's officers.",
      "Upper Decks",
      "Real soil and quiet corridors.",
    ),
    "world/concepts/reactor_core.md": page(
      "group: true\nknown:\n  everyone: heard of\n  lower_decks: knows\nsummary: The fusion plant that powers the ship.",
      "Reactor Core",
      "Everyone depends on it and few understand it.",
      "## Coolant leak\n\nThe third coolant loop has been leaking for a decade and the logs are falsified.",
    ),
    "world/concepts/water_ration.md": page(
      "summary: The daily water allowance for every citizen.\nknown:\n  everyone: knows",
      "Water Ration",
      "Issued by chit at the deck stations.",
      "## History\n\n- 2150-01-18 · news — The ration is cut by a tenth.",
    ),
    "world/concepts/mutiny_rumor.md": page(
      "summary: Talk of an uprising against the officers.\nknown:\n  everyone: heard of",
      "The Quiet Mutiny",
      "Nobody admits to having heard of it, and everybody has.",
    ),
    "world/concepts/commons.md": page(
      "place_id: commons\nknown:\n  lower_decks: knows\nsummary: The noisy deck three canteen.",
      "Deck Three Commons",
      "Long benches and recycled air.",
    ),
    "world/concepts/arboretum.md": page(
      "place_id: arboretum\nknown:\n  upper_decks: knows\nsummary: The officers' tree garden.",
      "Arboretum",
      "Real birds, somehow.",
    ),
    "world/characters/ren-adeyemi.md": page(
      "in:\n  Lower Decks: knows",
      "Ren Adeyemi",
      "A coolant tech with a shaved head.",
    ),
    "world/characters/cass-holloway.md": page(
      "in:\n  reactor_core: close\n  Lower Decks: knows",
      "Cass Holloway",
      "The reactor's night shift chief.",
    ),
    "world/characters/oona-pryce.md": page(
      "in:\n  Upper Decks: knows",
      "Oona Pryce",
      "A junior officer in a pressed grey uniform.",
    ),
    "agents/ren-adeyemi/wiki/characters/cass-holloway.md": page(
      "relation: shift chief\nsummary: Knows more than she says.",
      "Cass Holloway",
      "She signs the coolant logs without reading them, or says she does.",
    ),
    "agents/ren-adeyemi/wiki/concepts/water_ration.md": page(
      "name: Water Ration",
      "Water Ration",
      "They cut ours first and call it fairness.",
    ),
    "agents/oona-pryce/wiki/concepts/mutiny_rumor.md": page(
      "name: The Quiet Mutiny",
      "The Quiet Mutiny",
      "Probably just Lowers blowing off steam. My captain disagrees.",
    ),
  },
};

export const WORLDS: Readonly<Record<string, FixtureWorld>> = {
  saltmere: SALTMERE,
  northwind: NORTHWIND,
  kepler: KEPLER,
};

/** Writes a world to a temporary directory; returns its root. */
export function materialize(world: FixtureWorld): string {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-world-"));
  for (const [relative, content] of Object.entries(world.files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}
