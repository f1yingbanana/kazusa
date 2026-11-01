---
pageType: entity
entityType: place
id: entity.place.sages_chamber
place_id: sages_chamber
name: "Grand Sage's Chamber"
aliases: ["Azar's chamber"]
parent: akademiya
summary: "The private chamber of the Grand Sage. Nobody enters unannounced."
entry_minutes: 5
renown: private
connections:
  - to: sanctuary_of_surasthana
    ways:
      - { by: "the sealed stair", minutes: 2 }
    note:
      "A guarded stair behind the Grand Sage's chamber. Sealed to everyone but
      the Sages."
---

# Grand Sage's Chamber

A heavy table and a map of the Irminsul network on one wall. The windows look
down on the city, and they're thick.
