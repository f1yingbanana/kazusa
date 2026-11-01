---
pageType: entity
entityType: place
id: entity.place.main_gate_cross
place_id: main_gate_cross
name: "Main Gate Cross"
aliases: ["the road to Belurat"]
parent: gravesite_plain
summary:
  "Crossroads below Belurat's great stair, with a Miquella's cross and a fresh
  pile of dead Hornsent."
entry_minutes: 50
map: { plane: shadow, x: 0.4004, y: 0.5754 }
connections:
  - to: belurat
    ways:
      - { by: walk, minutes: 40 }
    note: "The great stair to the settlement."
  - to: three_path_cross
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 8 }
---

# Main Gate Cross

A wide paved crossing on the Tower's road. The Hornsent called it something
else. Moore has set up here with his foragers.
