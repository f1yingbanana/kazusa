---
pageType: entity
entityType: place
id: entity.place.bonny_village
place_id: bonny_village
name: "Bonny Village"
aliases: ["Bonny"]
parent: scadu_altus
summary:
  "Sunken Hornsent ravine village whose people wear masks of caterpillars and
  keep a prison below."
entry_minutes: 45
map: { plane: shadow, x: 0.5136, y: 0.5383 }
connections:
  - to: bonny_gaol
    ways:
      - { by: walk, minutes: 4 }
  - to: church_district
    ways:
      - { by: walk, minutes: 50 }
      - { by: horse, minutes: 20 }
---

# Bonny Village

A poor village of cobbled huts split by a dry ravine. The folk here wore
caterpillar masks. It was deemed unworthy even by the Hornsent, and its gaol
still holds Curseblade Labirith. The road out goes north toward the Keep.
