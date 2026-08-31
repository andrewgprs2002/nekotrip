import { redirect } from 'next/navigation';
import { WishlistWorkspace } from '@/components/wishlist/WishlistWorkspace';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { loadWishlistFolders, loadWishlistItems, loadWritableTrips } from '@/lib/repositories/wishlist';

export const dynamic = 'force-dynamic';

export default async function WishlistPage() {
  if (!isSupabaseConfigured()) redirect('/setup');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/wishlist');

  const [folders, items, trips] = await Promise.all([
    loadWishlistFolders(supabase),
    loadWishlistItems(supabase),
    loadWritableTrips(supabase, user.id),
  ]);

  return <WishlistWorkspace
    userId={user.id}
    userName={user.email ?? 'Traveler'}
    initialFolders={folders}
    initialItems={items}
    trips={trips}
  />;
}
