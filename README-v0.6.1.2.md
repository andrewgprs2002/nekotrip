# NekoTrip v0.6.1.2 — Live Route Calculating Hotfix

Fixes Live Route being stuck forever on `Calculating…`.

## Root cause
`plannedDeparture` and `plannedArrival` were rebuilt as new JavaScript `Date` objects on every TripWorkspace render. GoogleTripMap's route calculation effect depends on those values, so setting route status to `loading` caused a parent render, which generated new Date object references and restarted/cancelled the route request repeatedly.

## Fix
Memoizes the calculated departure/arrival Date values based on the actual trip-day date, selected time, and trip timezone.

## Files
- `components/trip/TripWorkspace.tsx`

No SQL migration and no npm install required.
