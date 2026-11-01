---
pageType: entity
entityType: place
id: entity.place.main_gate_plaza
place_id: main_gate_plaza
name: "Main Gate Plaza"
parent: shadow_keep
summary:
  "Huge front court of the Keep, with lines of troops and a great gate that
  spits fire."
entry_minutes: 7
map: { plane: shadow, x: 0.4907, y: 0.4697 }
connections:
  - to: shadow_keep_main_gate
    ways:
      - { by: walk, minutes: 5 }
  - to: west_rampart
    ways:
      - { by: walk, minutes: 20 }
---

# Main Gate Plaza

A wide paved yard below the main gate, full of impaled Hornsent and burning
braziers. The Black Knight Garrew has patrolled the top of the steps for an age.
