---
pageType: entity
entityType: place
id: entity.place.prayer_room
place_id: prayer_room
name: "Prayer Room"
aliases: ["the Elphael prayer room", "the Grand Prayer Room"]
parent: elphael
summary:
  "Cathedral nave of Elphael, full of Miquella's statues and the knights' long,
  unanswered prayers."
entry_minutes: 8
map: { plane: overland, x: 0.5825, y: 0.1561 }
connections:
  - to: elphael_inner_wall
    ways:
      - { by: walk, minutes: 3 }
---

# Prayer Room

A great hall with rows of kneelers, where Haligtree Knights pray to a lord who
isn't here. They'll tell you he'll return. Millicent reaches this hall at the
end of her path.
