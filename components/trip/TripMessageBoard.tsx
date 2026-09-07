'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TripRole } from '@/lib/domain/types';
import { EmojiPicker, insertEmojiAtSelection } from '@/components/common/EmojiPicker';

interface TripMessage {
  id: string;
  userId: string;
  nickname: string;
  message: string;
  createdAt: string;
}

interface TripMessageBoardProps {
  tripId: string;
  userId: string;
  memberRole: TripRole;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
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

export function TripMessageBoard({
  tripId,
  userId,
  memberRole,
}: TripMessageBoardProps) {
  const supabase = useMemo(() => createClient(), []);
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const firstLoadRef = useRef(true);

  const [messages, setMessages] = useState<TripMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const canPost = memberRole === 'owner' || memberRole === 'editor';
  const cleanDraft = draft.trim();

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('list_trip_messages', {
        p_trip_id: tripId,
      });
      if (error) throw error;

      const next: TripMessage[] = Array.isArray(data)
        ? data.map((row: any) => ({
            id: row.id as string,
            userId: row.user_id as string,
            nickname: (row.nickname ?? 'Traveler') as string,
            message: row.message as string,
            createdAt: row.created_at as string,
          }))
        : [];

      setMessages(next);
      setStatus('');

      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        window.setTimeout(() => {
          const element = listRef.current;
          if (element) element.scrollTop = element.scrollHeight;
        }, 0);
      }
    } catch (cause) {
      setStatus(describeError(cause, 'Unable to load messages.'));
    } finally {
      setLoading(false);
    }
  }, [supabase, tripId]);

  useEffect(() => {
    let cancelled = false;
    void refresh();

    const timer = window.setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible') {
        void refresh();
      }
    }, 60000);

    const channel = supabase
      .channel(`trip-messages:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trip_messages',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          if (!cancelled) void refresh();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh, supabase, tripId]);

  async function postMessage() {
    if (!canPost || posting || !cleanDraft) return;

    setPosting(true);
    setStatus('');
    try {
      const { error } = await supabase.rpc('post_trip_message', {
        p_trip_id: tripId,
        p_message: cleanDraft,
      });
      if (error) throw error;

      setDraft('');
      await refresh();

      window.setTimeout(() => {
        const element = listRef.current;
        if (element) element.scrollTop = element.scrollHeight;
      }, 0);
    } catch (cause) {
      setStatus(describeError(cause, 'Unable to post message.'));
    } finally {
      setPosting(false);
    }
  }

  async function deleteMessage(message: TripMessage) {
    const canDelete = memberRole === 'owner' || message.userId === userId;
    if (!canDelete) return;

    if (!window.confirm('Delete this message?')) return;

    setBusyMessageId(message.id);
    setStatus('');
    try {
      const { error } = await supabase.rpc('delete_trip_message', {
        p_message_id: message.id,
      });
      if (error) throw error;
      await refresh();
    } catch (cause) {
      setStatus(describeError(cause, 'Unable to delete message.'));
    } finally {
      setBusyMessageId(null);
    }
  }

  return (
    <aside className="panel tripMessageBoardPanel">
      <div className="tripMessageBoardHeader">
        <div>
          <strong>Message Board</strong>
          <small>Trip discussion for collaborators.</small>
        </div>
        <button
          type="button"
          className="secondaryButton compactButton"
          disabled={loading}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      <div className="tripMessageList" ref={listRef}>
        {loading && messages.length === 0 ? (
          <div className="tripMessageEmpty">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="tripMessageEmpty">No messages yet.</div>
        ) : (
          messages.map((message) => {
            const mine = message.userId === userId;
            const canDelete = memberRole === 'owner' || mine;

            return (
              <article className="tripMessageItem" key={message.id}>
                <div className="tripMessageMeta">
                  <strong>{message.nickname}</strong>
                  <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
                </div>
                <div className="tripMessageText">{message.message}</div>
                {canDelete && (
                  <button
                    type="button"
                    className="tripMessageDelete"
                    disabled={busyMessageId === message.id}
                    onClick={() => void deleteMessage(message)}
                  >
                    {busyMessageId === message.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </article>
            );
          })
        )}
      </div>

      {canPost ? (
        <div className="tripMessageComposer">
          <textarea
            ref={draftTextareaRef}
            value={draft}
            maxLength={2000}
            placeholder="Leave a note for this Trip…"
            aria-label="Trip message"
            onChange={(event) => {
              setDraft(event.target.value);
              setStatus('');
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void postMessage();
              }
            }}
          />
          <EmojiPicker
            onPick={(emoji) => {
              const { nextText, nextCursor } = insertEmojiAtSelection(
                draftTextareaRef.current,
                draft,
                emoji,
                2000
              );
              setDraft(nextText);
              window.requestAnimationFrame(() => {
                draftTextareaRef.current?.focus();
                draftTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
              });
            }}
          />
          <div className="tripMessageComposerFooter">
            <small>{draft.length}/2000 · Ctrl/⌘ + Enter to post</small>
            <button
              type="button"
              className="primaryButton compactButton"
              disabled={posting || !cleanDraft}
              onClick={() => void postMessage()}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      ) : (
        <div className="tripMessageViewerNote">Viewer access: read only.</div>
      )}

      {status && <div className="statusMessage errorText">{status}</div>}
    </aside>
  );
}
