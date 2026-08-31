'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { TripRole } from '@/lib/domain/types';

export interface HomeTripRow {
  id: string;
  slug: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  role: TripRole;
}

type DialogMode = 'settings' | 'rename-confirm' | 'delete-confirm' | null;

function describeError(cause: unknown, fallback: string) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object') {
    const maybe = cause as { message?: string; details?: string; code?: string };
    return [maybe.message, maybe.details, maybe.code && `Code: ${maybe.code}`].filter(Boolean).join(' · ') || fallback;
  }
  return fallback;
}

export function TripListManager({ trips }: { trips: HomeTripRow[] }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [active, setActive] = useState<HomeTripRow | null>(null);
  const [mode, setMode] = useState<DialogMode>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [startDraft, setStartDraft] = useState('');
  const [endDraft, setEndDraft] = useState('');
  const [deleteDraft, setDeleteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function openSettings(trip: HomeTripRow) {
    setActive(trip);
    setNameDraft(trip.name);
    setStartDraft(trip.startDate ?? '');
    setEndDraft(trip.endDate ?? '');
    setDeleteDraft('');
    setMessage('');
    setMode('settings');
  }

  function close() {
    if (busy) return;
    setMode(null);
    setActive(null);
    setMessage('');
    setDeleteDraft('');
  }

  const cleanName = nameDraft.trim();
  const nameChanged = !!active && cleanName.length > 0 && cleanName !== active.name;
  const datesChanged = !!active && (startDraft || null) !== active.startDate || !!active && (endDraft || null) !== active.endDate;
  const dateRangeValid = !startDraft || !endDraft || endDraft >= startDraft;
  const canEdit = active?.role === 'owner' || active?.role === 'editor';
  const canDelete = active?.role === 'owner';

  async function confirmRename() {
    if (!active || !canEdit || !nameChanged) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('rename_trip', { p_trip_id: active.id, p_name: cleanName });
      if (error) throw error;
      setActive({ ...active, name: cleanName });
      setMode('settings');
      setMessage('Trip name updated.');
      router.refresh();
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to rename trip.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDates() {
    if (!active || !canEdit || !datesChanged || !dateRangeValid) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_trip_dates', {
        p_trip_id: active.id,
        p_start_date: startDraft || null,
        p_end_date: endDraft || null,
      });
      if (error) throw error;
      setActive({ ...active, startDate: startDraft || null, endDate: endDraft || null });
      setMessage('Trip dates updated.');
      router.refresh();
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to update trip dates.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!active || !canDelete || deleteDraft !== active.name) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('delete_trip', { p_trip_id: active.id });
      if (error) throw error;
      setMode(null);
      setActive(null);
      router.refresh();
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to delete trip.'));
      setBusy(false);
    }
  }

  if (trips.length === 0) return <div className="emptyState">No trips yet. Create the first one.</div>;

  return <>
    <div className="tripList">
      {trips.map((trip) => <div className="homeTripRow" key={trip.id}>
        <Link className="tripListItem homeTripLink" href={`/trips/${trip.slug}`}>
          <strong>{trip.name}</strong>
          <small>{trip.startDate || 'Dates TBD'}{trip.endDate ? ` → ${trip.endDate}` : ''}</small>
        </Link>
        {(trip.role === 'owner' || trip.role === 'editor') && <button className="secondaryButton compactButton" type="button" onClick={() => openSettings(trip)}>Manage</button>}
      </div>)}
    </div>

    {mode && active && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={mode === 'delete-confirm' ? 'modalCard dangerModal' : 'modalCard'} role="dialog" aria-modal="true" aria-labelledby="home-trip-settings-title">
        {mode === 'settings' && <>
          <div className="modalHeader">
            <div><div className="eyebrow">Trip settings</div><h2 id="home-trip-settings-title">Manage {active.name}</h2><p className="muted">Your role: {active.role}</p></div>
            <button type="button" className="iconButton" onClick={close} aria-label="Close trip settings">×</button>
          </div>

          <div className="settingsSection">
            <div><strong>Trip name</strong><p className="muted settingsHint">Renaming keeps the existing trip URL and invitations.</p></div>
            <input className="settingsInput" value={nameDraft} maxLength={120} onChange={(event) => { setNameDraft(event.target.value); setMessage(''); }} />
            <div className="settingsActions"><button className="primaryButton" type="button" disabled={busy || !nameChanged || cleanName.length > 120} onClick={() => { setMessage(''); setMode('rename-confirm'); }}>Review rename</button></div>
          </div>

          <div className="settingsSection">
            <div><strong>Trip dates</strong><p className="muted settingsHint">Changing departure also realigns the dates shown on Day 1, Day 2, and so on.</p></div>
            <label><span className="muted">Departure</span><input className="settingsInput" type="date" value={startDraft} onChange={(event) => { setStartDraft(event.target.value); setMessage(''); }} /></label>
            <label><span className="muted">End date</span><input className="settingsInput" type="date" value={endDraft} min={startDraft || undefined} onChange={(event) => { setEndDraft(event.target.value); setMessage(''); }} /></label>
            {!dateRangeValid && <div className="statusMessage errorText">End date cannot be before departure date.</div>}
            <div className="settingsActions"><button className="primaryButton" type="button" disabled={busy || !datesChanged || !dateRangeValid} onClick={() => void saveDates()}>{busy ? 'Saving…' : 'Save dates'}</button></div>
          </div>

          {canDelete && <div className="settingsSection dangerZone">
            <div><strong>Danger zone</strong><p className="muted settingsHint">Deleting this trip permanently removes its itinerary and memberships.</p></div>
            <button className="dangerButton" type="button" onClick={() => { setDeleteDraft(''); setMessage(''); setMode('delete-confirm'); }}>Delete entire trip…</button>
          </div>}

          {message && <div className={message.includes('updated') ? 'statusMessage' : 'statusMessage errorText'} role="status">{message}</div>}
        </>}

        {mode === 'rename-confirm' && <>
          <div className="modalHeader"><div><div className="eyebrow">Confirm rename</div><h2 id="home-trip-settings-title">Rename this trip?</h2></div><button type="button" className="iconButton" onClick={() => setMode('settings')} aria-label="Cancel rename">×</button></div>
          <div className="confirmSummary"><span>{active.name}</span><strong>→</strong><span>{cleanName}</span></div>
          <p className="muted">Other members will see the new name. The trip URL stays unchanged.</p>
          {message && <div className="statusMessage errorText">{message}</div>}
          <div className="modalActions"><button className="secondaryButton" type="button" disabled={busy} onClick={() => setMode('settings')}>Back</button><button className="primaryButton" type="button" disabled={busy || !nameChanged} onClick={() => void confirmRename()}>{busy ? 'Renaming…' : 'Confirm rename'}</button></div>
        </>}

        {mode === 'delete-confirm' && <>
          <div className="modalHeader"><div><div className="eyebrow dangerEyebrow">Permanent action</div><h2 id="home-trip-settings-title">Delete {active.name}?</h2></div><button type="button" className="iconButton" onClick={() => setMode('settings')} aria-label="Cancel delete">×</button></div>
          <p>This cannot be undone. Type the exact trip name to confirm.</p>
          <input className="settingsInput" value={deleteDraft} onChange={(event) => setDeleteDraft(event.target.value)} placeholder={active.name} autoComplete="off" autoFocus />
          {message && <div className="statusMessage errorText">{message}</div>}
          <div className="modalActions"><button className="secondaryButton" type="button" disabled={busy} onClick={() => setMode('settings')}>Back</button><button className="dangerButton solidDanger" type="button" disabled={busy || deleteDraft !== active.name} onClick={() => void confirmDelete()}>{busy ? 'Deleting…' : 'Delete trip permanently'}</button></div>
        </>}
      </section>
    </div>}
  </>;
}
