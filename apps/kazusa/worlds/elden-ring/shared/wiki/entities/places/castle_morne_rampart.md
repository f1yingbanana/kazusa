---
pageType: entity
entityType: place
id: entity.place.castle_morne_rampart
place_id: castle_morne_rampart
name: "Castle Morne Rampart"
parent: castle_morne
summary:
  "Tumbling outer wall of Morne, where Misbegotten rush along the parapets
  toward the sea-gate."
entry_minutes: 35
map: { plane: overland, x: 0.4497, y: 0.8392 }
connections:
  - to: morne_inner_keep
    ways:
      - { by: walk, minutes: 3 }
  - to: morne_tunnel
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 11 }
  - to: callu_baptismal_church
    ways:
      - { by: walk, minutes: 13 }
      - { by: horse, minutes: 6 }
---

# Castle Morne Rampart

A jagged curtain wall leading to the main keep. There are bodies at every
corner, fresh and old, and a Site of Grace burns behind a stack of crates. The
gate is locked behind whichever side is winning that hour.
