---
pageType: entity
entityType: place
id: entity.place.purified_ruins
place_id: purified_ruins
name: "Purified Ruins"
aliases: ["the purified ruin"]
parent: liurnia
summary:
  "A cellared ruin in the west lake where something was once washed clean and
  left unexplained."
entry_minutes: 100
map: { plane: overland, x: 0.3126, y: 0.6282 }
connections:
  - to: revengers_shack
    ways:
      - { by: walk, minutes: 120 }
      - { by: horse, minutes: 60 }
  - to: converted_fringe_tower
    ways:
      - { by: walk, minutes: 140 }
      - { by: horse, minutes: 65 }
  - to: main_academy_gate
    ways:
      - { by: waygate, minutes: 15 }
    note: "A sending gate beneath the ruin."
---

# Purified Ruins

Pale stones and a low altar with an underground cellar. The site once saw some
rite of purifying that has since fallen out of memory.
