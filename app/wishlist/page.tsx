import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { WishlistWorkspace } from '@/components/wishlist/WishlistWorkspace';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { loadWishlistFolders, loadWishlistItems, loadWishlistSpaces, loadWritableTrips } from '@/lib/repositories/wishlist';

export const dynamic = 'force-dynamic';

interface WishlistPageProps {
  searchParams: Promise<{
    space?: string | string[];
  }>;
}

export default async function WishlistPage({ searchParams }: WishlistPageProps) {
  if (!isSupabaseConfigured()) redirect('/setup');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/wishlist');

  const params = await searchParams;
  const requestedSpaceId = typeof params.space === 'string' ? params.space : null;
  const cookieStore = await cookies();
  const rememberedSpaceId = cookieStore.get('nekotrip_wishlist_space')?.value ?? null;

  // Authorization remains server/database driven. URL/cookie UUIDs are only
  // navigation preferences. A candidate is accepted only if this authenticated
  // user already has access to that Shared Wishlist.
  const [spaces, trips, { data: profile }] = await Promise.all([
    loadWishlistSpaces(supabase, user.id),
    loadWritableTrips(supabase, user.id),
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);

  const canAccessSpace = (spaceId: string | null) =>
    !!spaceId && spaces.some((space) => space.id === spaceId);

  // Explicit URL wins. Otherwise restore the last selected Shared Wishlist.
  const initialSpaceId = requestedSpaceId
    ? (canAccessSpace(requestedSpaceId) ? requestedSpaceId : null)
    : (canAccessSpace(rememberedSpaceId) ? rememberedSpaceId : null);

  if (requestedSpaceId && !initialSpaceId) {
    redirect('/wishlist');
  }

  const [folders, items] = await Promise.all([
    loadWishlistFolders(supabase, user.id, initialSpaceId),
    loadWishlistItems(supabase, user.id, initialSpaceId),
  ]);

  return <WishlistWorkspace
    userId={user.id}
    userName={profile?.display_name || 'Traveler'}
    initialSpaceId={initialSpaceId}
    initialSpaces={spaces}
    initialFolders={folders}
    initialItems={items}
    trips={trips}
  />;
}