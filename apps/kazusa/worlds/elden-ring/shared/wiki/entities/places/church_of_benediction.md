---
pageType: entity
entityType: place
id: entity.place.church_of_benediction
place_id: church_of_benediction
name: "Church of Benediction"
aliases: ["Benediction"]
parent: scadu_altus
summary:
  "Hushed ruined church on the Altus, the kind of place Thiollier and his family
  would have prayed in."
entry_minutes: 90
map: { plane: shadow, x: 0.4326, y: 0.6381 }
connections:
  - to: cathedral_of_manus_metyr
    ways:
      - { by: walk, minutes: 110 }
      - { by: horse, minutes: 45 }
  - to: abyssal_woods
    ways:
      - { by: walk, minutes: 95 }
      - { by: horse, minutes: 45 }
    note: "Down the Hornsent ladder and into the dark."
---

# Church of Benediction

A pale roofless church in a small grove. It has been used by Miquella's
followers.
