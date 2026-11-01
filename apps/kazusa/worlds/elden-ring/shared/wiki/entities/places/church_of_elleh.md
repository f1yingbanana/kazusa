---
pageType: entity
entityType: place
id: entity.place.church_of_elleh
place_id: church_of_elleh
name: "Church of Elleh"
aliases: ["Elleh", "Elleh church"]
parent: limgrave
summary:
  "Roofless little church on the road north of the First Step, with an anvil
  outside and Kalé's fire."
entry_minutes: 25
renown: known
map: { plane: overland, x: 0.3919, y: 0.7538 }
connections:
  - to: gatefront_ruins
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 8 }
    note: "The main road west toward Stormhill."
  - to: groveside_cave
    ways:
      - { by: walk, minutes: 13 }
      - { by: horse, minutes: 6 }
  - to: artists_shack_limgrave
    ways:
      - { by: walk, minutes: 60 }
      - { by: horse, minutes: 30 }
  - to: murkwater_cave
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 16 }
  - to: summonwater_village
    ways:
      - { by: walk, minutes: 60 }
      - { by: horse, minutes: 25 }
---

# Church of Elleh

A small abandoned church whose nave is open to the sky and whose Marika statue
still stands, weathered and patient. A smith's table sits beneath an arch in the
yard, and the merchant Kalé keeps a campfire against the wall. Travellers rest
here because it is the first roof they find, even with no roof on it. A Tree
Sentinel rides the near road, which keeps most people moving.
