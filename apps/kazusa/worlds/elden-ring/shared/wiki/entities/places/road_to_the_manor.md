---
pageType: entity
entityType: place
id: entity.place.road_to_the_manor
place_id: road_to_the_manor
name: "Road to the Manor"
aliases: ["the manor road"]
parent: caria_manor
summary:
  "Wooded road winding up from the lakeshore toward the Carian Manor, full of
  old wards."
entry_minutes: 25
map: { plane: overland, x: 0.2064, y: 0.4489 }
connections:
  - to: main_caria_manor_gate
    ways:
      - { by: walk, minutes: 6 }
  - to: slumbering_wolfs_shack
    ways:
      - { by: walk, minutes: 170 }
      - { by: horse, minutes: 80 }
---

# Road to the Manor

A pretty trail between tall trees and overgrown marble. The woods here are
unsettlingly quiet and, once a traveller is far enough in, hands begin crawling
from the undergrowth. War Counselor Iji has his forge by the road near the end
of it, and a Site of Grace burns just before the worst.
