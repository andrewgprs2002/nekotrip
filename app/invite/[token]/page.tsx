import { redirect } from 'next/navigation';
import { AcceptInviteButton } from '@/components/invite/AcceptInviteButton';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  if (!isSupabaseConfigured()) redirect('/setup');
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  return <main className="authShell">
    <section className="authCard">
      <div className="eyebrow">NekoTrip invitation</div>
      <h1>Join this trip</h1>
      <p className="muted">Signed in as {user.email}. This invitation grants editor access and is consumed when you join.</p>
      <AcceptInviteButton token={token} />
    </section>
  </main>;
}
