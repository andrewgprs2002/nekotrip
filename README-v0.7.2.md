# NekoTrip v0.7.2 — Wider workspace

Desktop-only layout refinement.

- Trip workspace maximum width increased substantially.
- Itinerary/place-card column grows from ~420 px to ~500–540 px on large screens.
- Map panel consumes the remaining width and gets a slightly taller viewport.
- Existing tablet/mobile responsive behavior is preserved.

## Apply
Replace `app/globals.css` in the project root with the file in this patch.
No SQL migration and no npm install are required.
Restart `npm.cmd run dev`, then hard-refresh the browser.
