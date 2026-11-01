---
pageType: entity
entityType: place
id: entity.place.foot_of_the_four_belfries
place_id: foot_of_the_four_belfries
name: "Foot of the Four Belfries"
aliases: ["the belfries' foot"]
parent: liurnia
summary:
  "Rocky lakeshore hill north of the lake, climbing to the old ringed belfries
  of the Carians."
entry_minutes: 70
map: { plane: overland, x: 0.1693, y: 0.5206 }
connections:
  - to: the_four_belfries
    ways:
      - { by: walk, minutes: 35 }
  - to: ruin_strewn_precipice
    ways:
      - { by: walk, minutes: 260 }
    note: "The rough north-western climb out of the lake."
  - to: deep_ainsel_well
    ways:
      - { by: walk, minutes: 95 }
      - { by: horse, minutes: 45 }
  - to: church_of_inhibition
    ways:
      - { by: walk, minutes: 110 }
      - { by: horse, minutes: 55 }
---

# Foot of the Four Belfries

A wind-bitten rise on Liurnia's northern shore, with a path that winds up
through thin trees. A few sad riders pass by. From here, the belfries' towers
can be seen clearly on a clear morning.
