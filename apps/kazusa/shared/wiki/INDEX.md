# Kivotos Public World Wiki

Welcome to the public world knowledge base for the Kivotos simulation. This directory contains shared, canonical world information accessible to all autonomous agents across the simulation.

---

## 🏛️ World & Academy Concepts (`concepts/`)

| Article | Category | Description |
| :--- | :--- | :--- |
| [Kivotos Overview](file:///apps/kazusa/shared/wiki/concepts/kivotos_overview.md) | World Lore | Halos, student resilience, ubiquitous firearms, and SCHALE governance. |
| [Trinity General School](file:///apps/kazusa/shared/wiki/concepts/trinity_general_school.md) | Academy Lore | Tea Party, Sisterhood, Justice Task Force, and aristocratic tea culture. |
| [After-School Sweets Club](file:///apps/kazusa/shared/wiki/concepts/after_school_sweets_club.md) | Club Lore | Roster, traditions, sweets appreciation, and group dynamics. |

---

## 👥 Canon Characters (`entities/characters/`)

| Character ID | Name | Club / Role | Summary |
| :--- | :--- | :--- | :--- |
| `kazusa-kyouyama` | [Kazusa Kyouyama](file:///apps/kazusa/shared/wiki/entities/characters/kazusa-kyouyama.md) | Sweets Club (2nd Yr) | Aloof cat-eared student with an intense sweet tooth and rumors of a delinquent past. |
| `yoshimi-ibaragi` | [Yoshimi Ibaragi](file:///apps/kazusa/shared/wiki/entities/characters/yoshimi-ibaragi.md) | Sweets Club (1st Yr) | Feisty, competitive club organizer and arcade gamer passionate about dessert rankings. |
| `airi-kurimura` | [Airi Kurimura](file:///apps/kazusa/shared/wiki/entities/characters/airi-kurimura.md) | Sweets Club (1st Yr) | Sweet-tempered coordinator with an unyielding love for mint-chocolate combinations. |
| `natsu-yutori` | [Natsu Yutori](file:///apps/kazusa/shared/wiki/entities/characters/natsu-yutori.md) | Sweets Club (1st Yr) | Philosophical romantic and dairy connoisseur who views life through poetry and sugar. |
| `user:sensei` | [Sensei](file:///apps/kazusa/shared/wiki/entities/characters/sensei.md) | SCHALE Advisor | Appointed mentor to student academies across Kivotos and frequent Sweets Club visitor. |

---

## 📍 World Locations (`entities/places/`)

Places form a tree: each page's `parent` is the area it sits in, and standing in an area means its open space (the school grounds, the dorm lounge, the street). Each place connects to its parent by walking `entry_minutes`; `connections` add routes between areas and shortcuts, each with its `ways` (the first is the usual one). `aliases` are other names a character may use for a place in `where`. There are no ownership or visibility flags: whose a place is, how it is kept and when it is open are written in its description, and every entry is judged from that.

```text
Trinity General School   trinity_school         ─ Trinity Dormitory: walk 10, bike 4
├─ Main Gate             school_gate            ─ Church Street: walk 6, bike 2
├─ Rose Courtyard        school_courtyard
├─ Academic Hall         trinity_academic_hall
│  ├─ Class 1-A          class_1a
│  └─ Class 2-B          class_2b
├─ Library               school_library         (08:00–19:00)
├─ Cafeteria             school_cafeteria
└─ West Annex            west_annex
   └─ Sweets Club Room   sweets_club_room
Trinity Dormitory        trinity_dorm           ─ Angel 24: walk 5 (side gate)
├─ Dorm Kitchenette      dorm_kitchenette
├─ Kazusa's Room         dorm_room_kazusa       (locked)
├─ Airi's Room           dorm_room_airi         (locked when out)
├─ Yoshimi's Room        dorm_room_yoshimi      (often unlocked)
└─ Natsu's Room          dorm_room_natsu        (door ajar)
Church Street            church_street
├─ Pâtisserie de Trinity trinity_patisserie     (10:00–19:00)
├─ Angel 24              angel_24_trinity
├─ Game Center           trinity_game_center    (12:00–22:00)
└─ Trinity Station       trinity_station        ─ SCHALE Office: monorail 25
SCHALE Office            schale_office
```

Each character's personal wiki (`workspaces/<id>/wiki/entities/places/`) holds
cards for the places they know; a place without a card is shown in full on the
first visit. Seeded on purpose without a card, for first-visit testing: Yoshimi
has never been in the Library, Natsu never in Angel 24, Airi and Natsu never in the Game Center, and only Kazusa knows
the SCHALE Office. Test scenarios: `apps/kazusa/docs/location-scenarios.md`.


For the complete imported roster, locations, and categorized lore, see the [Kivotos wiki index](KIVOTOS_INDEX.md).
