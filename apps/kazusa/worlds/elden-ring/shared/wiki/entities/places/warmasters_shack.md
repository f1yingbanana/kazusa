---
pageType: entity
entityType: place
id: entity.place.warmasters_shack
place_id: warmasters_shack
name: "Warmaster's Shack"
aliases: ["Bernahl's shack", "the Stormhill shack"]
parent: limgrave
summary:
  "Solitary hut in Stormhill's woods, where the old warmaster Bernahl sharpens
  and sells his arts."
entry_minutes: 20
map: { plane: overland, x: 0.3961, y: 0.7072 }
connections:
  - to: saintsbridge
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 13 }
    note: "Northward along the gorge."
  - to: deathtouched_catacombs
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 12 }
---

# Warmaster's Shack

A squat wooden hut beside the Saintsbridge road, smelling of whetstone and old
sweat. Knight Bernahl lodges here and teaches ashes of war to Tarnished who pay.
It looks abandoned from the road, which suits him.
