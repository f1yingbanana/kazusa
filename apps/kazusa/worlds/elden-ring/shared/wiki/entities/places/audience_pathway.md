---
pageType: entity
entityType: place
id: entity.place.audience_pathway
place_id: audience_pathway
name: "Audience Pathway"
aliases: ["Rykard's hall"]
parent: volcano_manor
summary:
  "Long stone tunnel to Rykard's great cavern, its floor gritty with the bones
  of those who answered."
entry_minutes: 5
map: { plane: overland, x: 0.2589, y: 0.3385 }
connections:
  - to: rykards_cavern
    ways:
      - { by: walk, minutes: 5 }
  - to: prison_town_church
    ways:
      - { by: walk, minutes: 4 }
---

# Audience Pathway

A wide passage below the Manor leading to an audience chamber full of hot wind.
It is the way Tanith sends those she finds promising. They don't usually come
back.
