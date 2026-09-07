'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TripPlaceItem } from '@/lib/domain/types';
import { EmojiPicker, insertEmojiAtSelection } from '@/components/common/EmojiPicker';

type MemberRole = 'owner' | 'editor' | 'viewer';
type SplitMode = 'equal' | 'manual';

interface ExpenseMember {
  userId: string;
  email: string;
  role: MemberRole;
}

interface ExpenseShare {
  userId: string;
  amountDue: number;
  amountPaid: number;
}

interface TripExpense {
  id: string;
  tripPlaceId: string;
  amount: number;
  currency: string;
  splitMode: SplitMode;
  note: string;
  shares: ExpenseShare[];
}

interface TripExpensesPanelProps {
  tripId: string;
  items: TripPlaceItem[];
  canEdit: boolean;
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function TripExpensesPanel({ tripId, items, canEdit }: TripExpensesPanelProps) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  const [members, setMembers] = useState<ExpenseMember[]>([]);
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [amount, setAmount] = useState('0');
  const [currency, setCurrency] = useState('JPY');
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [note, setNote] = useState('');
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draftShares, setDraftShares] = useState<ExpenseShare[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const expenseByPlaceId = useMemo(
    () => new Map(expenses.map((expense) => [expense.tripPlaceId, expense])),
    [expenses]
  );

  const refresh = useCallback(async () => {
    const supabase = supabaseRef.current!;
    const [{ data: memberData, error: memberError }, { data: expenseData, error: expenseError }] = await Promise.all([
      supabase.rpc('list_trip_expense_members', { p_trip_id: tripId }),
      supabase.rpc('list_trip_place_expenses', { p_trip_id: tripId }),
    ]);

    if (memberError) throw memberError;
    if (expenseError) throw expenseError;

    setMembers(Array.isArray(memberData) ? memberData.map((row: any) => ({
      userId: row.user_id as string,
      email: (row.email ?? 'Unknown user') as string,
      role: row.role as MemberRole,
    })) : []);

    setExpenses(Array.isArray(expenseData) ? expenseData.map((row: any) => ({
      id: row.expense_id as string,
      tripPlaceId: row.trip_place_id as string,
      amount: asNumber(row.amount),
      currency: (row.currency ?? 'JPY') as string,
      splitMode: row.split_mode as SplitMode,
      note: (row.note ?? '') as string,
      shares: Array.isArray(row.shares) ? row.shares.map((share: any) => ({
        userId: share.user_id as string,
        amountDue: asNumber(share.amount_due),
        amountPaid: asNumber(share.amount_paid),
      })) : [],
    })) : []);
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await refresh();
      } catch (cause) {
        if (!cancelled) setMessage(cause instanceof Error ? cause.message : 'Unable to load Trip expenses.');
      }
    };

    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const startEdit = (placeId: string) => {
    const existing = expenseByPlaceId.get(placeId);
    setEditingPlaceId(placeId);
    setAmount(String(existing?.amount ?? 0));
    setCurrency(existing?.currency ?? 'JPY');
    setSplitMode(existing?.splitMode ?? 'equal');
    setNote(existing?.note ?? '');

    const existingByUser = new Map(existing?.shares.map((share) => [share.userId, share]) ?? []);
    setDraftShares(members.map((member) => ({
      userId: member.userId,
      amountDue: existingByUser.get(member.userId)?.amountDue ?? 0,
      amountPaid: existingByUser.get(member.userId)?.amountPaid ?? 0,
    })));
    setMessage('');
  };

  const previewShares = useMemo(() => {
    const total = Math.max(0, asNumber(amount));
    if (splitMode === 'manual') return draftShares;

    const count = Math.max(members.length, 1);
    const base = Math.floor((total / count) * 100) / 100;
    let remainder = Math.round((total - base * count) * 100) / 100;

    return members.map((member, index) => {
      const existing = draftShares.find((share) => share.userId === member.userId);
      let amountDue = base;
      if (index === 0) {
        amountDue = Math.round((base + remainder) * 100) / 100;
        remainder = 0;
      }
      return {
        userId: member.userId,
        amountDue,
        amountPaid: existing?.amountPaid ?? 0,
      };
    });
  }, [amount, draftShares, members, splitMode]);

  const setShare = (userId: string, changes: Partial<ExpenseShare>) => {
    setDraftShares((current) => current.map((share) =>
      share.userId === userId ? { ...share, ...changes } : share
    ));
  };

  const saveExpense = async () => {
    if (!editingPlaceId || !canEdit) return;
    const total = Math.max(0, asNumber(amount));
    const shares = splitMode === 'equal' ? previewShares : draftShares;
    const manualTotal = shares.reduce((sum, share) => sum + Math.max(0, share.amountDue), 0);

    if (splitMode === 'manual' && Math.abs(manualTotal - total) > 0.01) {
      setMessage(`Manual shares must add up to ${money(total, currency)}. Current total: ${money(manualTotal, currency)}.`);
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('save_trip_place_expense', {
        p_trip_place_id: editingPlaceId,
        p_amount: total,
        p_currency: currency.trim().toUpperCase() || 'JPY',
        p_split_mode: splitMode,
        p_note: note.trim() || null,
        p_shares: shares.map((share) => ({
          user_id: share.userId,
          amount_due: Math.max(0, share.amountDue),
          amount_paid: Math.max(0, share.amountPaid),
        })),
      });
      if (error) throw error;
      await refresh();
      setEditingPlaceId(null);
      setMessage('Expense saved.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to save expense.');
    } finally {
      setBusy(false);
    }
  };

  const removeExpense = async (placeId: string) => {
    if (!canEdit || !window.confirm('Remove the expense record for this stop?')) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('delete_trip_place_expense', {
        p_trip_place_id: placeId,
      });
      if (error) throw error;
      await refresh();
      if (editingPlaceId === placeId) setEditingPlaceId(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to remove expense.');
    } finally {
      setBusy(false);
    }
  };

  const currencySummaries = useMemo(() => {
    const byCurrency = new Map<string, {
      total: number;
      members: Map<string, { due: number; paid: number }>;
    }>();

    for (const expense of expenses) {
      const summary = byCurrency.get(expense.currency) ?? { total: 0, members: new Map() };
      summary.total += expense.amount;

      for (const member of members) {
        if (!summary.members.has(member.userId)) summary.members.set(member.userId, { due: 0, paid: 0 });
      }

      for (const share of expense.shares) {
        const current = summary.members.get(share.userId) ?? { due: 0, paid: 0 };
        current.due += share.amountDue;
        current.paid += share.amountPaid;
        summary.members.set(share.userId, current);
      }

      byCurrency.set(expense.currency, summary);
    }

    return byCurrency;
  }, [expenses, members]);

  const editingPlace = items.find((item) => item.id === editingPlaceId) ?? null;
  const effectiveDraftShares = splitMode === 'equal' ? previewShares : draftShares;

  return <section className="panel tripExpensesPanel">
    <div className="sectionHeading">
      <div>
        <strong>Trip Expenses</strong>
        <small>Track each stop, split evenly or manually, and record how much each person has already paid.</small>
      </div>
      <button className="secondaryButton compactButton" type="button" onClick={() => void refresh()}>Refresh</button>
    </div>

    {message && <div className="statusMessage" role="status">{message}</div>}

    <div className="tripExpenseSummaryGrid">
      {[...currencySummaries.entries()].map(([summaryCurrency, summary]) => <div className="tripExpenseSummaryCard" key={summaryCurrency}>
        <div className="tripExpenseSummaryTotal">
          <span>{summaryCurrency} total trip cost</span>
          <strong>{money(summary.total, summaryCurrency)}</strong>
        </div>
        <div className="tripExpenseMemberSummary">
          {members.map((member) => {
            const values = summary.members.get(member.userId) ?? { due: 0, paid: 0 };
            const balance = values.due - values.paid;
            return <div className="tripExpenseMemberSummaryRow" key={`${summaryCurrency}-${member.userId}`}>
              <span title={member.email}>{member.email.split('@')[0]}</span>
              <span>Should pay <strong>{money(values.due, summaryCurrency)}</strong></span>
              <span>Paid <strong>{money(values.paid, summaryCurrency)}</strong></span>
              <span className={balance > 0.009 ? 'expenseBalanceDue' : balance < -0.009 ? 'expenseBalanceCredit' : ''}>
                {balance > 0.009 ? 'Remaining' : balance < -0.009 ? 'Credit' : 'Settled'} <strong>{money(Math.abs(balance), summaryCurrency)}</strong>
              </span>
            </div>;
          })}
        </div>
      </div>)}
      {currencySummaries.size === 0 && <div className="muted">No expenses recorded yet.</div>}
    </div>

    <div className="tripExpenseStopList">
      {items.map((item) => {
        const expense = expenseByPlaceId.get(item.id);
        return <div className="tripExpenseStopRow" key={item.id}>
          <div className="tripExpenseStopName">
            <strong>{item.name}</strong>
            <small>{expense ? `${money(expense.amount, expense.currency)} · ${expense.splitMode === 'equal' ? 'Equal split' : 'Manual split'}` : 'No expense'}</small>
          </div>
          {expense && <div className="tripExpensePaymentProgress">
            {expense.shares.filter((share) => share.amountDue > 0).length > 0
              ? `${expense.shares.filter((share) => share.amountPaid + 0.009 >= share.amountDue).length}/${expense.shares.filter((share) => share.amountDue > 0).length} paid`
              : 'No shares'}
          </div>}
          <button className="secondaryButton compactButton" type="button" disabled={!canEdit} onClick={() => startEdit(item.id)}>
            {expense ? 'Edit cost' : 'Add cost'}
          </button>
          {expense && <button className="deleteButton compactButton" type="button" disabled={!canEdit || busy} onClick={() => void removeExpense(item.id)}>Remove</button>}
        </div>;
      })}
    </div>

    {editingPlace && <div className="tripExpenseEditor">
      <div className="tripExpenseEditorHeader">
        <div><strong>{editingPlace.name}</strong><small>Expense details</small></div>
        <button className="secondaryButton compactButton" type="button" onClick={() => setEditingPlaceId(null)}>Close</button>
      </div>

      <div className="tripExpenseEditorGrid">
        <label><span>Total cost</span><input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label><span>Currency</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="JPY" /></label>
        <label><span>Split</span><select value={splitMode} onChange={(event) => setSplitMode(event.target.value as SplitMode)}><option value="equal">Equal split</option><option value="manual">Manual amounts</option></select></label>
        <div className="tripExpenseNoteField">
          <span>Note</span>
          <textarea
            ref={noteTextareaRef}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Tickets, hotel deposit, dinner…"
          />
          <EmojiPicker
            disabled={!canEdit}
            onPick={(emoji) => {
              const { nextText, nextCursor } = insertEmojiAtSelection(noteTextareaRef.current, note, emoji, 500);
              setNote(nextText);
              window.requestAnimationFrame(() => {
                noteTextareaRef.current?.focus();
                noteTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
              });
            }}
          />
        </div>
      </div>

      <div className="tripExpenseShareTable">
        <div className="tripExpenseShareRow tripExpenseShareHead">
          <span>Person</span><span>Should pay</span><span>Already paid</span><span>Paid?</span>
        </div>
        {members.map((member) => {
          const share = effectiveDraftShares.find((value) => value.userId === member.userId) ?? { userId: member.userId, amountDue: 0, amountPaid: 0 };
          const paid = share.amountDue > 0 && share.amountPaid + 0.009 >= share.amountDue;
          return <div className="tripExpenseShareRow" key={member.userId}>
            <span className="tripExpenseShareEmail" title={member.email}>{member.email}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={share.amountDue}
              disabled={splitMode === 'equal'}
              onChange={(event) => setShare(member.userId, { amountDue: Math.max(0, asNumber(event.target.value)) })}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={share.amountPaid}
              onChange={(event) => setShare(member.userId, { amountPaid: Math.max(0, asNumber(event.target.value)) })}
            />
            <label className="tripExpensePaidToggle">
              <input
                type="checkbox"
                checked={paid}
                onChange={(event) => setShare(member.userId, { amountPaid: event.target.checked ? share.amountDue : 0 })}
              />
              <span>{paid ? 'Paid' : 'Unpaid'}</span>
            </label>
          </div>;
        })}
      </div>

      <div className="tripExpenseEditorActions">
        <button className="primaryButton" type="button" disabled={!canEdit || busy || members.length === 0} onClick={() => void saveExpense()}>
          {busy ? 'Saving…' : 'Save expense'}
        </button>
      </div>
    </div>}
  </section>;
}
