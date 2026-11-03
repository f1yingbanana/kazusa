---
pageType: entity
entityType: place
id: entity.place.haruhabara_station
place_id: haruhabara_station
name: "Haruhabara Station"
summary:
  "Eastern Line station whose exit is guarded by the town's mascots; trains to
  D.U. Central and Millennium every 10 minutes, 05:00–00:30."
map: { x: 0.62, y: 0.43 }
connections:
  - to: haruhabara
    ways:
      - { by: walk, minutes: 2 }
    note: "The Electric Street starts at the exit."
  - to: millennium_station
    ways:
      - { by: train, minutes: 10 }
    note: "Eastern Line. Times include the average wait."
---

# Haruhabara Station

The main entrance to Electric Town. Costumed mascots wave from the exit, and the
ticket gates are papered with posters for new releases.
