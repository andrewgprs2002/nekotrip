'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function LoginForm({ nextPath = '/' }: { nextPath?: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const supabase = createClient();
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', nextPath.startsWith('/') ? nextPath : '/');
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callback.toString(),
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setMessage('Magic link sent. Open the email on this same browser/device to sign in.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to send sign-in email.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="authForm" onSubmit={submit}>
    <label>
      <span>Email</span>
      <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
    </label>
    <button className="primaryButton" type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Email me a magic link'}</button>
    {message && <div className="statusMessage" role="status">{message}</div>}
  </form>;
}
