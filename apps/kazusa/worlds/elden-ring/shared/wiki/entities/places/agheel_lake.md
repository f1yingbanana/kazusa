---
pageType: entity
entityType: place
id: entity.place.agheel_lake
place_id: agheel_lake
name: "Agheel Lake"
aliases: ["the lake"]
parent: limgrave
summary:
  "Wide shallow lake of reeds and sunken ruins at Limgrave's heart; a
  burnt-winged dragon haunts it."
entry_minutes: 1
map: { plane: overland, x: 0.4113, y: 0.7288 }
connections:
  - to: dragon_burnt_ruins
    ways:
      - { by: walk, minutes: 25 }
      - { by: horse, minutes: 13 }
  - to: fort_haight
    ways:
      - { by: walk, minutes: 50 }
      - { by: horse, minutes: 20 }
    note: "The great east road runs past the lake to the fort."
  - to: limgrave_tunnels
    ways:
      - { by: walk, minutes: 5 }
      - { by: horse, minutes: 2 }
  - to: bridge_of_sacrifice
    ways:
      - { by: walk, minutes: 60 }
      - { by: horse, minutes: 25 }
    note: "South road to the Peninsula's great bridge."
  - to: waypoint_ruins
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 16 }
  - to: forlorn_hound_evergaol
    ways:
      - { by: walk, minutes: 60 }
      - { by: horse, minutes: 30 }
---

# Agheel Lake

A broad shallow water fed by rainfall and fringed with reeds, in the middle of
the plains. Rotting ruins stand in the shallows and Demi-Humans gather along the
south bank. The Flying Dragon Agheel treats the whole lake as her hunting
ground, dropping from the sky when anything large wades in. Boc the Seamster was
last seen somewhere on its east shore.
