---
pageType: entity
entityType: place
id: entity.place.millennium_dormitory
place_id: millennium_dormitory
name: "Millennium Dormitory"
parent: millennium_district
entry_minutes: 8
summary:
  "Student dormitory across the footbridge from campus; front door 06:00–23:30,
  later entry by ID card and logged; quiet hours 23:00–07:00, no roll call."
renown: known
community: millennium_science_school
connections:
  - to: millennium_school
    ways:
      - { by: walk, minutes: 4 }
    note: "Over the footbridge to the campus north gate."
  - to: millennium_shopping_district
    ways:
      - { by: walk, minutes: 6 }
    note: "Down the hill to the shops and the station."
  - to: millennium_district_park
    ways:
      - { by: walk, minutes: 7 }
    note: "The jogging route past the canal."
---

# Millennium Dormitory

A clean, modern block on the slope above the shopping streets, joined to campus
by a covered footbridge. Rooms are singles on corridors by floor, each sharing a
kitchenette, and the basement laundry never closes. There is no roll call; the
door system simply logs who comes in after 23:30, and Seminar can read the log.
