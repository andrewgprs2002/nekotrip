# NekoTrip v0.7.5 — Tabelog restaurant shortcut

Adds a Tabelog lookup shortcut to rich Wishlist place cards when the item's NekoTrip category is `Restaurant`.

## Behavior
- Restaurant card: shows `Search Tabelog ↗`
- Search query includes the saved place name and address to reduce false matches.
- Does not scrape, copy, cache, or store Tabelog ratings/reviews.
- Non-restaurant cards do not show the shortcut.

## Files
- `components/place/GooglePlaceDetailsCard.tsx`
- `components/wishlist/WishlistWorkspace.tsx`

## Install
Overwrite these two files in the NekoTrip project root.
No SQL migration and no npm install are required.
Restart `npm.cmd run dev` and hard refresh the Wishlist page.
