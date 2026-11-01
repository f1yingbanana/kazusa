---
pageType: entity
entityType: place
id: entity.place.gravesite_arrival
place_id: gravesite_arrival
name: "Miquella's Arm"
aliases: ["the cross of Miquella", "the Gravesite cross", "the arrival"]
parent: gravesite_plain
summary:
  "Pale marker where Miquella's followers arrived, with his first cross standing
  in the grass."
entry_minutes: 1
map: { plane: shadow, x: 0.4383, y: 0.6288 }
connections:
  - to: scorched_ruins
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 12 }
  - to: main_gate_cross
    ways:
      - { by: walk, minutes: 45 }
      - { by: horse, minutes: 17 }
---

# Miquella's Arm

A low rise near the plain's middle. Leda, Sir Ansbach and others rest nearby, by
a cross Miquella left for them to follow. It's the closest thing to a camp they
have. Beyond, the Tower can be seen through the shadow.
