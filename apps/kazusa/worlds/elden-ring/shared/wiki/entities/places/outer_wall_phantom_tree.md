---
pageType: entity
entityType: place
id: entity.place.outer_wall_phantom_tree
place_id: outer_wall_phantom_tree
name: "Outer Wall Phantom Tree"
aliases: ["the Phantom Tree"]
parent: capital_outskirts
summary:
  "Great illusory tree under Leyndell's outer wall, a Site of Grace and the
  first post of the capital."
entry_minutes: 3
map: { plane: overland, x: 0.3889, y: 0.3978 }
connections:
  - to: outer_wall_battleground
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 13 }
  - to: minor_erdtree_outskirts
    ways:
      - { by: walk, minutes: 70 }
      - { by: horse, minutes: 35 }
  - to: hermit_merchants_shack
    ways:
      - { by: walk, minutes: 50 }
      - { by: horse, minutes: 25 }
  - to: forbidden_lands
    ways:
      - { by: walk, minutes: 140 }
      - { by: horse, minutes: 70 }
    note: "Round the capital's walls, for those without the gate."
---

# Outer Wall Phantom Tree

A huge shimmering image of an Erdtree over the road where it enters the outer
wall, with a Site of Grace at its roots. Soldiers and travellers alike gather
around it. It looks like comfort, and it may be.
