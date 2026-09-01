'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function LoginForm({ nextPath = '/' }: { nextPath?: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setBusy(true);
    setMessage('');

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
        },
      });

      if (error) throw error;

      setCode('');
      setCodeSent(true);
      setMessage('Verification code sent. Check your email and enter the code below.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to send verification code.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();

    const cleanEmail = email.trim();
    const cleanCode = code.replace(/\D/g, '');

    if (!cleanEmail || cleanCode.length < 6 || cleanCode.length > 10) return;

    setBusy(true);
    setMessage('');

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: 'email',
      });

      if (error) throw error;

      const destination = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';
      window.location.assign(destination);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to verify code.');
    } finally {
      setBusy(false);
    }
  }
  if (!codeSent) {
    return <form className="authForm" onSubmit={submit}>
      <label>
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <button className="primaryButton" type="submit" disabled={busy || !email.trim()}>
        {busy ? 'Sending…' : 'Email me a verification code'}
      </button>
      {message && <div className="statusMessage" role="status">{message}</div>}
    </form>;
  }

  return <form className="authForm" onSubmit={verifyCode}>
    <label>
      <span>Email</span>
      <input type="email" value={email} disabled />
    </label>

    <label>
      <span>Verification code</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={10}
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
        placeholder="Enter code"
        autoFocus
      />
    </label>

    <button className="primaryButton" type="submit" disabled={busy || code.length < 6 || code.length > 10}>
      {busy ? 'Verifying…' : 'Sign in'}
    </button>

    <button
      className="secondaryButton"
      type="button"
      disabled={busy}
      onClick={() => {
        setCode('');
        setCodeSent(false);
        setMessage('');
      }}
    >
      Use a different email
    </button>

    {message && <div className="statusMessage" role="status">{message}</div>}
  </form>;
}

