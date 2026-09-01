import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!isSupabaseConfigured()) redirect('/setup');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const params = await searchParams;
  const nextPath = params.next?.startsWith('/') ? params.next : '/';
  if (user) redirect(nextPath);

  return <main className="authShell">
    <section className="authCard">
      <div className="eyebrow">NekoTrip</div>
      <h1>Sign in</h1>
      <p className="muted">No password to remember. We send a one-time verification code to your email.</p>
      <LoginForm nextPath={nextPath} />
    </section>
  </main>;
}
