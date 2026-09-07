'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface WishlistMemberDetail {
  userId: string;
  nickname: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
}

export function WishlistMembersButton({
  spaceId,
  memberCount,
}: {
  spaceId: string;
  memberCount: number;
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WishlistMemberDetail[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabaseRef.current!.rpc('list_wishlist_space_member_details', {
        p_space_id: spaceId,
      });
      if (error) throw error;
      setMembers(Array.isArray(data) ? data.map((row: any) => ({
        userId: row.user_id as string,
        nickname: (row.nickname ?? 'Traveler') as string,
        email: (row.email ?? 'Unknown member') as string,
        role: row.role as WishlistMemberDetail['role'],
      })) : []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to load members.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spaceId]);

  return (
    <div className="tripMembersControl">
      <button
        type="button"
        className="memberPill tripMembersTrigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="onlineDot" />
        {memberCount} member{memberCount === 1 ? '' : 's'}
      </button>

      {open && (
        <div className="tripMembersPopover" role="dialog" aria-label="Wishlist members">
          <div className="tripMembersHeader">
            <div>
              <strong>Members</strong>
              <small>Nickname · email · role</small>
            </div>
            <button
              className="secondaryButton compactButton"
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="tripMembersList">
            {members.map((member) => (
              <div className="tripMemberRow" key={member.userId}>
                <div className="tripMemberIdentity">
                  <small className="tripMemberRole">{member.role}</small>
                  <strong>{member.nickname}</strong>
                  <span className="tripMemberEmail">{member.email}</span>
                </div>
              </div>
            ))}
          </div>

          {message && <small className="tripMembersMessage">{message}</small>}
        </div>
      )}
    </div>
  );
}
