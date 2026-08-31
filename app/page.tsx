import Link from 'next/link';
import { CreateTripForm } from '@/components/home/CreateTripForm';
import { TripListManager, type HomeTripRow } from '@/components/home/TripListManager';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import type { TripRole } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return <main className="homeShell">
      <div className="heroCard">
        <div className="eyebrow">NekoTrip</div>
        <h1>Collaborative foundation is ready.</h1>
        <p>Google Maps is wired. Add Supabase credentials to unlock accounts, persistent trips, invitations, and realtime editing.</p>
        <Link className="primaryLink" href="/setup">Open setup checklist</Link>
      </div>
    </main>;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <main className="homeShell">
      <div className="heroCard">
        <div className="eyebrow">NekoTrip</div>
        <h1>Trips, planned together.</h1>
        <p>Shared itinerary, Google Places, live map markers, and realtime collaboration.</p>
        <Link className="primaryLink" href="/login">Sign in</Link>
      </div>
    </main>;
  }

  const [{ data: trips, error }, { data: memberships }] = await Promise.all([
    supabase.from('trips').select('id,slug,name,start_date,end_date,updated_at').order('updated_at', { ascending: false }),
    supabase.from('trip_members').select('trip_id,role').eq('user_id', user.id),
  ]);

  const roleByTrip = new Map((memberships ?? []).map((membership) => [membership.trip_id, membership.role as TripRole]));
  const managedTrips: HomeTripRow[] = (trips ?? []).map((trip) => ({
    id: trip.id,
    slug: trip.slug,
    name: trip.name,
    startDate: trip.start_date,
    endDate: trip.end_date,
    role: roleByTrip.get(trip.id) ?? 'viewer',
  }));

  return <main className="homeShell">
    <header className="homeHeader">
      <div><div className="eyebrow">NekoTrip · Collaborative</div><h1>Your trips</h1><p className="muted">Signed in as {user.email}</p></div>
      <div className="headerActions"><Link className="secondaryLink" href="/wishlist">Wish List</Link><SignOutButton /></div>
    </header>

    <div className="homeGrid">
      <section className="panel">
        <h2>Create a trip</h2>
        <p className="muted">The creator becomes owner automatically. Four starter days are created for you.</p>
        <CreateTripForm />
      </section>
      <section className="panel">
        <h2>Trips you can access</h2>
        <p className="muted">Open a trip or manage its name and date range directly here.</p>
        {error && <div className="statusMessage">{error.message}</div>}
        <TripListManager trips={managedTrips} />
      </section>
    </div>
  </main>;
}
