---
pageType: entity
entityType: place
id: entity.place.kousagi_station
place_id: kousagi_station
name: "Kousagi Station"
summary:
  "D.U.'s southern rail gateway: Metro to downtown, Southern Line to Trinity and
  Gehenna, the Trans-Desert branch to Abydos; Metro 05:30–00:30."
map: { x: 0.43, y: 0.53 }
connections:
  - to: kousagi_station_street
    ways:
      - { by: walk, minutes: 1 }
    note: "Straight out of the ticket gates."
  - to: trinity_station
    ways:
      - { by: train, minutes: 18 }
    note: "Southern Line. Times include the average wait."
  - to: gehenna_station
    ways:
      - { by: train, minutes: 30 }
    note: "Southern Line through train. Times include the average wait."
  - to: abydos_station
    ways:
      - { by: train, minutes: 50 }
    note:
      "Trans-Desert Railway, D.U. branch, every 90 minutes. Few trains, so
      riders plan around the posted timetable; the time assumes they do."
---

# Kousagi Station

A modest station on D.U.'s southern edge that punches above its size: two
high-speed platforms where southbound trains leave the capital, and a Metro
level beneath. A police box stands out front. From the exit, SCHALE's building
is visible up the hill.
