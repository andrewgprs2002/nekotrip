# NekoTrip v0.5.2 — Trip management on Home

This patch adds management controls directly to `http://localhost:3000` and completes date-range editing inside Trip Settings.

## New behavior

- Home trip cards now have **Manage** for owners/editors.
- Rename is available from Home and still requires a second confirmation dialog.
- Start date and end date can both be edited from Home.
- Trip Settings inside a trip now edits both start and end date.
- End date cannot be before start date.
- Changing start date re-aligns calendar dates for existing trip days.
- Owners can delete a trip from Home; deletion still requires typing the exact trip name.
- Editors can rename/edit dates, but only owners can delete.

## Database migration

Run `supabase/migrations/0012_trip_dates.sql` once in the existing Supabase project.

Do not rerun `0001_foundation.sql`.
