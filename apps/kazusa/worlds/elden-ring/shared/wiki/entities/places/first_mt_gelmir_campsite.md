---
pageType: entity
entityType: place
id: entity.place.first_mt_gelmir_campsite
place_id: first_mt_gelmir_campsite
name: "First Mt. Gelmir Campsite"
aliases: ["first camp"]
parent: mt_gelmir
summary:
  "Leyndell siege-camp at the volcano's lower road, full of soldiers who have
  given up on orders."
entry_minutes: 1
map: { plane: overland, x: 0.2979, y: 0.3326 }
connections:
  - to: ninth_mt_gelmir_campsite
    ways:
      - { by: walk, minutes: 65 }
  - to: corpse_stench_shack
    ways:
      - { by: walk, minutes: 12 }
      - { by: horse, minutes: 6 }
---

# First Mt. Gelmir Campsite

A rough camp of tents and crates on the lower road, supplied irregularly from
the capital. The men have been here a long time. Patches and Anastasia have each
worked the road nearby.
