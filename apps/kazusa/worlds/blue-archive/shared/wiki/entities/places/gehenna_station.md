---
pageType: entity
entityType: place
id: entity.place.gehenna_station
place_id: gehenna_station
name: "Gehenna Central Station"
aliases: ["Zone 32-1 Station"]
summary:
  "Southern Line and Trans-Desert station in Zone 32-1: Trinity and D.U. every
  10 minutes 05:00–00:30, Abydos every 90 minutes until 21:00."
map: { x: 0.43, y: 0.73 }
connections:
  - to: gehenna_district
    ways:
      - { by: walk, minutes: 5 }
    note: "Out into Zone 32."
  - to: abydos_station
    ways:
      - { by: train, minutes: 50 }
    note:
      "Trans-Desert Railway. Few trains, so riders plan around the posted
      timetable; the time assumes they do."
---

# Gehenna Central Station

A big, grimy, baroque station in Zone 32-1. Its walls are scarred from past
shootouts and its platforms see everything from day-trippers to delinquents. The
Trans-Desert Railway leaves for Abydos from the far platform every 90 minutes,
the last at 21:00; riders plan around the posted timetable.
