# NekoTrip v0.7.5.2 — Tabelog clipboard hotfix

Fixes the Restaurant Tabelog shortcut when the restaurant name was not reliably copied.

## New click flow
1. Opens a blank tab immediately to preserve browser popup permission.
2. Copies the restaurant name with `navigator.clipboard.writeText()` when available.
3. Falls back to a temporary textarea + `document.execCommand('copy')` if Clipboard API is unavailable or denied.
4. Navigates the already-open tab to `https://tabelog.com/tw/`.
5. Shows `Name copied ✓` briefly after a successful copy.

## Apply
Overwrite:
- `components/place/GooglePlaceDetailsCard.tsx`

No SQL migration and no npm install are required.
