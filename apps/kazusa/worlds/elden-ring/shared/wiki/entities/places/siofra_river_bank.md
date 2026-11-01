---
pageType: entity
entityType: place
id: entity.place.siofra_river_bank
place_id: siofra_river_bank
name: "Siofra River Bank"
aliases: ["the bank"]
parent: siofra_river
summary:
  "First landing at the bottom of the great well-lift, under a blue-glowing
  starry cave roof."
entry_minutes: 4
map: { plane: underground, x: 0.5113, y: 0.7234 }
connections:
  - to: worshippers_woods
    ways:
      - { by: walk, minutes: 30 }
      - { by: horse, minutes: 15 }
  - to: caelid_colosseum
    ways:
      - { by: lift, minutes: 40 }
    note:
      "A forgotten lift, up from the river to the red weeds before the arena."
---

# Siofra River Bank

A broad shore of pale stone and glowing plants at the bottom of the Limgrave
lift. Most visitors stop here for a moment to wonder about the sky. A Nox-built
road runs along it.
