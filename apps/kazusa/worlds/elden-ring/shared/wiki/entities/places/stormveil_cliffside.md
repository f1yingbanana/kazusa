---
pageType: entity
entityType: place
id: entity.place.stormveil_cliffside
place_id: stormveil_cliffside
name: "Stormveil Cliffside"
aliases: ["the cliffside walkway"]
parent: stormveil_castle
summary:
  "Narrow ledges and rotted scaffolding on the castle's sea face, with a Site of
  Grace among crates."
entry_minutes: 7
map: { plane: overland, x: 0.3402, y: 0.7160 }
connections:
  - to: rampart_tower
    ways:
      - { by: walk, minutes: 4 }
  - to: lake_facing_cliffs
    ways:
      - { by: walk, minutes: 40 }
      - { by: horse, minutes: 20 }
    note: "Round the castle's back on the high ledges."
---

# Stormveil Cliffside

A tangle of timber walkways and cracked stone on the outer wall, high over the
surf. Hawks nest in the beams. The route loops back into the castle and is the
favoured way for those who have no intention of knocking.
