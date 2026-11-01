---
pageType: entity
entityType: place
id: entity.place.saintsbridge
place_id: saintsbridge
name: "Saintsbridge"
parent: limgrave
summary:
  "Ruined bridge over a deep gorge, the old north road from Stormhill toward
  Liurnia."
entry_minutes: 35
map: { plane: overland, x: 0.4216, y: 0.6858 }
connections:
  - to: stormhill_evergaol
    ways:
      - { by: walk, minutes: 45 }
      - { by: horse, minutes: 20 }
  - to: limgrave_colosseum
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 13 }
  - to: lake_facing_cliffs
    ways:
      - { by: walk, minutes: 160 }
    note: "Over the broken bridge and north along the gorge."
---

# Saintsbridge

An old span with its middle missing, over a gorge at the northern edge of
Stormhill. It is the only way north for those who will not pass Stormveil,
provided one has a mount that can leap or a will to climb. A Site of Grace burns
on the near bank.
