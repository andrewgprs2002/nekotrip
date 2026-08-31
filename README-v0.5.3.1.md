# NekoTrip v0.5.3.1 overlap hotfix

Fixes itinerary card controls overflowing into the map panel.

Changes:
- forces Day / Type / Stars / Order into a 2 x 2 grid on desktop
- forces all selects and order buttons to stay inside the card width
- clips accidental horizontal overflow from the itinerary panel
- stacks controls to one column on narrow screens

Apply by replacing `app/globals.css` in the NekoTrip project.
No SQL migration or npm install is needed.
