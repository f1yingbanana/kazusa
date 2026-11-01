---
pageType: entity
entityType: place
id: entity.place.outer_wall_battleground
place_id: outer_wall_battleground
name: "Outer Wall Battleground"
aliases: ["the battleground", "the Outer Wall"]
parent: capital_outskirts
summary:
  "Wrecked siege ground just inside Leyndell's first wall, where Margit bars the
  way to the city gate."
entry_minutes: 40
map: { plane: overland, x: 0.4128, y: 0.3536 }
connections:
  - to: fortified_manor_gate
    ways:
      - { by: walk, minutes: 10 }
    note: "Through the broken outer gate, up to the inner wall."
  - to: sealed_tunnel
    ways:
      - { by: walk, minutes: 50 }
      - { by: horse, minutes: 25 }
---

# Outer Wall Battleground

A sea of ballistae, ruined siege engines and hopeless earthworks on the
capital's doorstep. Margit the Fell Omen waits again here, his gold hammer
resting on the stones, for any Tarnished who've come too far.
