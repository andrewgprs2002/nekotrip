# NekoTrip v0.3 — Collaborative Foundation

NekoTrip v0.3 turns the Google Maps prototype into a persistent multi-user web app foundation.

## What works

- Supabase email magic-link authentication
- Server-side cookie sessions (`@supabase/ssr`)
- Create trips atomically with an owner + starter days
- Google Places search + Google Maps markers
- Persist trip places in Postgres
- Move places between days
- Delete places
- Row Level Security for owner/editor/viewer access
- One-time editor invitation links (7-day expiry)
- Realtime Postgres Changes for trip-place and membership updates
- Same trip can be open in two browsers/accounts and changes refresh automatically

## 1. Keep your Google Maps settings

Your existing `.env.local` can keep:

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=
```

## 2. Create a Supabase project

Create a project at Supabase. In **SQL Editor**, run the full contents of:

```text
supabase/migrations/0001_foundation.sql
```

This migration is intended for a fresh NekoTrip Supabase project.

## 3. Add Supabase environment variables

In Supabase, use the project's **Connect** panel to copy the Project URL and Publishable key.

Add to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Do not put a Supabase secret/service-role key in `NEXT_PUBLIC_*` variables.

## 4. Configure Auth redirect URLs

Supabase Dashboard → Authentication → URL Configuration.

For local development:

- Site URL: `http://localhost:3000`
- Redirect URL: `http://localhost:3000/**`

Magic links use PKCE and return through `/auth/callback`.

## 5. Install and run

```powershell
npm.cmd install
npm.cmd run dev
```

Open:

```text
http://localhost:3000
```

Sign in by email, create a trip, add a Google place, and use **Share trip** to create an editor invitation.

## 6. Test true collaboration locally

Use two separate browser profiles (or normal + Incognito) with two email accounts:

1. Account A creates the trip.
2. Account A presses **Share trip** and copies the invite URL.
3. Account B opens the invite URL and signs in.
4. Keep the trip open in both windows.
5. Add/delete/move a place in one window.
6. The other window should update through Supabase Realtime.

## Architecture

```text
Next.js App Router
├─ Auth / SSR cookies
├─ Trip workspace
├─ Google Maps + Places provider
└─ Supabase
   ├─ Postgres
   ├─ RLS
   ├─ Realtime
   └─ Auth
```

## Security model

- Browser receives only the Supabase **Publishable** key. RLS is the authorization boundary.
- Owner can invite users and delete the trip.
- Editor can add/move/delete itinerary places.
- Viewer can only read.
- Google Maps browser key should stay restricted to your allowed website referrers + Maps JavaScript API + Places API (New).
- Invite links are random one-time UUIDs, default to editor access, and expire after 7 days.

## Next milestone (v0.4)

- Deploy to Vercel
- Add production domains to Supabase and Google API restrictions
- Presence (“Andrew is online”)
- Member management
- Add/remove days and real calendar dates
- Drag-and-drop ordering
- Per-member preference display
- Route calculation
