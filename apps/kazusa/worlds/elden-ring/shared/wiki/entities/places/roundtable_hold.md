---
pageType: entity
entityType: place
id: entity.place.roundtable_hold
place_id: roundtable_hold
name: "Roundtable Hold"
aliases: ["the Roundtable", "the Hold"]
summary:
  "Dim copy of Leyndell's Fortified Manor, set apart from all roads; only
  Tarnished led by grace can enter. Gideon's people gather here."
entry_minutes: 1
renown: known
community: roundtable
map: { plane: overland, x: 0.4700, y: 0.7200 }
connections:
  - to: first_step
    ways:
      - { by: grace, minutes: 3 }
    note: "Only for those a Site of Grace will carry; no one walks here."
---

# Roundtable Hold

A pocket of the world that exists only for the Tarnished, modelled on the great
hall where Marika's first champions came for counsel. It can be reached only by
those invited or led by grace. Its halls are mostly empty now; the current
members are a shadow of those whose names remain on the old roster, and they
mostly avoid each other.
