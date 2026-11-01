---
pageType: entity
entityType: place
id: entity.place.main_caria_manor_gate
place_id: main_caria_manor_gate
name: "Main Caria Manor Gate"
aliases: ["the manor gate"]
parent: caria_manor
summary:
  "Tall silvered gate of the Carian Manor, with blue-robed guards and a spectral
  rider beyond."
entry_minutes: 10
map: { plane: overland, x: 0.2236, y: 0.4322 }
connections:
  - to: manor_upper_level
    ways:
      - { by: walk, minutes: 3 }
  - to: manor_lower_level
    ways:
      - { by: walk, minutes: 3 }
---

# Main Caria Manor Gate

The first of the great gates of the Manor, where Carian sigils still glow
faintly along the stones. Guardsmen stand ready, loyal mostly to memory. The
interior courts begin here.
