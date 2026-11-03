---
pageType: entity
entityType: place
id: entity.place.trinity_old_quarters
place_id: trinity_old_quarters
name: "Old Living Quarters"
parent: trinity_residential
entry_minutes: 10
summary:
  "Old, half-empty brick dorm at the far end of the quarter: fireplace room,
  creaky stairs, rats in the walls; door locked 21:30–06:00, strict roll call at
  21:30."
renown: local
community: trinity_general_school
connections:
  - to: school_gate
    ways:
      - { by: walk, minutes: 12 }
      - { by: bike, minutes: 5 }
    note: "The long way up through the quarter to the main gate."
  - to: trinity_hospital
    ways:
      - { by: walk, minutes: 3 }
    note: "Across the lane; handy for Knights on shift."
  - to: church_street
    ways:
      - { by: walk, minutes: 10 }
    note: "Down the back lane past the hospital wall to Trinity Street."
---

# Old Living Quarters

The oldest dorm in Trinity: a brick building with creaky stairs, thin walls,
draughty windows and rats in the walls. Most students would rather live anywhere
else, so it is nearly empty. Its few residents get a fireplace room, a laundry
room and the quiet. It stands across the lane from Saint Teresa General
Hospital, which suits the Remedial Knights who live here.

The dorm mother is strict: the door locks at 21:30, and roll call goes from the
top floor down. The attic at the end of the top floor is reached by the
emergency stairs.
