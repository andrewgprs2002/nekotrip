import { redirect } from 'next/navigation';
import { WishlistWorkspace } from '@/components/wishlist/WishlistWorkspace';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { loadWishlistFolders, loadWishlistItems, loadWishlistSpaces, loadWritableTrips } from '@/lib/repositories/wishlist';

export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  if (!isSupabaseConfigured()) redirect('/setup');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/wishlist');

  const [spaces, folders, items, trips] = await Promise.all([
    loadWishlistSpaces(supabase, user.id),
    loadWishlistFolders(supabase, user.id, null),
    loadWishlistItems(supabase, user.id, null),
    loadWritableTrips(supabase, user.id),
  ]);

  return <WishlistWorkspace
    userId={user.id}
    userName={user.email ?? 'Traveler'}
    initialSpaces={spaces}
    initialFolders={folders}
    initialItems={items}
    trips={trips}
  />;
}
