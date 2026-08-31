'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function CreateTripForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function createTrip(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('create_trip', {
        p_name: name.trim(),
        p_timezone: 'Asia/Tokyo',
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_default_days: 4,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (!created?.trip_slug) throw new Error('Trip was created but no slug was returned.');
      router.push(`/trips/${created.trip_slug}`);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to create trip.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="createTripForm" onSubmit={createTrip}>
    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Japan Winter 2026" aria-label="Trip name" />
    <div className="formRow">
      <label><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label><span>End date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
    </div>
    <button className="primaryButton" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create trip'}</button>
    {message && <div className="statusMessage" role="status">{message}</div>}
  </form>;
}
