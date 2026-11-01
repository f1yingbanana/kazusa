---
pageType: entity
entityType: place
id: entity.place.academy_gate_town
place_id: academy_gate_town
name: "Academy Gate Town"
aliases: ["Gate Town"]
parent: liurnia
summary:
  "Drowned town of servants and sorcerers below the Academy walls, half under
  water and half forgotten."
entry_minutes: 50
renown: known
map: { plane: overland, x: 0.2671, y: 0.5723 }
connections:
  - to: stargazers_ruins_liurnia
    ways:
      - { by: walk, minutes: 1 }
      - { by: horse, minutes: 1 }
  - to: main_academy_gate
    ways:
      - { by: walk, minutes: 6 }
    note: "The last stretch of the Gate Bridge."
  - to: south_raya_lucaria_gate
    ways:
      - { by: walk, minutes: 12 }
    note: "Along the island's rock to the postern."
---

# Academy Gate Town

Once the bustling town that served the Academy, now slowly sinking into the
lake. Its houses stand waist-deep, inhabited by a few stubborn glintstone miners
and old wraiths. Knight Diallos of House Hoslow has been seen here, looking lost
among the crabs. Beyond the broken waterfront, the Academy's high wall starts
abruptly.
