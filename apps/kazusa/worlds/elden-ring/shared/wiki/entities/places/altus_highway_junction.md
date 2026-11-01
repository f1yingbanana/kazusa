---
pageType: entity
entityType: place
id: entity.place.altus_highway_junction
place_id: altus_highway_junction
name: "Altus Highway Junction"
aliases: ["the Junction", "the crossroads"]
parent: altus_plateau
summary:
  "Great crossing of the plateau's roads, with a Site of Grace and soldiers on
  their way to somewhere."
entry_minutes: 2
map: { plane: overland, x: 0.3318, y: 0.3941 }
connections:
  - to: stormcaller_church
    ways:
      - { by: walk, minutes: 16 }
      - { by: horse, minutes: 8 }
  - to: forest_spanning_greatbridge
    ways:
      - { by: walk, minutes: 30 }
      - { by: horse, minutes: 12 }
    note: "The capital road, west leg."
  - to: woodfolk_ruins
    ways:
      - { by: walk, minutes: 55 }
      - { by: horse, minutes: 25 }
  - to: old_altus_tunnel
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 17 }
  - to: second_church_of_marika
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 12 }
  - to: rampartside_path
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 15 }
    note: "The capital road, east leg."
  - to: first_mt_gelmir_campsite
    ways:
      - { by: walk, minutes: 45 }
      - { by: horse, minutes: 19 }
    note: "The military road out to the mountain."
---

# Altus Highway Junction

The place where the highway from the Grand Lift meets the capital road and the
path to Mt. Gelmir. Brother Corhyn stops here for a while when he leaves the
Roundtable, looking for Goldmask, and carts of supplies for the capital pass
most days. Everybody on Altus crosses it sooner or later.
