---
pageType: entity
entityType: place
id: entity.place.wildhunt_gate
place_id: wildhunt_gate
name: "Wild Hunt Fortress Gate"
aliases: ["Drawbridge Gatehouse"]
parent: wildhunt_school
entry_minutes: 2
summary:
  "The only gate through the walls: bag searches, confiscated pigments and mugs,
  outing passes stamped. Open 06:00–22:00; queues at 08:00 and just before
  curfew."
renown: known
community: wild_hunt_academy
connections:
  - to: wildhunt_canal_town
    ways:
      - { by: walk, minutes: 4 }
    note: "Over the drawbridge and along the moat to town."
---

# Wild Hunt Fortress Gate

A vaulted gatehouse over the drawbridge with inspection tables on both sides.
Inspectors check every bag in and out against the approved-materials list, and a
shelf behind them groans with confiscated paint tubes, mugs and worse. Outing
passes are stamped out and back; anyone late for curfew has to explain it here.
