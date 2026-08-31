# NekoTrip v0.7.0 — Place Cards
Trip and Wishlist cards now lazy-load Google Place Details near the viewport: first photo + attribution, Google rating/count, type, business status, today's hours, address, Google Maps, website, and expandable weekly hours. NekoTrip's own stars/day/category controls stay separate.

Requires existing Maps JavaScript API + Places API (New). Photo URIs are fetched fresh and are not persisted.

Overwrite the patch contents into the project root. No SQL migration and no new npm package are required.
