---
pageType: entity
entityType: place
id: entity.place.dragon_temple
place_id: dragon_temple
name: "Dragon Temple"
parent: crumbling_farum_azula
summary:
  "Great roofless temple of the dragon faith, its ramps covered in old ash,
  facing into the storm."
entry_minutes: 12
map: { plane: overland, x: 0.8408, y: 0.4871 }
connections:
  - to: dragon_temple_altar
    ways:
      - { by: walk, minutes: 3 }
  - to: dragon_temple_rooftop
    ways:
      - { by: walk, minutes: 5 }
---

# Dragon Temple

The central surviving temple of the city, a vast stone complex built on an
impossible scale. It is full of Draconic Tree Sentinels and Beastmen who still
attend its rites. The storm is visibly inside it.
