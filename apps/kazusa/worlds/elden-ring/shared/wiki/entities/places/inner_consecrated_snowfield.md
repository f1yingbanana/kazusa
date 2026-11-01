---
pageType: entity
entityType: place
id: entity.place.inner_consecrated_snowfield
place_id: inner_consecrated_snowfield
name: "Inner Consecrated Snowfield"
aliases: ["the inner field"]
parent: consecrated_snowfield
summary:
  "The white centre of the plain, a sunken frozen river-valley and the road to
  Ordina and the Derelict."
entry_minutes: 25
map: { plane: overland, x: 0.5552, y: 0.2882 }
connections:
  - to: yelough_anix_ruins
    ways:
      - { by: walk, minutes: 50 }
      - { by: horse, minutes: 30 }
  - to: cave_of_the_forlorn
    ways:
      - { by: walk, minutes: 45 }
      - { by: horse, minutes: 25 }
  - to: consecrated_snowfield_catacombs
    ways:
      - { by: walk, minutes: 45 }
      - { by: horse, minutes: 25 }
  - to: apostate_derelict
    ways:
      - { by: walk, minutes: 100 }
      - { by: horse, minutes: 55 }
  - to: ordina_liturgical_town
    ways:
      - { by: walk, minutes: 55 }
      - { by: horse, minutes: 30 }
---

# Inner Consecrated Snowfield

The Snowfield's main valley, with a frozen stream and caravan tracks that go
nowhere. Death Rite Birds hunt at night. It's quite beautiful, in a way that
stops being reassuring.
