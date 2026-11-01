---
pageType: entity
entityType: place
id: entity.place.caelem_ruins
place_id: caelem_ruins
name: "Caelem Ruins"
aliases: ["Caelem"]
parent: caelid
summary:
  "Wide jumble of stones on Caelid's central road, where pumpkin-headed madmen
  shamble around a cellar."
entry_minutes: 1
map: { plane: overland, x: 0.5273, y: 0.6654 }
connections:
  - to: minor_erdtree_caelid
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 10 }
  - to: gaol_cave
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 17 }
  - to: cathedral_of_dragon_communion
    ways:
      - { by: walk, minutes: 55 }
      - { by: horse, minutes: 20 }
---

# Caelem Ruins

A sprawling ruin that used to be a walled town. Red grass grows between its
walls and bad-tempered Madmen patrol its squares. A cellar under the old temple
has been used, and is still used, by something.
