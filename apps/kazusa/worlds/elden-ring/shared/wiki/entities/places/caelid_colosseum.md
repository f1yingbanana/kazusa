---
pageType: entity
entityType: place
id: entity.place.caelid_colosseum
place_id: caelid_colosseum
name: "Caelid Colosseum"
aliases: ["the arena in the rot"]
parent: caelid
summary:
  "Red-grown arena in Caelid's north, where the Great Jar sits outside and asks
  for a worthy fighter."
entry_minutes: 40
map: { plane: overland, x: 0.5153, y: 0.6175 }
connections:
  - to: divine_tower_caelid
    ways:
      - { by: walk, minutes: 65 }
      - { by: horse, minutes: 35 }
  - to: fort_faroth
    ways:
      - { by: walk, minutes: 170 }
    note: "Up the long red cliff to the Dragonbarrow."
---

# Caelid Colosseum

An old sandstone arena half-buried in red weeds, and quite shut. An enormous
ancient living jar called the Great-Jar sits nearby, offering a test to those
who would come. Those who pass it get something, and those who fail don't come
back.
