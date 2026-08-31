import { notFound, redirect } from 'next/navigation';
import { TripWorkspace } from '@/components/trip/TripWorkspace';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { countTripMembers, loadTripDays, loadTripPlaces } from '@/lib/repositories/trips';
import type { TripRole } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect('/setup');
  const { tripId: slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/trips/${slug}`)}`);

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id,slug,name,timezone,start_date,end_date')
    .eq('slug', slug)
    .maybeSingle();

  if (tripError) throw new Error(tripError.message);
  if (!trip) notFound();

  const [{ data: membership }, days, places, memberCount, { data: profile }] = await Promise.all([
    supabase.from('trip_members').select('role').eq('trip_id', trip.id).eq('user_id', user.id).single(),
    loadTripDays(supabase, trip.id),
    loadTripPlaces(supabase, trip.id, user.id),
    countTripMembers(supabase, trip.id),
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);

  if (!membership) notFound();

  return <TripWorkspace
    tripId={trip.id}
    tripSlug={trip.slug}
    tripName={trip.name}
    tripStartDate={trip.start_date}
    tripEndDate={trip.end_date}
    tripTimezone={trip.timezone || 'UTC'}
    userId={user.id}
    userName={profile?.display_name || user.email || 'Traveler'}
    memberRole={membership.role as TripRole}
    initialDays={days}
    initialItems={places}
    initialMemberCount={memberCount}
  />;
}
