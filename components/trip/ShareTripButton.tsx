'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function ShareTripButton({ tripId, userId, canInvite }: { tripId: string; userId: string; canInvite: boolean }) {
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canInvite) return null;

  async function createInvite() {
    setBusy(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('trip_invites')
        .insert({ trip_id: tripId, role: 'editor', created_by: userId })
        .select('token')
        .single();
      if (error) throw error;
      const inviteUrl = `${window.location.origin}/invite/${data.token}`;
      setUrl(inviteUrl);
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(inviteUrl);
          setMessage('One-time editor invite copied. It expires in 7 days.');
        } catch {
          setMessage('Invite created. Copy the link below.');
        }
      } else {
        setMessage('Invite created. Copy the link below.');
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to create invitation.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="shareControl">
    <button type="button" className="secondaryButton compactButton" onClick={createInvite} disabled={busy}>{busy ? 'Creating…' : 'Share trip'}</button>
    {url && <input className="inviteUrl" readOnly value={url} onFocus={(event) => event.currentTarget.select()} aria-label="Trip invite link" />}
    {message && <small className="muted">{message}</small>}
  </div>;
}
