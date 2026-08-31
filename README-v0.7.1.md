# NekoTrip v0.7.1 — Stop arrival & stay time

Adds per-stop stay duration and calculated arrival/departure times to the daily route.

## Behavior
- Each trip place gets a `Stay (min)` field (0–1440, 15-minute step).
- Stay duration is persisted in the existing `trip_places.planned_duration_minutes` column.
- Route leg rows show the destination arrival time.
- If a stop has a stay duration, the row also shows its departure time.
- Later stops automatically shift when an earlier stay duration changes.
- Day total now includes travel time + stop time.
- If an explicit end lodging is selected, its stay duration is not added to the day total.
- `Arrive by` back-calculation includes stop duration as well as travel duration.

## Apply
1. Run `supabase/migrations/0017_trip_place_stay_duration.sql` in Supabase SQL Editor.
2. Overwrite these files in the NekoTrip project root:
   - `components/trip/TripWorkspace.tsx`
   - `components/map/GoogleTripMap.tsx`
   - `app/globals.css`
3. No npm install is required.
4. Restart `npm.cmd run dev` and hard refresh.
