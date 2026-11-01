---
pageType: entity
entityType: place
id: entity.place.sellia_backstreets
place_id: sellia_backstreets
name: "Sellia Backstreets"
aliases: ["the backstreets"]
parent: sellia_town
summary:
  "Narrow alleys behind Sellia's main street, hanging with witches' cords and
  suspended bones."
entry_minutes: 8
map: { plane: overland, x: 0.5771, y: 0.6804 }
connections:
  - to: chair_crypt_of_sellia
    ways:
      - { by: walk, minutes: 3 }
  - to: sellia_under_stair
    ways:
      - { by: walk, minutes: 4 }
  - to: sellia_crystal_tunnel
    ways:
      - { by: walk, minutes: 13 }
      - { by: horse, minutes: 6 }
  - to: church_of_the_plague
    ways:
      - { by: walk, minutes: 17 }
      - { by: horse, minutes: 8 }
---

# Sellia Backstreets

A warren of stairs and thin alleys, full of old study-rooms and the wrong kind
of quiet. Sellian Sorcerers come out of the doors when anyone passes.
