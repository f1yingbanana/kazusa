---
pageType: entity
entityType: place
id: entity.place.laskyar_ruins
place_id: laskyar_ruins
name: "Laskyar Ruins"
aliases: ["Laskyar"]
parent: liurnia
summary:
  "Half-submerged ruin in the south lake; a young woman called Rya asks about a
  lost necklace nearby."
entry_minutes: 95
map: { plane: overland, x: 0.2860, y: 0.6266 }
connections:
  - to: converted_tower
    ways:
      - { by: walk, minutes: 130 }
      - { by: horse, minutes: 70 }
  - to: moonfolk_ruins
    ways:
      - { by: walk, minutes: 115 }
      - { by: horse, minutes: 60 }
  - to: main_academy_gate
    ways:
      - { by: waygate, minutes: 15 }
    note:
      "A sending gate in the ruin's cellar; it stops at the sealed gate, key or
      no key."
---

# Laskyar Ruins

A short walk from the shore, a collection of broken columns and collapsed walls.
Rya hangs about these shallows asking every passing traveller about the necklace
stolen from her, with an earnestness that is either real or very well rehearsed.
