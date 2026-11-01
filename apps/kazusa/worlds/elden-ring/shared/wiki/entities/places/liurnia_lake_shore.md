---
pageType: entity
entityType: place
id: entity.place.liurnia_lake_shore
place_id: liurnia_lake_shore
name: "Liurnia Lake Shore"
aliases: ["the south shore"]
parent: liurnia
summary:
  "Muddy shallows and wrecked boats below the cliffs, with sorcerers, crabs and
  walking mausoleums."
entry_minutes: 115
map: { plane: overland, x: 0.3011, y: 0.6491 }
connections:
  - to: laskyar_ruins
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 20 }
  - to: stillwater_cave
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 10 }
  - to: lakeside_crystal_cave
    ways:
      - { by: walk, minutes: 60 }
      - { by: horse, minutes: 35 }
  - to: boilprawn_shack
    ways:
      - { by: walk, minutes: 95 }
      - { by: horse, minutes: 50 }
  - to: scenic_isle
    ways:
      - { by: walk, minutes: 70 }
      - { by: horse, minutes: 40 }
  - to: gate_town_bridge
    ways:
      - { by: walk, minutes: 40 }
      - { by: horse, minutes: 17 }
  - to: east_raya_lucaria_gate
    ways:
      - { by: walk, minutes: 240 }
      - { by: horse, minutes: 130 }
    note: "Across the eastern shallows."
  - to: bellum_highway
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 10 }
    note: "The Highway starts at the top of the southern shore."
  - to: malefactors_evergaol
    ways:
      - { by: walk, minutes: 6 }
      - { by: horse, minutes: 4 }
---

# Liurnia Lake Shore

The lake's southern shallows, knee-deep and silted with drowned buildings and
flipped boats. Giant crabs root in the mud, and wandering soldiers from
Godrick's former holdings stand guard over nothing. It's easy going for those
not in a hurry.
