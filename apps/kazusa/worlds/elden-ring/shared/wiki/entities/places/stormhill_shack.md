---
pageType: entity
entityType: place
id: entity.place.stormhill_shack
place_id: stormhill_shack
name: "Stormhill Shack"
aliases: ["Roderika's shack"]
parent: stormhill
summary:
  "Lean-to on the Stormhill road, with a grace outside and a frightened girl
  named Roderika within."
entry_minutes: 1
map: { plane: overland, x: 0.3710, y: 0.7084 }
connections:
  - to: stormgate
    ways:
      - { by: walk, minutes: 10 }
      - { by: horse, minutes: 4 }
    note: "Steep paved road to the castle arch."
  - to: warmasters_shack
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 10 }
    note: "A goat track over the moor."
  - to: stormfoot_catacombs
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 11 }
---

# Stormhill Shack

A collapsing shelter just below the Stormgate. Roderika has hidden here since
her companions were taken into the castle to be grafted, and she does not expect
anyone kind to come through the door. Most soldiers pass it by.
