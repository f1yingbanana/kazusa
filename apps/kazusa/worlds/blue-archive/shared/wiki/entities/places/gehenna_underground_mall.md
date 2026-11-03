---
pageType: entity
entityType: place
id: entity.place.gehenna_underground_mall
place_id: gehenna_underground_mall
name: "Gehenna Underground Mall"
parent: gehenna_district
entry_minutes: 3
summary:
  "A long underground arcade of boutiques and snack counters beneath the
  station, with the subway to campus; open 10:00–22:00, the subway until 00:30."
renown: known
community: gehenna_academy
connections:
  - to: gehenna_station
    ways:
      - { by: walk, minutes: 2 }
    note: "Through the underground concourse."
  - to: gehenna_school
    ways:
      - { by: subway, minutes: 8 }
      - { by: walk, minutes: 15 }
    note:
      "Gehenna Subway to the stop under the campus forecourt, every 6 minutes
      05:30–00:30."
---

# Gehenna Underground Mall

A tiled underground arcade beneath the station: boutiques, accessory stalls,
snack counters and a catalogue stand. The Gehenna Subway leaves from its far end
for the academy, climbing out into daylight for the last stretch.
