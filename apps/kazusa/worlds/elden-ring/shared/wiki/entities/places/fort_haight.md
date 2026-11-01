---
pageType: entity
entityType: place
id: entity.place.fort_haight
place_id: fort_haight
name: "Fort Haight"
aliases: ["Haight", "Kenneth's fort", "Fort"]
parent: mistwood
summary:
  "Small hill fort on the edge of the Mistwood, once House Haight's, now overrun
  by Godrick's men."
entry_minutes: 35
map: { plane: overland, x: 0.4801, y: 0.7620 }
connections:
  - to: mistwood_ruins
    ways:
      - { by: walk, minutes: 19 }
      - { by: horse, minutes: 9 }
  - to: third_church_of_marika
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 14 }
  - to: forest_lookout_tower
    ways:
      - { by: walk, minutes: 50 }
      - { by: horse, minutes: 25 }
  - to: highroad_cave
    ways:
      - { by: walk, minutes: 85 }
      - { by: horse, minutes: 40 }
---

# Fort Haight

A square stone fort on a rise above the Mistwood, flying no banner its owner
would recognise. It was the seat of Kenneth Haight's family until Godrick's
soldiers took it, and Kenneth wants it back very much. Half of the Dectus
Medallion sits in a chest at the top of its tower, though the soldiers do not
know what it is.
