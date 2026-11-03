---
pageType: entity
entityType: place
id: entity.place.arius_shelter
place_id: arius_shelter
name: "Arius Squad Shelter"
aliases: ["Arius Temporary Shelter"]
parent: arius_district
entry_minutes: 8
summary:
  "Repaired stone house near the school where four paroled students live, a
  small room each round a shared kitchen; door barred at night, Valkyrie
  check-in weekly."
renown: local
community: arius_squad
connections:
  - to: arius_school
    ways:
      - { by: walk, minutes: 6 }
    note: "Across the square to the school gate."
  - to: arius_lantern_street
    ways:
      - { by: walk, minutes: 4 }
    note: "Round the corner to the lamps."
---

# Arius Squad Shelter

An old parish house a few minutes from the school, patched with new roof tiles
and a steel door. After years of drifting between abandoned buildings, the
former Arius Squad took it over as their base when they were paroled. Each of
them has a small room off the kitchen, which is where they actually spend their
evenings.
