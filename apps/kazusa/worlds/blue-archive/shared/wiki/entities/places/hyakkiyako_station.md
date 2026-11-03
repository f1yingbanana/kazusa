---
pageType: entity
entityType: place
id: entity.place.hyakkiyako_station
place_id: hyakkiyako_station
name: "Hyakkiyako Station"
summary:
  "Northwestern Line station with a temple-gate roof: D.U. and Shanhaijing every
  15 minutes, and the hourly tunnel train north; 05:30–23:30."
map: { x: 0.31, y: 0.32 }
connections:
  - to: hyakkiyako_district
    ways:
      - { by: walk, minutes: 5 }
    note: "Out through the lantern gate."
  - to: shanhaijing_station
    ways:
      - { by: train, minutes: 18 }
    note: "Northwestern Line. Times include the average wait."
  - to: ebisu_station
    ways:
      - { by: train, minutes: 45 }
    note:
      "Hyakkiyako North Line, through the long tunnel, hourly. Times include the
      average wait."
---

# Hyakkiyako Station

A station dressed as a temple gate, with lanterns over the platforms and tour
guides waving flags at the exit.
