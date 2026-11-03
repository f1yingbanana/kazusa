---
pageType: entity
entityType: place
id: entity.place.trinity_station
place_id: trinity_station
name: "Trinity Station"
summary:
  "Southern Line station at the foot of Trinity Street: trains to Kousagi, D.U.
  Central and Gehenna every 10 minutes, 05:00–00:30."
map: { x: 0.34, y: 0.6 }
connections:
  - to: church_street
    ways:
      - { by: walk, minutes: 3 }
    note: "Out under the glass roof onto Trinity Street."
  - to: gehenna_station
    ways:
      - { by: train, minutes: 16 }
    note: "Southern Line across the border. Times include the average wait."
---

# Trinity Station

A stone station with a glass roof at the bottom of Trinity Street. Southern Line
trains run to Kousagi and D.U. Central one way and across the border to Gehenna
the other. An arcade sits right beside the exit.
