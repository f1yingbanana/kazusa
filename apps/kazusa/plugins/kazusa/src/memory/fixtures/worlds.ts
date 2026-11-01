import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Anchors } from "../knowledge.ts";

/**
 * Synthetic worlds for the retrieval evaluation: different genres and different
 * anchor fields, so the framework is never tested only on the world it ships
 * with. `world/` is canon, `agents/<id>/wiki/` is one character's mind.
 */
export interface FixtureWorld {
  readonly anchors: Anchors;
  readonly now: string;
  readonly files: Readonly<Record<string, string>>;
}

const page = (front: string, name: string, body = "", sections = ""): string =>
  `---\n${front}\n---\n\n# ${name}\n\n${body}\n${sections ? `\n${sections}\n` : ""}`;

const SALTMERE: FixtureWorld = {
  anchors: { guild: "intimate", ward: "familiar" },
  now: "2026-03-10T12:00:00Z",
  files: {
    "world/concepts/saltmere.md": page(
      "renown: famous",
      "Saltmere",
      "A tidal port city ruled by a regent, famous for salt and storms.",
    ),
    "world/concepts/eastquay.md": page(
      "community: saltmere\nrenown: known\nsummary: The rough dockside ward of Saltmere.",
      "Eastquay",
      "Fishing crews, warehouses and narrow stairs down to the water.",
    ),
    "world/concepts/highgate.md": page(
      "community: saltmere\nrenown: known\nsummary: The wealthy hill ward above the harbor.",
      "Highgate",
      "Stone townhouses, physicians and the old university.",
    ),
    "world/concepts/lamplighters.md": page(
      'community: eastquay\naliases: ["Lamplighters\' Guild", "Lamp Guild"]\nrenown: known\nsummary: The guild that keeps Saltmere\'s street lamps burning.',
      "Lamplighters",
      "They walk the wards at dusk with long poles and oil cans.",
      "## Guild accounts\n\nThe guild quietly skims oil money to pay widows of drowned members.",
    ),
    "world/concepts/harbor_watch.md": page(
      'community: eastquay\naliases: ["the Watch", "Harbor Watch"]\nrenown: known\nsummary: The city guard of the docks.',
      "Harbor Watch",
      "Blue coats who patrol the quays and collect harbor dues.",
      "## Patrol rota\n\nNight patrols skip the north pier on feast days.",
    ),
    "world/concepts/apothecaries.md": page(
      'community: highgate\naliases: ["Apothecaries\' Guild"]\nrenown: known\nsummary: Licensed makers of medicines.',
      "Apothecaries",
      "They sell tinctures from a row of green-doored shops.",
      "## Cure for black tide\n\nThe guild knows that kelp ash and vinegar break the fever.",
    ),
    "world/concepts/lamp_oath.md": page(
      "community: lamplighters\nrenown: local",
      "Lamp Oath",
      "Every lamplighter swears never to let a street go dark.",
      "## Words of the oath\n\nI carry the small fire so that no one is lost on the stairs.",
    ),
    "world/concepts/tide_tax.md": page(
      "renown: famous\nsummary: A levy on every cargo landed in Saltmere.",
      "Tide Tax",
      "Paid at the salt market on each spring tide.",
      "## History\n\n- 2026-03-05 · news — The Regent doubles the tide tax for the storm season.\n- 2026-03-09 — The Regent privately plans to abolish the tax next year.\n- 2026-04-01 · news — The tide tax is repealed.",
    ),
    "world/concepts/black_tide_fever.md": page(
      "community: highgate\nrenown: known\nsummary: A coastal fever that comes with the dark spring tides.",
      "Black Tide Fever",
      "Sailors shake and sweat for a week; many recover.",
      "",
    ),
    "world/concepts/smuggling_ring.md": page(
      "known_by: [bram-stokes]\nsummary: A ring moving untaxed salt through flooded cellars.",
      "The Undertow",
      "They move untaxed salt at night through the flooded cellars.",
    ),
    "world/concepts/drowned_bell.md": page(
      "renown: known\nsummary: A legend that a bell rings under the bay before a disaster.",
      "Drowned Bell",
      "Fishermen swear they hear it before great storms.",
    ),
    "world/concepts/watch_muster.md": page(
      "community: harbor_watch\nrenown: local\nsummary: The Watch's weekly roll call.",
      "Watch Muster",
      "Every man answers his name on the pier.",
      "## History\n\n- 2026-03-09 · news — Muster moves to dawn for the storm season.",
    ),
    "world/concepts/founding_of_saltmere.md": page(
      "renown: famous\nsummary: How three fishing clans became one city.",
      "Founding of Saltmere",
      "Three clans signed the Tide Charter after the great flood.",
    ),
    "world/concepts/regent_council.md": page(
      "community: highgate\nrenown: known\nsummary: The nobles who advise the Regent.",
      "Regent Council",
      "Seven seats, mostly Highgate families.",
      "## Seating quarrel\n\nKnown by: alaric-voss\n\nThe Regent means to remove the seventh seat.",
    ),
    "world/entities/places/eastquay_docks.md": page(
      "community: eastquay\naliases: [the docks]\nsummary: Salt-crusted quays and stacked crates.",
      "Eastquay Docks",
      "Gulls, tar smell and shouting crews.",
    ),
    "world/entities/places/lamp_hall.md": page(
      "parent: eastquay_docks\ncommunity: lamplighters\naliases: [the hall]\nsummary: The guild's oil-smelling meeting hall.",
      "Lamp Hall",
      "Racks of poles and a long table scarred by oil cans.",
    ),
    "world/entities/places/mara_loft.md": page(
      "parent: eastquay_docks\nrenown: private\nsummary: A small attic over a net-maker's shop.",
      "Mara's Loft",
      "One window, a cot and a shelf of lamp glass.",
    ),
    "world/entities/places/watch_house.md": page(
      "parent: eastquay_docks\ncommunity: harbor_watch\nsummary: A squat stone guardhouse by the pier.",
      "Watch House",
      "Cells below, a muster room above.",
    ),
    "world/entities/places/highgate_square.md": page(
      "community: highgate\nsummary: A clean square of pale stone.",
      "Highgate Square",
      "A fountain and a clock that keeps correct time.",
    ),
    "world/entities/places/apothecary_row.md": page(
      "parent: highgate_square\ncommunity: apothecaries\nsummary: A lane of green-doored medicine shops.",
      "Apothecary Row",
      "Everything smells of cloves.",
    ),
    "world/entities/places/regents_keep.md": page(
      "renown: famous\naliases: [the Keep]\nsummary: The grey fortress over the harbor mouth.",
      "Regent's Keep",
      "Its beacon can be seen from every ward.",
    ),
    "world/entities/places/salt_market.md": page(
      "renown: known\nsummary: The covered market where all salt is traded.",
      "Salt Market",
      "Long tables under a tarred roof.",
      "## History\n\n- 2026-03-08 — A fire guts the north aisle of the market.",
    ),
    "world/entities/places/drowned_cellar.md": page(
      "known_by: [bram-stokes]\nsummary: A half-flooded smugglers' cellar.",
      "Drowned Cellar",
      "Crates on stilts above black water.",
    ),
    "world/entities/characters/mara-vell.md": page(
      "guild: Lamplighters\nward: eastquay\nhome: mara_loft",
      "Mara Vell",
      "A wiry lamplighter with burn-scarred fingers.",
    ),
    "world/entities/characters/tobin-vell.md": page(
      "guild: Harbor Watch\nward: eastquay\nhome: watch_house",
      "Tobin Vell",
      "A tall young watchman in a too-clean blue coat.",
    ),
    "world/entities/characters/ilse-dray.md": page(
      "guild: Lamplighters\nward: eastquay",
      "Ilse Dray",
      "An old lamplighter who walks with a hitch.",
    ),
    "world/entities/characters/oswin-hale.md": page(
      "guild: Harbor Watch\nward: eastquay",
      "Oswin Hale",
      "A heavy sergeant with an anchor tattoo.",
    ),
    "world/entities/characters/hope-marrow.md": page(
      "guild: Apothecaries\nward: highgate",
      "Hope Marrow",
      "A precise young apothecary with ink on her cuffs.",
    ),
    "world/entities/characters/eloise-becu.md": page(
      "name: Éloise Bécu\nguild: Apothecaries\nward: highgate",
      "Éloise Bécu",
      "A foreign physician with a sharp accent.",
    ),
    "world/entities/characters/bram-stokes.md": page(
      "ward: eastquay\nknows: { smuggling_ring: intimate, drowned_cellar: intimate }",
      "Bram Stokes",
      "A friendly net-mender with too much money.",
    ),
    "world/entities/characters/alaric-voss.md": page(
      "renown: famous\nward: highgate\nsummary: The Regent of Saltmere.",
      "Alaric Voss",
      "The Regent, a gaunt man who rarely leaves the Keep.",
    ),
    "world/entities/characters/jun-hoshi.md": page(
      "full_name: Jun Hoshi (星 淳)\nward: eastquay",
      "Jun Hoshi",
      "A sailor from the far islands.",
    ),
    "agents/mara-vell/wiki/entities/characters/tobin-vell.md": page(
      "relation: little brother\nsummary: My brother; joined the Watch to spite me.",
      "Tobin Vell",
      "He thinks the coat makes him a man. I still check he has eaten.",
      "## What they think of me\n\nThinks I look down on him for taking the Watch's coin. (think so)\n\n## Open threads\n\n- He still owes me the rent for February.\n\n## Notes\n\n- 2026-03-08 · seen it · sure — Saw him flinch when Oswin shouted.\n- 2026-02-20 · seen it · sure — Lent him ten coppers.\n- 2026-01-10 · seen it · sure — He came home drunk on his name day.",
    ),
    "agents/mara-vell/wiki/entities/characters/ilse-dray.md": page(
      "relation: mentor\nsummary: Taught me the rounds.",
      "Ilse Dray",
      "Her knee is worse than she admits.",
      "## What they think of me\n\nProbably sees me as careless with oil. (suspect)",
    ),
    "agents/mara-vell/wiki/entities/characters/oswin-hale.md": page(
      'relation: enemy\naliases: ["Old Anchor"]\nsummary: The sergeant who bullies my brother.',
      "Oswin Hale",
      "A bully with a badge. People on the docks call him Old Anchor.",
      "## Notes\n\n- 2026-03-01 · told by ilse-dray · think so — He takes bribes from the fish sellers.",
    ),
    "agents/mara-vell/wiki/entities/characters/hope-marrow.md": page(
      "relation: acquaintance\nsummary: Sold me burn salve.",
      "Hope Marrow",
      "Polite, and charged me double.",
    ),
    "agents/mara-vell/wiki/entities/places/lamp_hall.md": page(
      "learned: been there\nseen: 2026-03-09",
      "Lamp Hall",
      "Where I hang my pole and avoid the guild master.",
    ),
    "agents/mara-vell/wiki/entities/places/salt_market.md": page(
      "learned: been there\nseen: 2026-03-01",
      "Salt Market",
      "I buy cheap wicks from the north aisle.",
    ),
    "agents/mara-vell/wiki/concepts/tide_tax.md": page(
      "title: Tide Tax",
      "Tide Tax",
      "A racket to pay for the Regent's parties.",
      "## Notes\n\n- 2026-03-06 · told by jun-hoshi · suspect — The money goes straight to the Keep's wine cellar.",
    ),
    "agents/mara-vell/wiki/concepts/drowned_bell.md": page(
      "title: Drowned Bell",
      "Drowned Bell",
      "I heard it the night our father was lost, and nobody believes me.",
      "",
    ),
    "agents/mara-vell/wiki/concepts/night_ledger.md": page(
      "title: My night ledger",
      "My night ledger",
      "I keep a count of every lamp that fails and who was on the round. It is how I will prove the oil is being stolen.",
    ),
    "agents/mara-vell/wiki/days/2026-03-09.md": page(
      "touched: [tobin-vell, lamp_hall]\nsummary: Argued with Tobin about the coat.",
      "March 9",
      "Long round in the rain. Argued with Tobin about the coat outside the hall.",
    ),
    "agents/tobin-vell/wiki/entities/characters/mara-vell.md": page(
      "relation: older sister\nsummary: Thinks she is my mother.",
      "Mara Vell",
      "She works herself to the bone and calls it pride.",
      "## What they think of me\n\nThinks I sold out, and is probably right. (sure)",
    ),
    "agents/tobin-vell/wiki/entities/characters/oswin-hale.md": page(
      "relation: sergeant\nsummary: Loud but fair.",
      "Oswin Hale",
      "He shouts, but he covers for his men.",
    ),
    "agents/hope-marrow/wiki/concepts/willow_bark_remedy.md": page(
      "title: Willow bark remedy",
      "Willow bark remedy",
      "My own recipe for joint pain: steep the bark overnight with honey.",
    ),
    "agents/hope-marrow/wiki/entities/characters/mara-vell.md": page(
      "relation: customer\nsummary: Burned fingers, pays late.",
      "Mara Vell",
      "Comes in for salve and argues about the price.",
    ),
    "agents/bram-stokes/wiki/entities/places/drowned_cellar.md": page(
      "learned: always known",
      "Drowned Cellar",
      "Keep the lower crates dry and never bring anyone by the east stair.",
    ),
  },
};

