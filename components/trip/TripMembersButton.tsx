'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface TripMemberRow {
  userId: string;
    nickname: string;
email: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: string | null;
}

interface TripMembersButtonProps {
  tripId: string;
  currentUserId: string;
  currentUserRole: 'owner' | 'editor' | 'viewer';
  memberCount: number;
  onMembersChanged?: () => void | Promise<void>;
}

export function TripMembersButton({
  tripId,
  currentUserId,
  currentUserRole,
  memberCount,
  onMembersChanged,
}: TripMembersButtonProps) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<TripMemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const { data, error } = await supabaseRef.current!.rpc('list_trip_members', {
        p_trip_id: tripId,
      });
      if (error) throw error;

      setMembers(
        Array.isArray(data)
          ? data.map((row: any) => ({
              userId: row.user_id as string,
              nickname: (row.nickname ?? 'Traveler') as string,
              email: (row.email ?? 'Unknown member') as string,
              role: row.role as TripMemberRow['role'],
              joinedAt: (row.joined_at ?? null) as string | null,
            }))
          : []
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to load Trip members.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  async function removeMember(member: TripMemberRow) {
    if (currentUserRole !== 'owner' || member.role === 'owner') return;

    const confirmed = window.confirm(`Remove ${member.nickname} (${member.email}) from this Trip?`);
    if (!confirmed) return;

    setBusyUserId(member.userId);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('remove_trip_member', {
        p_trip_id: tripId,
        p_user_id: member.userId,
      });
      if (error) throw error;

      await refresh();
      await onMembersChanged?.();
      setMessage(`${member.nickname} removed from this Trip.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to remove Trip member.');
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="tripMembersControl">
      <button
        type="button"
        className="memberPill tripMembersTrigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="onlineDot" />
        {memberCount} member{memberCount === 1 ? '' : 's'}
      </button>

      {open && (
        <div className="tripMembersPopover" role="dialog" aria-label="Trip collaborators">
          <div className="tripMembersHeader">
            <div>
              <strong>Collaborators</strong>
              <small>{members.length || memberCount} member{(members.length || memberCount) === 1 ? '' : 's'}</small>
            </div>
            <button
              type="button"
              className="secondaryButton compactButton"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {loading && members.length === 0 ? (
            <div className="tripMembersEmpty">Loading members…</div>
          ) : members.length === 0 ? (
            <div className="tripMembersEmpty">No members found.</div>
          ) : (
            <div className="tripMembersList">
              {members.map((member) => {
                const isCurrentUser = member.userId === currentUserId;
                const canRemove =
                  currentUserRole === 'owner' &&
                  member.role !== 'owner' &&
                  !isCurrentUser;

                return (
                  <div className="tripMemberRow" key={member.userId}>
                    <div className="tripMemberIdentity">
                      <small className="tripMemberRole">{member.role}</small>
                      <strong>
                        {member.nickname}
                        {isCurrentUser ? ' (you)' : ''}
                      </strong>
                      <span className="tripMemberEmail">{member.email}</span>
                      {canRemove && (
                        <button
                          type="button"
                          className="tripMemberRemove"
                          onClick={() => void removeMember(member)}
                          disabled={busyUserId === member.userId}
                        >
                          {busyUserId === member.userId ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {message && <small className="tripMembersMessage">{message}</small>}
        </div>
      )}
    </div>
  );
}
