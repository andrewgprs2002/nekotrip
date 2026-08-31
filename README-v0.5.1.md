# NekoTrip v0.5.1 — Wishlist Selection & Trip Builder

Adds a planning workflow on top of the global Wishlist:

- multi-select wishlist cards
- Select visible / Select mapped / Select map view
- batch-add selected places to an existing writable Trip
- create a brand-new Trip directly from the current selection
- selected wishes remain in the Wishlist; Trip copies are added as Unplanned
- the map viewport itself can be used as a geographic selector: pan/zoom, then press **Select map view**

## Upgrade an existing v0.5.0 database

Run only:

```text
supabase/migrations/0011_wishlist_bulk_actions.sql
```

Do not re-run `0001_foundation.sql` or `0010_global_wishlist.sql` on the existing project.

Then overwrite the project files from the v0.5.1 update patch and restart Next.js.

```powershell
Ctrl + C
npm.cmd run dev
```

No new npm package is required.

## Workflow

1. Open **Wish List**.
2. Choose a folder scope, or pan/zoom the Wishlist Map.
3. Select places with checkboxes, **Select visible**, **Select mapped**, or **Select map view**.
4. Either:
   - choose an existing Trip and press **Add selected**, or
   - press **Create Trip from selection** and supply the new Trip name/date.
5. Selected wishes remain saved globally and appear in the Trip as Unplanned places.

The batch RPC is capped at 200 wishlist items per operation.
