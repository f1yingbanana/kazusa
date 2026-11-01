---
pageType: entity
entityType: place
id: entity.place.gatefront_ruins
place_id: gatefront_ruins
name: "Gatefront Ruins"
aliases: ["Gatefront"]
parent: limgrave
summary:
  "Crumbled tower and soldiers' camp on the Stormhill road, under the shadow of
  the castle."
entry_minutes: 10
map: { plane: overland, x: 0.3985, y: 0.7240 }
connections:
  - to: agheel_lake
    ways:
      - { by: walk, minutes: 11 }
      - { by: horse, minutes: 5 }
    note: "A cart track down to the lake."
  - to: stormhill_shack
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 8 }
    note: "The Stormhill road climbs the moor."
  - to: castleward_tunnel
    ways:
      - { by: walk, minutes: 30 }
      - { by: horse, minutes: 15 }
    note: "Round the base of the cliffs."
---

# Gatefront Ruins

Stumps of old walls straddling the main road where it climbs to Stormhill.
Godrick's soldiers camp in the rubble around a wagon of supplies, and a Site of
Grace burns in a sheltered corner. Everyone bound for Stormveil or the north
passes through. A cellar beneath holds a map of the region that the soldiers
guard poorly.
