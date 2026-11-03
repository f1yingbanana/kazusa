---
pageType: entity
entityType: place
id: entity.place.wildhunt_dorm_quarter
place_id: wildhunt_dorm_quarter
name: "Wild Hunt Dormitory Quarter"
parent: wildhunt_school
entry_minutes: 3
summary:
  "Walled residential bastion of numbered dormitories assigned by the Arts
  Council; supervisory post at the arch. Curfew 22:00, room checks at 22:30."
renown: known
community: wild_hunt_academy
connections:
  - to: wildhunt_gate
    ways:
      - { by: walk, minutes: 4 }
    note: "Along the inner wall to the gatehouse."
  - to: wildhunt_art_center
    ways:
      - { by: walk, minutes: 4 }
    note: "Through the arch and across to the studios."
  - to: wildhunt_piazza
    ways:
      - { by: walk, minutes: 2 }
    note: "Out of the arch onto the piazza."
---

# Wild Hunt Dormitory Quarter

Eight dormitories stand round a courtyard in one bastion, behind an arch watched
by the Dorm Supervisory Unit. Rooms are assigned by the Arts Council and cannot
be swapped on request, so neighbours are a matter of luck. Curfew is 22:00 and
the room check follows half an hour later.
