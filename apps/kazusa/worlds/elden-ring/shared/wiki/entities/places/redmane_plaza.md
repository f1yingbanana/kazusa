---
pageType: entity
entityType: place
id: entity.place.redmane_plaza
place_id: redmane_plaza
name: "Redmane Castle Plaza"
aliases: ["the festival square"]
parent: redmane_castle
summary:
  "Great open square of Redmane, where the festival's crowds of warriors and
  hawkers are gathering."
entry_minutes: 8
map: { plane: overland, x: 0.6213, y: 0.7572 }
connections:
  - to: chamber_outside_plaza
    ways:
      - { by: walk, minutes: 3 }
  - to: wailing_dunes
    ways:
      - { by: waygate, minutes: 2 }
    note: "The sending gate at the foot of the castle lift."
---

# Redmane Castle Plaza

The wide cobbled yard at the castle's heart, where the Radahn Festival will be
declared. Jerren's herald shouts from the steps. Champions from all over have
come, including Blaidd the Half-Wolf, Alexander, and those with a lot to prove.
