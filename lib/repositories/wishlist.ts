import type { SupabaseClient } from '@supabase/supabase-js';
import type { WishlistFolder, WishlistItem, WishlistSpace, WishlistTripOption } from '@/lib/domain/types';

interface WishlistItemRow {
  id: string;
  user_id: string;
  space_id: string | null;
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

export async function loadWishlistSpaces(client: SupabaseClient, userId: string): Promise<WishlistSpace[]> {
  const { data, error } = await client
    .from('wishlist_space_members')
    .select('space_id,role,wishlist_spaces!inner(id,name)')
    .eq('user_id', userId);
  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    space_id: string;
    role: 'owner' | 'editor' | 'viewer';
    wishlist_spaces: { id: string; name: string } | null;
  }>).flatMap((row) => row.wishlist_spaces ? [{
    id: row.wishlist_spaces.id,
    name: row.wishlist_spaces.name,
    role: row.role,
  }] : []).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadWishlistFolders(
  client: SupabaseClient,
  userId: string,
  spaceId: string | null = null,
): Promise<WishlistFolder[]> {
  let query = client
    .from('wishlist_folders')
    .select('id,user_id,space_id,parent_id,name,order_index')
    .order('order_index')
    .order('name');

  query = spaceId
    ? query.eq('space_id', spaceId)
    : query.eq('user_id', userId).is('space_id', null);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    name: row.name,
    orderIndex: row.order_index,
  }));
}

export async function loadWishlistItems(
  client: SupabaseClient,
  userId: string,
  spaceId: string | null = null,
): Promise<WishlistItem[]> {
  let query = client
    .from('wishlist_items')
    .select(`
      id,user_id,space_id,place_id,folder_id,category,rating,notes,
      places!inner(id,provider,provider_place_id,name,formatted_address,latitude,longitude)
    `)
    .order('created_at', { ascending: false });

  query = spaceId
    ? query.eq('space_id', spaceId)
    : query.eq('user_id', userId).is('space_id', null);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as WishlistItemRow[];
  return rows.flatMap((row) => row.places ? [{
    id: row.id,
    userId: row.user_id,
    spaceId: row.space_id,
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
