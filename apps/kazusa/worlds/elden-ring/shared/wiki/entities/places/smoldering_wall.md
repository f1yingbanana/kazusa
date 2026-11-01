---
pageType: entity
entityType: place
id: entity.place.smoldering_wall
place_id: smoldering_wall
name: "Smoldering Wall"
aliases: ["the burning wall"]
parent: caelid
summary:
  "Scorched fortified wall between Limgrave and Caelid, where the Redmanes burn
  all that crosses."
entry_minutes: 16
map: { plane: overland, x: 0.5319, y: 0.6866 }
connections:
  - to: caelid_catacombs
    ways:
      - { by: walk, minutes: 55 }
      - { by: horse, minutes: 25 }
  - to: rotview_balcony
    ways:
      - { by: walk, minutes: 30 }
      - { by: horse, minutes: 14 }
---

# Smoldering Wall

A low wall of blackened stone and burning brazier-pits on Caelid's west,
intended to keep the rot from spreading to the green lands. Rot-mad dogs and
crows press against it from the far side. A Finger Reader sits nearby, in the
Redmane fashion: stubbornly. Beyond it, the red begins.
