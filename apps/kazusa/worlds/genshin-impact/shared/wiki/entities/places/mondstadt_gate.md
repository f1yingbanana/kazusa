---
pageType: entity
entityType: place
id: entity.place.mondstadt_gate
place_id: mondstadt_gate
name: "Mondstadt City Gate"
aliases: ["the bridge gate"]
parent: mondstadt_city
summary:
  "The city's only landward gate, at the end of the long bridge over Cider Lake."
entry_minutes: 3
renown: known
connections:
  - to: windrise
    ways:
      - { by: walk, minutes: 35 }
    note: "The main road out of the city."
  - to: springvale
    ways:
      - { by: walk, minutes: 40 }
    note: "South road, past the fields."
  - to: dawn_winery
    ways:
      - { by: walk, minutes: 50 }
    note: "East road, through the vineyards."
  - to: falcon_coast
    ways:
      - { by: walk, minutes: 60 }
    note: "West road to the sea."
---

# Mondstadt City Gate

Guards who know everybody by name, and a bridge that catches every gust. Carts
queue here at dawn.
