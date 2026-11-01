---
pageType: entity
entityType: place
id: entity.place.forbidden_lands
place_id: forbidden_lands
name: "Forbidden Lands"
aliases: ["the Forbidden Lands"]
summary:
  "Wind-scoured cold road east of the capital, with black-clad Vulgar Militia
  and the Rold lift at its end."
entry_minutes: 1
renown: known
community: realm_altus
map: { plane: overland, x: 0.5221, y: 0.3981 }
connections:
  - to: divine_tower_east_altus
    ways:
      - { by: walk, minutes: 40 }
      - { by: horse, minutes: 20 }
  - to: grand_lift_of_rold
    ways:
      - { by: walk, minutes: 40 }
      - { by: horse, minutes: 15 }
---

# Forbidden Lands

A long bare road running up from the capital's rear gate to the Grand Lift of
Rold. The cold starts here and doesn't let up. Night's Cavalry ride on it, and a
Black Blade Kindred sits at the top.
