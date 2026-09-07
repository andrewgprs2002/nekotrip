import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { AutoTranslate } from '@/components/i18n/AutoTranslate';
import { getServerLocale } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const locale = await getServerLocale();
  if (!isSupabaseConfigured()) redirect('/setup');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const params = await searchParams;
  const nextPath = params.next?.startsWith('/') ? params.next : '/';
  if (user) redirect(nextPath);

  return <main className="authShell">
    <section className="authCard">
      <div className="authTopRow"><div className="eyebrow">NekoTrip</div><LanguageSwitcher locale={locale} /></div>
      <h1>Sign in</h1>
      <p className="muted">No password to remember. We send a one-time verification code to your email.</p>
      <LoginForm nextPath={nextPath} />
      <AutoTranslate locale={locale} />
    </section>
  </main>;
}

