# NekoTrip v0.7.6.2 — Tabelog + Emoji merge hotfix

Fixes a regression introduced by v0.7.6.1 where Wishlist rich cards stopped passing the restaurant name/category into `GooglePlaceDetailsCard`, which caused the Tabelog shortcut to disappear.

Preserves the expanded categorized emoji picker from v0.7.6.1.

## Apply
Overwrite:
- `components/wishlist/WishlistWorkspace.tsx`

No SQL migration. No npm install required.
