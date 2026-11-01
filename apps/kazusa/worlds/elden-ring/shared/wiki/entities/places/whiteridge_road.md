---
pageType: entity
entityType: place
id: entity.place.whiteridge_road
place_id: whiteridge_road
name: "Whiteridge Road"
aliases: ["Whiteridge"]
parent: mountaintops_of_giants
summary:
  "Frozen road along the eastern ridge toward the Garrison and the Freezing
  Lake."
entry_minutes: 60
map: { plane: overland, x: 0.6387, y: 0.2885 }
connections:
  - to: guardians_garrison
    ways:
      - { by: walk, minutes: 10 }
      - { by: horse, minutes: 5 }
  - to: freezing_lake
    ways:
      - { by: walk, minutes: 70 }
      - { by: horse, minutes: 40 }
  - to: minor_erdtree_mountaintops
    ways:
      - { by: walk, minutes: 30 }
      - { by: horse, minutes: 17 }
---

# Whiteridge Road

A long snowbound road marked by old cairns, with giant bones along the shoulder.
Everyone who uses it is in a hurry, and nobody uses it much.
