'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type SupabaseLikeError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function formatError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object') {
    const error = cause as SupabaseLikeError;
    const parts = [
      error.message,
      error.details && `Details: ${error.details}`,
      error.hint && `Hint: ${error.hint}`,
      error.code && `Code: ${error.code}`,
    ].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  return 'Unable to accept invitation.';
}

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function accept() {
    setBusy(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('accept_trip_invite', { p_token: token });
      if (error) {
        setMessage(formatError(error));
        return;
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.trip_slug) {
        setMessage('Invite was accepted but the trip could not be resolved.');
        return;
      }

      router.replace(`/trips/${result.trip_slug}`);
      router.refresh();
    } catch (cause) {
      setMessage(formatError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inviteAction">
      <button className="primaryButton" type="button" onClick={accept} disabled={busy}>
        {busy ? 'Joining…' : 'Join trip as editor'}
      </button>
      {message && <div className="statusMessage" role="status">{message}</div>}
    </div>
  );
}
