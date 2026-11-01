---
pageType: entity
entityType: place
id: entity.place.sellia_gateway
place_id: sellia_gateway
name: "Sellia Gateway"
aliases: ["the Sellia road"]
parent: caelid
summary:
  "Rocky pass into Sellia from the Aeonia's south shore, marked by sorcerers'
  seals and red moss."
entry_minutes: 55
map: { plane: overland, x: 0.5767, y: 0.7150 }
connections:
  - to: sellia_backstreets
    ways:
      - { by: walk, minutes: 55 }
    note: "Up the switchback stair."
  - to: abandoned_cave
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 18 }
---

# Sellia Gateway

A narrow passage through a low ridge, heavy with old wards. It's the only easy
way to reach Sellia by road from the south. A pair of Nox warriors have begun to
stand guard here without any orders.