const NORTHWIND: FixtureWorld = {
  anchors: { team: "intimate", company: "familiar" },
  now: "2026-06-15T09:00:00Z",
  files: {
    "world/concepts/northwind_co.md": page(
      'aliases: ["Northwind"]\nrenown: known\nsummary: A mid-sized logistics software company.',
      "Northwind Co",
      "About four hundred people, mostly remote since the move.",
    ),
    "world/concepts/helix_labs.md": page(
      "renown: known\nsummary: A well-funded competitor.",
      "Helix Labs",
      "They poached two directors last spring.",
    ),
    "world/concepts/platform_team.md": page(
      'community: northwind_co\naliases: ["Platform"]\nsummary: Keeps the routing engine running.',
      "Platform Team",
      "On call around the clock.",
      "## Team norms\n\nNobody merges on Fridays without Dan's sign-off.",
    ),
    "world/concepts/sales_team.md": page(
      'community: northwind_co\naliases: ["Sales"]\nsummary: Sells to freight companies.',
      "Sales Team",
      "Quota-driven and always travelling.",
      "## Pipeline\n\nThe Meridian Freight deal is worth half the quarter.",
    ),
    "world/concepts/project_atlas.md": page(
      'community: platform_team\naliases: ["Atlas"]\nrenown: local\nsummary: The rewrite of the routing engine.',
      "Project Atlas",
      "A two-year rewrite, already six months late.",
      "## Rollback plan\n\nKnown by: priya-nair\n\nIf Atlas fails, restore last month's snapshot and blame the vendor.",
    ),
    "world/concepts/layoffs_plan.md": page(
      "known_by: [grace-kim]\nsummary: A confidential plan to cut a fifth of staff.",
      "Layoffs Plan",
      "A fifth of staff, announced after the fiscal close.",
    ),
    "world/concepts/q3_review.md": page(
      "community: northwind_co\nrenown: known\nsummary: The company-wide performance review.",
      "Q3 Review",
      "Everyone writes a self-assessment.",
      "## History\n\n- 2026-06-10 · news — Reviews move to a forced ranking this year.\n- 2026-07-01 · news — Review results are published.",
    ),
    "world/concepts/expense_policy.md": page(
      "community: northwind_co\nsummary: The rules for travel and receipts.",
      "Expense Policy",
      "Receipts are required above fifty dollars and flights need approval.",
    ),
    "world/entities/places/office_hq.md": page(
      "community: northwind_co\naliases: [the office, HQ]\nsummary: Three floors of a converted warehouse.",
      "Northwind HQ",
      "Exposed brick and terrible acoustics.",
    ),
    "world/entities/places/server_room.md": page(
      "parent: office_hq\ncommunity: platform_team\nsummary: A cold room full of humming racks.",
      "Server Room",
      "Badge access only.",
    ),
    "world/entities/places/sales_floor.md": page(
      "parent: office_hq\ncommunity: sales_team\nsummary: An open floor with a gong.",
      "Sales Floor",
      "Someone rings the gong for every deal.",
    ),
    "world/entities/places/grace_office.md": page(
      "parent: office_hq\nrenown: private\nsummary: The corner office.",
      "Grace's Office",
      "A standing desk and no chairs for visitors.",
    ),
    "world/entities/places/coffee_bar.md": page(
      "parent: office_hq\ncommunity: northwind_co\nsummary: The second-floor coffee bar.",
      "Coffee Bar",
      "The espresso machine is the only thing everyone agrees on.",
      "## History\n\n- 2026-06-14 — The espresso machine breaks down and is carted off.",
    ),
    "world/entities/characters/priya-nair.md": page(
      "team: Platform\ncompany: Northwind\nhome: server_room",
      "Priya Nair",
      "A staff engineer who answers pages from the elevator.",
    ),
    "world/entities/characters/dan-okafor.md": page(
      "team: Platform\ncompany: Northwind",
      "Dan Okafor",
      "The team lead, soft-spoken and impossible to rush.",
    ),
    "world/entities/characters/lena-fischer.md": page(
      "team: Sales\ncompany: Northwind",
      "Lena Fischer",
      "A top seller who never takes her headset off.",
    ),
    "world/entities/characters/mark-silva.md": page(
      "team: Sales\ncompany: Northwind",
      "Mark Silva",
      "A cheerful account manager.",
    ),
    "world/entities/characters/grace-kim.md": page(
      "renown: famous\ncompany: Northwind\nhome: grace_office\nsummary: The CEO of Northwind.",
      "Grace Kim",
      "The founder and CEO, known for blunt all-hands.",
    ),
    "world/entities/characters/wei-zhang.md": page(
      "full_name: Wei Zhang (张伟)\nteam: Platform\ncompany: Northwind",
      "Wei Zhang",
      "A junior engineer who sends very long messages.",
    ),
    "world/entities/characters/alex.md": page(
      "name: Alex\ncompany: Northwind",
      "Alex",
      "An engineering manager.",
    ),
    "agents/priya-nair/wiki/entities/characters/alex.md": page(
      "peer_id: user:alex\nname: Alex\nrelation: manager\nsummary: My manager; means well.",
      "Alex",
      "Shields the team from most meetings. Promised me a promotion case this cycle.",
      "## What they think of me\n\nThinks I'm reliable but difficult. (think so)\n\n## Open threads\n\n- The promotion packet is still unwritten.\n\n## Notes\n\n- 2026-06-12 · seen it · sure — Cancelled our one-on-one again.",
    ),
    "agents/priya-nair/wiki/entities/characters/dan-okafor.md": page(
      "relation: team lead\nsummary: Slow, careful, usually right.",
      "Dan Okafor",
      "He reviews every line and I have stopped arguing.",
    ),
    "agents/priya-nair/wiki/entities/characters/lena-fischer.md": page(
      'relation: sparring partner\naliases: ["the Headset"]\nsummary: Promises customers things we cannot build.',
      "Lena Fischer",
      "We call her the Headset. She sold a feature that does not exist.",
      "## Notes\n\n- 2026-06-01 · told by wei-zhang · suspect — She is interviewing at Helix Labs.",
    ),
    "agents/priya-nair/wiki/concepts/deploy_checklist.md": page(
      "title: Deploy checklist",
      "Deploy checklist",
      "My own steps before a release.",
      "## Steps\n\n- Drain the canary before touching the database.\n- Never deploy with a migration pending.\n- Check the pager is on loud.",
    ),
    "agents/priya-nair/wiki/concepts/project_atlas.md": page(
      "title: Project Atlas",
      "Project Atlas",
      "A vanity project, but the only way the routing engine survives.",
      "",
    ),
    "agents/priya-nair/wiki/concepts/helix_labs.md": page(
      "title: Helix Labs",
      "Helix Labs",
      "I turned down their offer. The money was obscene and the product is a demo.",
    ),
    "agents/priya-nair/wiki/entities/places/coffee_bar.md": page(
      "learned: been there\nseen: 2026-06-01",
      "Coffee Bar",
      "The only place I talk to anyone from Sales.",
    ),
    "agents/lena-fischer/wiki/entities/characters/priya-nair.md": page(
      "relation: blocker\nsummary: Says no to everything.",
      "Priya Nair",
      "Brilliant, and the reason my deals slip.",
      "## What they think of me\n\nThinks I'm a liar with a quota. (sure)",
    ),
    "agents/lena-fischer/wiki/concepts/meridian_notes.md": page(
      "title: Meridian notes",
      "Meridian notes",
      "Their procurement lead hates long contracts and loves golf.",
    ),
    "agents/mark-silva/wiki/entities/characters/lena-fischer.md": page(
      "relation: colleague\nsummary: Top of the board.",
      "Lena Fischer",
      "Generous with leads when she is winning.",
    ),
  },
};

