---
pageType: entity
entityType: place
id: entity.place.central_transit_hub
place_id: central_transit_hub
name: Kivotos Central Transit Hub
summary: "A central transfer point for travel between Kivotos districts."
connections:
  - to: schale_office
    ways:
      - { by: transit, minutes: 35 }
    note: "Estimated transfer from central D.U. to the SCHALE tower on its outskirts."
---

# Kivotos Central Transit Hub

A central transfer point connecting routes across the academy city. Journey
times are approximate for the simulation and include local transfers.
