'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { resetNekoTripOnboarding } from '@/components/onboarding/OnboardingTour';

export function ProfileButton() {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void (async () => {
      setBusy(true);
      setMessage('');
      try {
        const { data, error } = await supabaseRef.current!.rpc('get_my_profile');
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!cancelled) {
          setNickname((row?.nickname ?? '') as string);
          setEmail((row?.email ?? '') as string);
        }
      } catch (cause) {
        if (!cancelled) setMessage(cause instanceof Error ? cause.message : 'Unable to load profile.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  async function save() {
    const clean = nickname.trim();
    if (!clean) return;

    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('set_my_nickname', {
        p_nickname: clean,
      });
      if (error) throw error;
      setMessage('Nickname saved.');
      window.setTimeout(() => window.location.reload(), 350);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to save nickname.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profileControl">
      <button
        type="button"
        className="secondaryButton compactButton"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Profile
      </button>

      {open && (
        <div className="profilePopover" role="dialog" aria-label="Your NekoTrip profile">
          <div className="profilePopoverHeader">
            <div>
              <strong>Your profile</strong>
              <small>Nickname is visible to collaborators. Emoji are welcome.</small>
            </div>
          </div>

          <label className="confirmLabel">
            <span>Unique nickname</span>
            <input
              value={nickname}
              maxLength={48}
              autoComplete="nickname"
              onChange={(event) => {
                setNickname(event.target.value);
                setMessage('');
              }}
              placeholder="TravelFox🦊"
            />
          </label>

          <label className="confirmLabel">
            <span>Account email</span>
            <input value={email} readOnly />
          </label>

          <small className="muted">Email is shown only in explicit Members detail views.</small>

          <div className="profilePopoverActions">
            <button
              className="secondaryButton compactButton"
              type="button"
              onClick={() => {
                resetNekoTripOnboarding();
                setOpen(false);
              }}
            >
              Replay tutorial
            </button>            <button
              className="primaryButton compactButton"
              type="button"
              disabled={busy || !nickname.trim()}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Save nickname'}
            </button>
          </div>

          {message && <div className="statusMessage" role="status">{message}</div>}
        </div>
      )}
    </div>
  );
}
