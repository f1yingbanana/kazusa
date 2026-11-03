---
pageType: entity
entityType: place
id: entity.place.abydos_border_town
place_id: abydos_border_town
name: "Abydos Border Town"
parent: abydos_town
entry_minutes: 40
summary:
  "A busier town at the district's edge: supermarket, cafés, a cycle shop. Local
  bus from Suburban Town every 30 min until 20:00, or a 40-min walk."
renown: known
connections:
  - to: abydos_suburban_town
    ways:
      - { by: bus, minutes: 18 }
      - { by: walk, minutes: 40 }
    note:
      "Local bus from the market stop, every 30 minutes until 20:00; the time
      includes the wait."
---

# Abydos Border Town

Where the desert gives out, the town comes back to life: a supermarket, cafés, a
cycle shop and pavements without sand on them. Abydos students come here for
anything the Suburban Market doesn't sell, and for the sweets.
