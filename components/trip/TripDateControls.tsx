'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TripRole } from '@/lib/domain/types';

interface TripDateControlsProps {
  tripId: string;
  startDate: string | null;
  endDate: string | null;
  memberRole: TripRole;
  onDatesChanged: (nextStartDate: string | null, nextEndDate: string | null) => void | Promise<void>;
}

function describeError(cause: unknown, fallback: string) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object') {
    const maybe = cause as { message?: string; details?: string; code?: string };
    return [maybe.message, maybe.details, maybe.code && `Code: ${maybe.code}`]
      .filter(Boolean)
      .join(' · ') || fallback;
  }
  return fallback;
}

export function TripDateControls({
  tripId,
  startDate,
  endDate,
  memberRole,
  onDatesChanged,
}: TripDateControlsProps) {
  const supabase = useMemo(() => createClient(), []);
  const canEdit = memberRole === 'owner' || memberRole === 'editor';

  const [startDraft, setStartDraft] = useState(startDate ?? '');
  const [endDraft, setEndDraft] = useState(endDate ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setStartDraft(startDate ?? ''), [startDate]);
  useEffect(() => setEndDraft(endDate ?? ''), [endDate]);

  const normalizedStart = startDraft || null;
  const normalizedEnd = endDraft || null;
  const changed = normalizedStart !== startDate || normalizedEnd !== endDate;
  const valid = !startDraft || !endDraft || endDraft >= startDraft;

  async function save() {
    if (!canEdit || busy || !changed || !valid) return;

    const warning =
      'Change Trip dates?\n\n' +
      'The itinerary day count will be adjusted automatically. ' +
      'If the Trip becomes shorter, places assigned to removed days will be moved to Unplanned.';

    if (!window.confirm(warning)) return;

    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('update_trip_dates', {
        p_trip_id: tripId,
        p_start_date: normalizedStart,
        p_end_date: normalizedEnd,
      });
      if (error) throw error;

      await onDatesChanged(normalizedStart, normalizedEnd);
      setMessage('Trip dates updated.');
    } catch (cause) {
      setMessage(describeError(cause, 'Unable to update Trip dates.'));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="tripInlineDates tripInlineDatesReadOnly">
        <span>{startDate ?? 'No start date'}</span>
        <span>→</span>
        <span>{endDate ?? 'No end date'}</span>
      </div>
    );
  }

  return (
    <div className="tripInlineDates" aria-label="Trip dates">
      <label>
        <span>Start</span>
        <input
          type="date"
          value={startDraft}
          onChange={(event) => {
            setStartDraft(event.target.value);
            setMessage('');
          }}
          aria-label="Trip start date"
        />
      </label>

      <span className="tripInlineDateArrow">→</span>

      <label>
        <span>End</span>
        <input
          type="date"
          value={endDraft}
          min={startDraft || undefined}
          onChange={(event) => {
            setEndDraft(event.target.value);
            setMessage('');
          }}
          aria-label="Trip end date"
        />
      </label>

      <button
        type="button"
        className="secondaryButton compactButton"
        disabled={busy || !changed || !valid}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Update dates'}
      </button>

      {!valid && <small className="errorText">End date cannot be before start date.</small>}
      {message && <small className={message.includes('updated') ? 'muted' : 'errorText'}>{message}</small>}
    </div>
  );
}
