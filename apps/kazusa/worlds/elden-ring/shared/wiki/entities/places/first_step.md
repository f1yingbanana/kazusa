---
pageType: entity
entityType: place
id: entity.place.first_step
place_id: first_step
name: "The First Step"
aliases: ["First Step", "the cave mouth"]
parent: limgrave
summary:
  "Cave mouth above the Limgrave sea, where risen Tarnished first see daylight;
  a gentle Site of Grace."
entry_minutes: 30
map: { plane: overland, x: 0.3917, y: 0.7638 }
connections:
  - to: church_of_elleh
    ways:
      - { by: walk, minutes: 7 }
      - { by: horse, minutes: 3 }
    note: "Short road north through open grass."
  - to: church_of_dragon_communion
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 13 }
    note: "Along the southern shore."
  - to: coastal_cave
    ways:
      - { by: walk, minutes: 13 }
      - { by: horse, minutes: 6 }
  - to: seaside_ruins
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 12 }
  - to: fringefolk_heros_grave
    ways:
      - { by: walk, minutes: 7 }
      - { by: horse, minutes: 3 }
---

# The First Step

A grass-grown ruin at the mouth of the crypt-cave, with a Site of Grace burning
in the ground and a view north to the Erdtree. Every Tarnished woken in the
graveyard walks out here. White Mask Varré has taken to waiting on the steps to
look the newcomers over.
