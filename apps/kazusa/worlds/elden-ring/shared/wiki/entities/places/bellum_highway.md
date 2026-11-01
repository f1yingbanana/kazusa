---
pageType: entity
entityType: place
id: entity.place.bellum_highway
place_id: bellum_highway
name: "Bellum Highway"
aliases: ["the Highway", "the great road"]
parent: liurnia
summary:
  "Ancient paved road running north along Liurnia's eastern cliffs, linking
  Limgrave to Altus."
entry_minutes: 95
map: { plane: overland, x: 0.3189, y: 0.6145 }
connections:
  - to: bellum_church
    ways:
      - { by: walk, minutes: 115 }
      - { by: horse, minutes: 45 }
  - to: frenzied_flame_village
    ways:
      - { by: walk, minutes: 250 }
    note: "Up the valley behind the Highway."
  - to: jarburg
    ways:
      - { by: walk, minutes: 35 }
      - { by: horse, minutes: 17 }
---

# Bellum Highway

A broad old stone highway on the lake's east side, built when Bellum was a great
crossing of the realm. Sentries and night riders still use it. The Grand Lift of
Dectus stands at its far north end, and a Finger Reader sits at the turn near
the Liurnia Tower Bridge.
