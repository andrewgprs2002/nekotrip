# NekoTrip v0.7.5.1 — Tabelog homepage + copy restaurant name

Changes the Restaurant Tabelog shortcut so it no longer launches a search result URL.

When clicked:
1. NekoTrip copies the restaurant name to the clipboard.
2. Tabelog Traditional Chinese homepage opens at https://tabelog.com/tw/
3. Paste the restaurant name into Tabelog's search box when ready.

A normal web page cannot directly fill an input on a different origin such as tabelog.com because of browser same-origin protections, unless the destination website itself supports a prefill URL parameter.

## Apply
Overwrite:
- `components/place/GooglePlaceDetailsCard.tsx`

No SQL migration and no npm install are required.
