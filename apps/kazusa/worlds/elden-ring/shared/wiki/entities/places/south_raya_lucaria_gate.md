---
pageType: entity
entityType: place
id: entity.place.south_raya_lucaria_gate
place_id: south_raya_lucaria_gate
name: "South Raya Lucaria Gate"
aliases: ["the south gate"]
parent: raya_lucaria
summary:
  "Back way to the Academy, a broken postern and stairway on the island's
  southern side."
entry_minutes: 16
map: { plane: overland, x: 0.2352, y: 0.5471 }
connections:
  - to: schoolhouse_classroom
    ways:
      - { by: walk, minutes: 4 }
  - to: academy_crystal_cave
    ways:
      - { by: walk, minutes: 12 }
---

# South Raya Lucaria Gate

A second sealed gate with a Site of Grace, used by those with the key who wish
not to be seen at the first. Its stair runs up past old storehouses into the
lower courtyards.
