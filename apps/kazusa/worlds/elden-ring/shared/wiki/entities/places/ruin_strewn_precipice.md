---
pageType: entity
entityType: place
id: entity.place.ruin_strewn_precipice
place_id: ruin_strewn_precipice
name: "Ruin-Strewn Precipice"
aliases: ["the Precipice", "the back way to Altus"]
parent: altus_plateau
summary:
  "Treacherous crumbling cliff passage from Liurnia up to Altus; ladders, bats
  and a magma wyrm."
entry_minutes: 35
renown: known
map: { plane: overland, x: 0.2888, y: 0.4096 }
connections:
  - to: altus_highway_junction
    ways:
      - { by: walk, minutes: 70 }
    note: "The hard road for those without the medallion."
  - to: lux_ruins
    ways:
      - { by: walk, minutes: 14 }
      - { by: horse, minutes: 7 }
---

# Ruin-Strewn Precipice

A narrow, cracked climb through a shattered mountain on the lake's far
north-west, the only route to Altus for those who can't work the Grand Lift.
Harpies and man-sized bats wheel over its ledges, and the Magma Wyrm Makar
sleeps in its deepest chamber.
