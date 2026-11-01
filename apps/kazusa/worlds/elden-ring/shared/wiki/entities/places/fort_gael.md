---
pageType: entity
entityType: place
id: entity.place.fort_gael
place_id: fort_gael
name: "Fort Gael"
aliases: ["Gael"]
parent: caelid
summary:
  "Sturdy Redmane fort north of the Aeonia, where its garrison holds out against
  rot-beasts."
entry_minutes: 30
map: { plane: overland, x: 0.5042, y: 0.6937 }
connections:
  - to: gael_tunnel
    ways:
      - { by: walk, minutes: 13 }
      - { by: horse, minutes: 6 }
  - to: caelem_ruins
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 10 }
---

# Fort Gael

A large fort on a hill overlooking Caelid's central road, still flying the
Redmane colours, and held by soldiers worn down to their nerves. Radahn's lion
banners hang in rags. It was Radahn's great bulwark before his wits left him,
and the men still act as if he might come back and thank them.