const KEPLER: FixtureWorld = {
  anchors: { deck: "familiar" },
  now: "2150-01-20T00:00:00Z",
  files: {
    "world/concepts/ark_kepler.md": page(
      "renown: famous\nsummary: A generation ship in its third century of flight.",
      "Ark Kepler",
      "Nine decks, four thousand people, no way home.",
    ),
    "world/concepts/lower_decks.md": page(
      "community: ark_kepler\nrenown: known\naliases: [Lowers]\nsummary: The crowded engineering decks.",
      "Lower Decks",
      "Hot, loud and proud of it.",
    ),
    "world/concepts/upper_decks.md": page(
      "community: ark_kepler\nrenown: known\naliases: [Uppers]\nsummary: The garden decks of the ship's officers.",
      "Upper Decks",
      "Real soil and quiet corridors.",
    ),
    "world/concepts/reactor_core.md": page(
      "community: lower_decks\nrenown: known\nsummary: The fusion plant that powers the ship.",
      "Reactor Core",
      "Everyone depends on it and few understand it.",
      "## Coolant leak\n\nThe third coolant loop has been leaking for a decade and the logs are falsified.",
    ),
    "world/concepts/water_ration.md": page(
      "renown: famous\nsummary: The daily water allowance for every citizen.",
      "Water Ration",
      "Issued by chit at the deck stations.",
      "## History\n\n- 2150-01-18 · news — The ration is cut by a tenth.",
    ),
    "world/concepts/mutiny_rumor.md": page(
      "renown: known\nsummary: Talk of an uprising against the officers.",
      "The Quiet Mutiny",
      "Nobody admits to having heard of it, and everybody has.",
    ),
    "world/entities/places/commons.md": page(
      "community: lower_decks\nsummary: The noisy deck three canteen.",
      "Deck Three Commons",
      "Long benches and recycled air.",
    ),
    "world/entities/places/arboretum.md": page(
      "community: upper_decks\nsummary: The officers' tree garden.",
      "Arboretum",
      "Real birds, somehow.",
    ),
    "world/entities/characters/ren-adeyemi.md": page(
      "deck: Lower Decks",
      "Ren Adeyemi",
      "A coolant tech with a shaved head.",
    ),
    "world/entities/characters/cass-holloway.md": page(
      "deck: Lower Decks\nknows: { reactor_core: intimate }",
      "Cass Holloway",
      "The reactor's night shift chief.",
    ),
    "world/entities/characters/oona-pryce.md": page(
      "deck: Upper Decks",
      "Oona Pryce",
      "A junior officer in a pressed grey uniform.",
    ),
    "agents/ren-adeyemi/wiki/entities/characters/cass-holloway.md": page(
      "relation: shift chief\nsummary: Knows more than she says.",
      "Cass Holloway",
      "She signs the coolant logs without reading them, or says she does.",
    ),
    "agents/ren-adeyemi/wiki/concepts/water_ration.md": page(
      "title: Water Ration",
      "Water Ration",
      "They cut ours first and call it fairness.",
    ),
    "agents/oona-pryce/wiki/concepts/mutiny_rumor.md": page(
      "title: The Quiet Mutiny",
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
