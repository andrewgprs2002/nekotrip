import type { SupabaseClient } from '@supabase/supabase-js';
import type { WishlistFolder, WishlistItem, WishlistTripOption } from '@/lib/domain/types';

interface WishlistItemRow {
  id: string;
  user_id: string;
  place_id: string;
  folder_id: string | null;
  category: string;
  rating: number;
  notes: string | null;
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

export async function loadWishlistFolders(client: SupabaseClient): Promise<WishlistFolder[]> {
  const { data, error } = await client
    .from('wishlist_folders')
    .select('id,user_id,parent_id,name,order_index')
    .order('order_index')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    name: row.name,
    orderIndex: row.order_index,
  }));
}

export async function loadWishlistItems(client: SupabaseClient): Promise<WishlistItem[]> {
  const { data, error } = await client
    .from('wishlist_items')
    .select(`
      id,user_id,place_id,folder_id,category,rating,notes,
      places!inner(id,provider,provider_place_id,name,formatted_address,latitude,longitude)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as WishlistItemRow[];
  return rows.flatMap((row) => row.places ? [{
    id: row.id,
    userId: row.user_id,
    placeId: row.place_id,
    folderId: row.folder_id,
    category: row.category,
    rating: row.rating,
    notes: row.notes,
    name: row.places.name,
    provider: row.places.provider,
    providerPlaceId: row.places.provider_place_id,
    formattedAddress: row.places.formatted_address,
    latitude: row.places.latitude,
    longitude: row.places.longitude,
  }] : []);
}

export async function loadWritableTrips(client: SupabaseClient, userId: string): Promise<WishlistTripOption[]> {
  const { data, error } = await client
    .from('trip_members')
    .select('trip_id,role,trips!inner(id,name,slug)')
    .eq('user_id', userId)
    .in('role', ['owner', 'editor']);
  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    trip_id: string;
    role: 'owner' | 'editor';
    trips: { id: string; name: string; slug: string } | null;
  }>).flatMap((row) => row.trips ? [{
    id: row.trips.id,
    name: row.trips.name,
    slug: row.trips.slug,
    role: row.role,
  }] : []).sort((a, b) => a.name.localeCompare(b.name));
}
