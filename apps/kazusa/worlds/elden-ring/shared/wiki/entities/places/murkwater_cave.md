---
pageType: entity
entityType: place
id: entity.place.murkwater_cave
place_id: murkwater_cave
name: "Murkwater Cave"
aliases: ["Patches' cave"]
parent: limgrave
summary:
  "Winding cave on the Limgrave river's upper course; a thief named Patches lies
  in wait at the bottom."
entry_minutes: 9
map: { plane: overland, x: 0.4229, y: 0.7270 }
connections:
  - to: murkwater_catacombs
    ways:
      - { by: walk, minutes: 20 }
      - { by: horse, minutes: 9 }
---

# Murkwater Cave

A cave mouth near Agheel's northern feeder streams, guarded by a few of his
bandit friends and a chest placed as bait. Patches runs his business here, sells
stolen goods, and lets himself be begged from. He will pretend to be a friend
the moment he is losing.
