---
pageType: entity
entityType: place
id: entity.place.church_of_pilgrimage
place_id: church_of_pilgrimage
name: "Church of Pilgrimage"
aliases: ["Pilgrimage church"]
parent: weeping_peninsula
summary:
  "Small abandoned church along the Peninsula's main road, with pilgrims' bones
  and an imp's statue."
entry_minutes: 25
map: { plane: overland, x: 0.4109, y: 0.7997 }
connections:
  - to: fourth_church_of_marika
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 18 }
  - to: tombsward_catacombs
    ways:
      - { by: walk, minutes: 17 }
      - { by: horse, minutes: 8 }
  - to: witchbane_ruins
    ways:
      - { by: walk, minutes: 40 }
      - { by: horse, minutes: 19 }
  - to: castle_morne_rampart
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 15 }
    note: "Down the eastern road to Morne."
  - to: demi_human_forest_ruins
    ways:
      - { by: walk, minutes: 14 }
      - { by: horse, minutes: 7 }
  - to: minor_erdtree_weeping
    ways:
      - { by: walk, minutes: 30 }
      - { by: horse, minutes: 14 }
  - to: tombsward_cave
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 17 }
---

# Church of Pilgrimage

A roofless church at the crossing of the Peninsula's old pilgrim paths, with a
Sacred Tear on the altar. Faded offerings litter its doorway. Whatever pilgrims
once came here for, the place no longer answers.
