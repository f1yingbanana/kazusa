---
pageType: entity
entityType: place
id: entity.place.gehenna_backstreets
place_id: gehenna_backstreets
name: "Gehenna Zone 32 Backstreets"
parent: gehenna_district
entry_minutes: 8
summary:
  "Gehenna's shabby south end: cheap rentals, pawnshops and the bus to the Black
  Market District; rough after dark."
connections:
  - to: black_market_district
    ways:
      - { by: bus, minutes: 15 }
      - { by: walk, minutes: 35 }
    note: "South out of Gehenna into the unauthorized district."
  - to: gehenna_station
    ways:
      - { by: walk, minutes: 7 }
    note: "Up Zone 32 past the pawnshops to the station."
---

# Gehenna Zone 32 Backstreets

The last zone before Gehenna runs out: narrow streets of cheap rentals,
pawnshops, laundromats and a bus stop where the Black Market bus leaves every
fifteen minutes. Rent is low and nobody asks questions.
