---
pageType: entity
entityType: place
id: entity.place.ritou
place_id: ritou
name: "Ritou"
aliases: ["the foreigners' port"]
parent: inazuma
summary:
  "The only port open to foreigners, walled off from the rest of Narukami.
  Commission guards at the bridge."
entry_minutes: 60
renown: known
connections:
  - to: inazuma_city
    ways:
      - { by: walk, minutes: 50 }
    note: "The bridge road north, closed without a permit."
  - to: liyue_harbor
    ways:
      - { by: "the Crux Fleet's run", minutes: 2880 }
    note:
      "Two days through the storm wall. Only Beidou's ships make this crossing,
      and they do it illegally."
---

# Ritou

Bored merchants and very careful officials. You can eat here and trade here.
Going further needs a permit nobody will give you.
