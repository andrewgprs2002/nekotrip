'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { TripRole } from '@/lib/domain/types';

interface TripSettingsButtonProps {
  tripId: string;
  tripName: string;
  tripStartDate: string | null;
  tripEndDate: string | null;
  memberRole: TripRole;
  onRenamed: (nextName: string) => void;
  onDatesChanged: (nextStartDate: string | null, nextEndDate: string | null) => void;
  onBeforeDelete?: () => Promise<void> | void;
}

type ModalMode = 'settings' | 'rename-confirm' | 'delete-confirm' | null;

function describeError(cause: unknown, fallback: string) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object') {
    const maybe = cause as { message?: string; details?: string; code?: string };
    return [maybe.message, maybe.details, maybe.code && `Code: ${maybe.code}`].filter(Boolean).join(' · ') || fallback;
  }
  return fallback;
}

function formatDateLabel(value: string | null) {
  if (!value) return 'Not set';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function TripSettingsButton({
  tripId,
  tripName,
  tripStartDate,
  tripEndDate,
  memberRole,
  onRenamed,
  onDatesChanged,
  onBeforeDelete,
}: TripSettingsButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<ModalMode>(null);
  const [renameDraft, setRenameDraft] = useState(tripName);
  const [startDateDraft, setStartDateDraft] = useState(tripStartDate ?? '');
  const [endDateDraft, setEndDateDraft] = useState(tripEndDate ?? '');
  const [deleteDraft, setDeleteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const canRename = memberRole === 'owner' || memberRole === 'editor';
  const canDelete = memberRole === 'owner';
  const cleanRename = renameDraft.trim();
  const renameChanged = cleanRename.length > 0 && cleanRename !== tripName;
  const normalizedStartDate = startDateDraft || null;
  const normalizedEndDate = endDateDraft || null;
  const datesChanged = normalizedStartDate !== tripStartDate || normalizedEndDate !== tripEndDate;
  const dateRangeValid = !startDateDraft || !endDateDraft || endDateDraft >= startDateDraft;
  const deleteConfirmed = deleteDraft === tripName;

  useEffect(() => {
    setRenameDraft(tripName);
  }, [tripName]);

  useEffect(() => {
    setStartDateDraft(tripStartDate ?? '');
    setEndDateDraft(tripEndDate ?? '');
  }, [tripStartDate]);

  useEffect(() => {
    setEndDateDraft(tripEndDate ?? '');
  }, [tripEndDate]);

  useEffect(() => {
    if (!mode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setMode(null);
        setMessage('');
        setDeleteDraft('');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode, busy]);

  function closeModal() {
    if (busy) return;
    setMode(null);
    setMessage('');
    setDeleteDraft('');
    setRenameDraft(tripName);
    setStartDateDraft(tripStartDate ?? '');
  }

  function openSettings() {
    setRenameDraft(tripName);
    setStartDateDraft(tripStartDate ?? '');
    setEndDateDraft(tripEndDate ?? '');
    setDeleteDraft('');
    setMessage('');
    setMode('settings');
  }

  function requestRename(event: FormEvent) {
    event.preventDefault();
    if (!canRename || !renameChanged || cleanRename.length > 120) return;
    setMessage('');
    setMode('rename-confirm');
  }

  async function confirmRename() {
    if (!canRename || !renameChanged) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('rename_trip', {
        p_trip_id: tripId,
        p_name: cleanRename,
      });
      if (error) throw error;
      const nextName = typeof data === 'string' && data.trim() ? data.trim() : cleanRename;
      onRenamed(nextName);
      setRenameDraft(nextName);
      setMode(null);
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to rename trip.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDates() {
    if (!canRename || !datesChanged || !dateRangeValid) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_trip_dates', {
        p_trip_id: tripId,
        p_start_date: normalizedStartDate,
        p_end_date: normalizedEndDate,
      });
      if (error) throw error;
      onDatesChanged(normalizedStartDate, normalizedEndDate);
      setStartDateDraft(normalizedStartDate ?? '');
      setEndDateDraft(normalizedEndDate ?? '');
      setMessage('Trip dates updated. Day dates were realigned to the departure date.');
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to update trip dates.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!canDelete || !deleteConfirmed) return;
    setBusy(true);
    setMessage('');
    try {
      await onBeforeDelete?.();
      const { error } = await supabase.rpc('delete_trip', { p_trip_id: tripId });
      if (error) throw error;
      router.replace('/');
      router.refresh();
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to delete trip.'));
      setBusy(false);
    }
  }

  if (!canRename) return null;

  return <>
    <button className="secondaryButton compactButton" type="button" onClick={openSettings}>Trip settings</button>

    {mode && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeModal();
    }}>
      <section className={mode === 'delete-confirm' ? 'modalCard dangerModal' : 'modalCard'} role="dialog" aria-modal="true" aria-labelledby="trip-settings-title">
        {mode === 'settings' && <>
          <div className="modalHeader">
            <div>
              <div className="eyebrow">Trip settings</div>
              <h2 id="trip-settings-title">Manage {tripName}</h2>
            </div>
            <button type="button" className="iconButton" onClick={closeModal} aria-label="Close trip settings">×</button>
          </div>

          <form className="settingsSection" onSubmit={requestRename}>
            <div>
              <strong>Trip name</strong>
              <p className="muted settingsHint">Renaming does not change the trip URL or existing invite links.</p>
            </div>
            <input
              className="settingsInput"
              value={renameDraft}
              onChange={(event) => { setRenameDraft(event.target.value); setMessage(''); }}
              maxLength={120}
              aria-label="New trip name"
              autoFocus
            />
            <div className="settingsActions">
              <button className="primaryButton" type="submit" disabled={!renameChanged || cleanRename.length > 120}>Review rename</button>
            </div>
          </form>

          <div className="settingsSection">
            <div>
              <strong>Trip dates</strong>
              <p className="muted settingsHint">Edit departure and end date independently. Day 1, Day 2, and later calendar dates follow the departure date.</p>
            </div>
            <label>
              <span className="muted">Departure date</span>
              <input className="settingsInput" type="date" value={startDateDraft} onChange={(event) => { setStartDateDraft(event.target.value); setMessage(''); }} aria-label="Trip departure date" />
            </label>
            <label>
              <span className="muted">End date</span>
              <input className="settingsInput" type="date" value={endDateDraft} min={startDateDraft || undefined} onChange={(event) => { setEndDateDraft(event.target.value); setMessage(''); }} aria-label="Trip end date" />
            </label>
            {!dateRangeValid && <div className="statusMessage errorText">End date cannot be before departure date.</div>}
            <div className="settingsActions">
              <button className="primaryButton" type="button" disabled={busy || !datesChanged || !dateRangeValid} onClick={() => void saveDates()}>
                {busy ? 'Saving…' : 'Save dates'}
              </button>
            </div>
          </div>

          {canDelete && <div className="settingsSection dangerZone">
            <div>
              <strong>Danger zone</strong>
              <p className="muted settingsHint">Deleting a trip permanently removes its itinerary, days, memberships, invitations, preferences, and activity history.</p>
            </div>
            <button type="button" className="dangerButton" onClick={() => { setMessage(''); setDeleteDraft(''); setMode('delete-confirm'); }}>Delete entire trip…</button>
          </div>}

          {message && <div className={message.includes('updated') ? 'statusMessage' : 'statusMessage errorText'} role="status">{message}</div>}
        </>}

        {mode === 'rename-confirm' && <>
          <div className="modalHeader">
            <div>
              <div className="eyebrow">Confirm rename</div>
              <h2 id="trip-settings-title">Rename this trip?</h2>
            </div>
            <button type="button" className="iconButton" onClick={closeModal} aria-label="Cancel rename">×</button>
          </div>
          <div className="confirmSummary">
            <span>{tripName}</span>
            <strong>→</strong>
            <span>{cleanRename}</span>
          </div>
          <p className="muted">Other members will see the new name. The trip slug and URL stay unchanged.</p>
          {message && <div className="statusMessage errorText" role="alert">{message}</div>}
          <div className="modalActions">
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => { setMessage(''); setMode('settings'); }}>Back</button>
            <button type="button" className="primaryButton" disabled={busy} onClick={() => void confirmRename()}>{busy ? 'Renaming…' : 'Confirm rename'}</button>
          </div>
        </>}

        {mode === 'delete-confirm' && <>
          <div className="modalHeader">
            <div>
              <div className="eyebrow dangerEyebrow">Permanent action</div>
              <h2 id="trip-settings-title">Delete {tripName}?</h2>
            </div>
            <button type="button" className="iconButton" onClick={closeModal} aria-label="Cancel delete">×</button>
          </div>
          <p>This cannot be undone. Everyone with access will lose this trip and its itinerary.</p>
          <label className="confirmLabel">
            <span>Type <strong>{tripName}</strong> to confirm</span>
            <input
              className="settingsInput"
              value={deleteDraft}
              onChange={(event) => { setDeleteDraft(event.target.value); setMessage(''); }}
              placeholder={tripName}
              autoComplete="off"
              autoFocus
            />
          </label>
          {message && <div className="statusMessage errorText" role="alert">{message}</div>}
          <div className="modalActions">
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => { setMessage(''); setDeleteDraft(''); setMode('settings'); }}>Back</button>
            <button type="button" className="dangerButton solidDanger" disabled={busy || !deleteConfirmed} onClick={() => void confirmDelete()}>{busy ? 'Deleting…' : 'Delete trip permanently'}</button>
          </div>
        </>}
      </section>
    </div>}
  </>;
}
