import type { SupabaseClient } from '@supabase/supabase-js';
import type { TripDay, TripPlaceItem } from '@/lib/domain/types';

interface TripPlaceRow {
  id: string;
  trip_id: string;
  place_id: string;
  day_id: string | null;
  order_index: number;
  category: string;
  planned_duration_minutes: number | null;
  notes: string | null;
  status: TripPlaceItem['status'];
  places: {
    id: string;
    provider: string;
    provider_place_id: string | null;
    name: string;
    formatted_address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

export async function loadTripDays(client: SupabaseClient, tripId: string): Promise<TripDay[]> {
  const { data, error } = await client
    .from('trip_days')
    .select('id,trip_id,date,title,order_index,route_start_trip_place_id,route_end_trip_place_id,route_departure_time,route_arrival_time,route_time_anchor,avoid_tolls,avoid_highways')
    .eq('trip_id', tripId)
    .order('order_index');

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    date: row.date,
    title: row.title,
    orderIndex: row.order_index,
    routeStartTripPlaceId: row.route_start_trip_place_id ?? null,
    routeEndTripPlaceId: row.route_end_trip_place_id ?? null,
    routeDepartureTime: row.route_departure_time ?? null,
    routeArrivalTime: row.route_arrival_time ?? null,
    routeTimeAnchor: row.route_time_anchor === 'arrival' ? 'arrival' : 'departure',
    avoidTolls: Boolean(row.avoid_tolls),
    avoidHighways: Boolean(row.avoid_highways),
  }));
}

export async function loadTripPlaces(
  client: SupabaseClient,
  tripId: string,
  userId: string,
): Promise<TripPlaceItem[]> {
  const { data, error } = await client
    .from('trip_places')
    .select(`
      id,trip_id,place_id,day_id,order_index,category,planned_duration_minutes,notes,status,
      places!inner(id,provider,provider_place_id,name,formatted_address,latitude,longitude)
    `)
    .eq('trip_id', tripId)
    .order('order_index');

  if (error) throw error;
  const rows = (data ?? []) as unknown as TripPlaceRow[];
  const ids = rows.map((row) => row.id);
  const ratings = new Map<string, number>();

  if (ids.length > 0) {
    const { data: preferenceRows, error: preferenceError } = await client
      .from('place_preferences')
      .select('trip_place_id,rating')
      .eq('user_id', userId)
      .in('trip_place_id', ids);
    if (preferenceError) throw preferenceError;
    for (const preference of preferenceRows ?? []) {
      if (typeof preference.rating === 'number') ratings.set(preference.trip_place_id, preference.rating);
    }
  }

  return rows.flatMap((row) => {
    if (!row.places) return [];
    return [{
      id: row.id,
      tripId: row.trip_id,
      placeId: row.place_id,
      dayId: row.day_id,
      orderIndex: row.order_index,
      category: row.category,
      plannedDurationMinutes: row.planned_duration_minutes,
      notes: row.notes,
      status: row.status,
      name: row.places.name,
      provider: row.places.provider,
      providerPlaceId: row.places.provider_place_id,
      formattedAddress: row.places.formatted_address,
      latitude: row.places.latitude,
      longitude: row.places.longitude,
      priority: ratings.get(row.id) ?? 3,
    }];
  });
}

export async function countTripMembers(client: SupabaseClient, tripId: string) {
  const { count, error } = await client
    .from('trip_members')
    .select('*', { count: 'exact', head: true })
    .eq('trip_id', tripId);
  if (error) throw error;
  return count ?? 0;
}
