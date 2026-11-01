---
pageType: entity
entityType: place
id: entity.place.roundtable_great_hall
place_id: roundtable_great_hall
name: "The Round Table"
aliases: ["the table", "the lobby"]
parent: roundtable_hold
summary:
  "The Hold's central round table, in a dim lamplit hall; most members sit apart
  and sharpen their bitterness."
entry_minutes: 1
renown: known
map: { plane: overland, x: 0.4700, y: 0.7200 }
connections:
  - to: hewgs_forge
    ways:
      - { by: walk, minutes: 1 }
  - to: gideons_study
    ways:
      - { by: walk, minutes: 2 }
  - to: two_fingers_chamber
    ways:
      - { by: walk, minutes: 1 }
  - to: twin_maiden_husks_room
    ways:
      - { by: walk, minutes: 1 }
  - to: fia_bedchamber
    ways:
      - { by: walk, minutes: 1 }
  - to: d_alcove
    ways:
      - { by: walk, minutes: 1 }
  - to: roundtable_cellar
    ways:
      - { by: walk, minutes: 2 }
---

# The Round Table

A large circular table with empty chairs in a dark, high-ceilinged room. Rogier
sits near the wall, Nepheli keeps to a corner, and Diallos is often here too.
This is the one room where members might actually speak to each other.
