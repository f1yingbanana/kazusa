---
pageType: entity
entityType: place
id: entity.place.morne_inner_keep
place_id: morne_inner_keep
name: "Morne's Inner Keep"
aliases: ["Edgar's keep", "the inner keep"]
parent: castle_morne
summary:
  "Last walled corner held by Castellan Edgar, with thin rations and very few
  men left."
entry_minutes: 25
map: { plane: overland, x: 0.4144, y: 0.9053 }
connections:
  - to: castle_morne_lift
    ways:
      - { by: walk, minutes: 3 }
  - to: morne_moangrave
    ways:
      - { by: walk, minutes: 6 }
---

# Morne's Inner Keep

A bare stone hall with barricaded doors. Edgar directs the last of the garrison
from here, refusing to believe that Morne's fall is anything but a temporary
setback. Beyond the rear postern, a long stair runs down to the Misbegotten's
lion and the sea.
