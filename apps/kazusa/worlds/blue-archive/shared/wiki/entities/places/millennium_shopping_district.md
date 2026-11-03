---
pageType: entity
entityType: place
id: entity.place.millennium_shopping_district
place_id: millennium_shopping_district
name: "Millennium Shopping District"
aliases: ["Millennium shopping streets"]
parent: millennium_district
entry_minutes: 4
summary:
  "Shopping streets between Millennium Station and the dormitory: a mall, family
  restaurant, karaoke, game center and cafés; most shops 10:00–22:00, busy after
  school."
renown: known
connections:
  - to: millennium_station
    ways:
      - { by: walk, minutes: 2 }
    note: "The shopping street starts at the station's east exit."
  - to: millennium_school
    ways:
      - { by: walk, minutes: 7 }
      - { by: bus, minutes: 5 }
    note:
      "Up the avenue to the campus gate; the school bus is packed at rush hour."
---

# Millennium Shopping District

A grid of clean, busy streets running from the station's east exit up the hill
toward the dormitory. The shopfronts are new, the signs are digital, and the
streets are named for scientists. After school it fills with Millennium
uniforms; at night the family restaurant and the karaoke keep it lit.
