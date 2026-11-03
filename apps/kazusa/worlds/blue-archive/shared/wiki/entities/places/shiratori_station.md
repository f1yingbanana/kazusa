---
pageType: entity
entityType: place
id: entity.place.shiratori_station
place_id: shiratori_station
name: "Shiratori Station"
summary:
  "Metro station under Tri-Square: the Shiratori Line to D.U. Central and
  Kanesaki Port, the outer arc to Kousagi; 05:30–00:30."
map: { x: 0.53, y: 0.52 }
connections:
  - to: tri_square
    ways:
      - { by: walk, minutes: 1 }
    note: "Up the stairs into the square."
  - to: kanesaki_port_station
    ways:
      - { by: subway, minutes: 9 }
    note: "Metro Shiratori Line. Times include the average wait."
  - to: kousagi_station
    ways:
      - { by: subway, minutes: 14 }
    note: "Metro outer arc. Times include the average wait."
---

# Shiratori Station

A clean, busy Metro station beneath Tri-Square, its exits opening straight onto
the square's fountains.
