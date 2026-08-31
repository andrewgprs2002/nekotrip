# NekoTrip v0.7.5.3 — Tabelog no-blank hotfix

Fixes the Tabelog shortcut leaving an `about:blank` tab behind.

Behavior:
1. Copy the restaurant name synchronously during the click.
2. Open `https://tabelog.com/tw/` directly in a new tab.
3. No temporary blank tab is created.

Files:
- `components/place/GooglePlaceDetailsCard.tsx`

No SQL migration and no npm install required.
