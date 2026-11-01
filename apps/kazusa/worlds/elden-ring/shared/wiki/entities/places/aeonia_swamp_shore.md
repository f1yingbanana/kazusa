---
pageType: entity
entityType: place
id: entity.place.aeonia_swamp_shore
place_id: aeonia_swamp_shore
name: "Aeonia Swamp Shore"
aliases: ["the swamp's shore"]
parent: swamp_of_aeonia
summary:
  "Northern shore of Aeonia, the safest ground on it, where a merchant's cart
  sits among bones."
entry_minutes: 17
map: { plane: overland, x: 0.5397, y: 0.7130 }
connections:
  - to: heart_of_aeonia
    ways:
      - { by: walk, minutes: 40 }
      - { by: horse, minutes: 25 }
  - to: shack_of_the_rotting
    ways:
      - { by: walk, minutes: 110 }
      - { by: horse, minutes: 70 }
---

# Aeonia Swamp Shore

A strip of slightly higher ground at the swamp's north-west. Pale fungus marks
the edge of the rot. A wandering merchant has a camp here, reasoning that
competition is thin.
