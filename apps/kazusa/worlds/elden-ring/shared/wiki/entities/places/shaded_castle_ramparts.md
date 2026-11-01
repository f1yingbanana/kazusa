---
pageType: entity
entityType: place
id: entity.place.shaded_castle_ramparts
place_id: shaded_castle_ramparts
name: "Shaded Castle Ramparts"
aliases: ["the ramparts"]
parent: shaded_castle
summary:
  "Wet, reeking outer walls of the castle, patrolled by warders with cloths over
  their mouths."
entry_minutes: 5
map: { plane: overland, x: 0.3240, y: 0.3262 }
connections:
  - to: shaded_castle_inner_gate
    ways:
      - { by: walk, minutes: 4 }
---

# Shaded Castle Ramparts

A narrow walled path above the swamp, with rusted arbalests on the towers and a
giant blighted flower on the wall. A lift goes down inside.
