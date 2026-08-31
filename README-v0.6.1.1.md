# NekoTrip v0.6.1.1 — Route state normalization hotfix

Fixes React's controlled/uncontrolled input warning in the Day Route Planner.

## Root cause
Some `TripDay` objects can arrive without the newer route-planning fields when an older repository mapper or stale data is involved. That allowed `avoidTolls`, `avoidHighways`, or `routeTimeAnchor` to become `undefined` at runtime.

## Fix
- `lib/repositories/trips.ts` normalizes route-planning fields when loading days.
- `TripWorkspace.tsx` adds a second defensive normalization when the active day changes.
- `avoidTolls` and `avoidHighways` are always real booleans.
- `routeTimeAnchor` is always either `departure` or `arrival`.

No SQL migration and no npm install are required.
