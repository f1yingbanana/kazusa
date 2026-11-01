---
pageType: entity
entityType: place
id: entity.place.castleward_tunnel
place_id: castleward_tunnel
name: "Castleward Tunnel"
aliases: ["the castle tunnel"]
parent: stormhill
summary:
  "Low tunnel under Stormhill's cliffs, bypassing the gate road to come out
  beneath Stormveil."
entry_minutes: 8
map: { plane: overland, x: 0.3625, y: 0.7135 }
connections:
  - to: stormveil_cliffside
    ways:
      - { by: walk, minutes: 8 }
    note: "Up through the old sally port and its lift."
---

# Castleward Tunnel

A rough-hewn stretch of tunnel, once a sally port. A lift at the far end gives
out by the castle's lower walls, and a Site of Grace burns at the near mouth.
Rats and brigands hold it in shifts.
