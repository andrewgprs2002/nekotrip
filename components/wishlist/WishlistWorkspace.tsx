'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleTripMap } from '@/components/map/GoogleTripMap';
import { GooglePlaceDetailsCard } from '@/components/place/GooglePlaceDetailsCard';
import { GooglePlacesProvider, type PlaceSearchResult } from '@/lib/providers/places';
import { createClient } from '@/lib/supabase/client';
import { loadWishlistFolders, loadWishlistItems } from '@/lib/repositories/wishlist';
import type { WishlistFolder, WishlistItem, WishlistTripOption } from '@/lib/domain/types';

const categories = ['Sightseeing', 'Restaurant', 'Cafe', 'Hotel', 'Onsen', 'Shopping', 'Station'];
const categoryIcons: Record<string, string> = {
  Sightseeing: '📷', Restaurant: '🍣', Cafe: '☕', Hotel: '🏨', Onsen: '♨️', Shopping: '🛍️', Station: '🚉',
};

const noteEmojiGroups = [
  { label: 'Mood', emojis: ['❤️','🩷','💜','🧡','💛','💚','💙','🤍','✨','⭐','🌟','🥹','😂','🤣','😗','😍','🥰','🤔','😴','😭','😤'] },
  { label: 'Animals', emojis: ['🦊','🐱','🐶','🐾','🐰','🦝','🐻','🐼','🦦','🦌','🐧','🐬','🐿️','🦉','🐒'] },
  { label: 'Food', emojis: ['🍜','🍣','🍱','🍙','🍛','🍤','🍡','🍰','🍮','🍦','🥐','🥞','☕','🍵','🍺','🍷','🥂','🍶','🥩','🍗'] },
  { label: 'Places', emojis: ['🏯','⛩️','🏰','🗼','🎡','🎢','🎠','🏛️','🖼️','🎨','📸','🌸','🍁','❄️','🌊','🌲','🏔️','🌋','🌃','🌅'] },
  { label: 'Stay & transport', emojis: ['🏨','🛏️','♨️','🚗','🚙','🚆','🚅','✈️','🚌','🚕','🚲','🚶','🚢','🚡','🛫','🛬'] },
  { label: 'Plan', emojis: ['📍','📌','✅','❌','⚠️','💡','🎯','💰','🛍️','🎁','⏰','🕒','📅','🧭','📝','🔖','💬','📎','🔗','🚩'] },
] as const;

type FolderScope = 'all' | 'unfiled' | string;
type CreateTripMode = null | 'create';

interface Props {
  userId: string;
  userName: string;
  initialFolders: WishlistFolder[];
  initialItems: WishlistItem[];
  trips: WishlistTripOption[];
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message;
  return cause instanceof Error ? cause.message : fallback;
}

export function WishlistWorkspace({ userId, userName, initialFolders, initialItems, trips }: Props) {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '';
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const providerRef = useRef<GooglePlacesProvider | null>(null);
  if (apiKey && !providerRef.current) providerRef.current = new GooglePlacesProvider(apiKey);

  const [folders, setFolders] = useState(initialFolders);
  const [items, setItems] = useState(initialItems);
  const [scope, setScope] = useState<FolderScope>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [addFolderId, setAddFolderId] = useState('');
  const [category, setCategory] = useState('Sightseeing');
  const [rating, setRating] = useState(3);
  const [message, setMessage] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [tripTargets, setTripTargets] = useState<Record<string, string>>({});
  const [bulkTripId, setBulkTripId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [createTripMode, setCreateTripMode] = useState<CreateTripMode>(null);
  const [viewportPlaceIds, setViewportPlaceIds] = useState<string[]>([]);
  const [newTripName, setNewTripName] = useState('');
  const [newTripStartDate, setNewTripStartDate] = useState('');
  const [newTripEndDate, setNewTripEndDate] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initialItems.map((item) => [item.id, item.notes ?? ''])));
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);
  const [emojiPickerItemId, setEmojiPickerItemId] = useState<string | null>(null);
  const [emojiGroup, setEmojiGroup] = useState<(typeof noteEmojiGroups)[number]['label']>('Mood');
  const noteTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, WishlistFolder[]>();
    for (const folder of folders) {
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  const descendantIds = useMemo(() => {
    if (scope === 'all' || scope === 'unfiled') return new Set<string>();
    const result = new Set<string>([scope]);
    const visit = (parent: string) => {
      for (const child of childrenByParent.get(parent) ?? []) {
        if (!result.has(child.id)) { result.add(child.id); visit(child.id); }
      }
    };
    visit(scope);
    return result;
  }, [childrenByParent, scope]);


  // Counts include every descendant folder, so parent folders accurately show
  // how many wishlist places are contained anywhere below them in the tree.
  const folderCounts = useMemo(() => {
    const directCounts = new Map<string, number>();
    for (const item of items) {
      if (item.folderId) directCounts.set(item.folderId, (directCounts.get(item.folderId) ?? 0) + 1);
    }

    const totals = new Map<string, number>();
    const countFolder = (folderId: string, visiting = new Set<string>()): number => {
      if (totals.has(folderId)) return totals.get(folderId)!;
      // Defensive cycle guard in case malformed folder data ever reaches the UI.
      if (visiting.has(folderId)) return directCounts.get(folderId) ?? 0;
      const nextVisiting = new Set(visiting);
      nextVisiting.add(folderId);

      let total = directCounts.get(folderId) ?? 0;
      for (const child of childrenByParent.get(folderId) ?? []) {
        total += countFolder(child.id, nextVisiting);
      }
      totals.set(folderId, total);
      return total;
    };

    for (const folder of folders) countFolder(folder.id);
    return totals;
  }, [childrenByParent, folders, items]);

  const visible = useMemo(() => {
    if (scope === 'all') return items;
    if (scope === 'unfiled') return items.filter((item) => item.folderId === null);
    return items.filter((item) => item.folderId !== null && descendantIds.has(item.folderId));
  }, [descendantIds, items, scope]);

  const insertNoteEmoji = (itemId: string, emoji: string) => {
    const textarea = noteTextareaRefs.current[itemId];
    const currentText = noteDrafts[itemId] ?? '';
    const start = textarea?.selectionStart ?? currentText.length;
    const end = textarea?.selectionEnd ?? start;
    const nextText = `${currentText.slice(0, start)}${emoji}${currentText.slice(end)}`.slice(0, 500);
    const nextCursor = Math.min(start + emoji.length, nextText.length);

    setNoteDrafts((current) => ({ ...current, [itemId]: nextText }));
    window.requestAnimationFrame(() => {
      const nextTextarea = noteTextareaRefs.current[itemId];
      nextTextarea?.focus();
      nextTextarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const mappedCount = visible.filter((item) => item.latitude !== null && item.longitude !== null).length;
  const selectedCount = selectedIds.size;
  const visibleIds = useMemo(() => visible.map((item) => item.id), [visible]);
  const mappedVisibleIds = useMemo(() => visible.filter((item) => item.latitude !== null && item.longitude !== null).map((item) => item.id), [visible]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const refresh = async () => {
    const [nextFolders, nextItems] = await Promise.all([
      loadWishlistFolders(supabaseRef.current!),
      loadWishlistItems(supabaseRef.current!),
    ]);
    setFolders(nextFolders);
    setItems(nextItems);
    setSelectedId((current) => current && nextItems.some((item) => item.id === current) ? current : null);
    setSelectedIds((current) => {
      const valid = new Set(nextItems.map((item) => item.id));
      return new Set([...current].filter((id) => valid.has(id)));
    });
  };

  const toggleBulkSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectMappedVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      mappedVisibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const selectMapViewport = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      viewportPlaceIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const searchPlaces = async () => {
    if (!query.trim() || !providerRef.current) return;
    setSearching(true); setMessage('');
    try { setResults(await providerRef.current.search(query)); }
    catch (cause) { setMessage(errorMessage(cause, 'Unable to search Google Places.')); }
    finally { setSearching(false); }
  };

  const addPlace = async (result: PlaceSearchResult | null) => {
    const name = result?.name ?? query.trim();
    if (!name) return;
    setMessage('');
    const { error } = await supabaseRef.current!.rpc('add_wishlist_place', {
      p_name: name,
      p_provider: result?.provider ?? 'manual',
      p_provider_place_id: result?.providerPlaceId ?? null,
      p_formatted_address: result?.formattedAddress ?? null,
      p_latitude: result?.latitude ?? null,
      p_longitude: result?.longitude ?? null,
      p_folder_id: addFolderId || null,
      p_category: category,
      p_rating: rating,
    });
    if (error) { setMessage(error.message); return; }
    setQuery(''); setResults([]);
    await refresh();
    setMessage(`Saved ${name} to your wishlist.`);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setFolderBusy(true); setMessage('');
    const { error } = await supabaseRef.current!.rpc('create_wishlist_folder', {
      p_name: newFolderName.trim(), p_parent_id: newFolderParent || null,
    });
    setFolderBusy(false);
    if (error) { setMessage(error.message); return; }
    setNewFolderName('');
    await refresh();
  };

  const renameFolder = async (folder: WishlistFolder) => {
    const name = window.prompt('Rename folder', folder.name)?.trim();
    if (!name || name === folder.name) return;
    const { error } = await supabaseRef.current!.rpc('rename_wishlist_folder', { p_folder_id: folder.id, p_name: name });
    if (error) setMessage(error.message); else await refresh();
  };

  const deleteFolder = async (folder: WishlistFolder) => {
    if (!window.confirm(`Delete folder “${folder.name}”? Items and child folders will move up one level; saved places will not be deleted.`)) return;
    const { error } = await supabaseRef.current!.rpc('delete_wishlist_folder', { p_folder_id: folder.id });
    if (error) { setMessage(error.message); return; }
    if (scope === folder.id) setScope(folder.parentId ?? 'all');
    await refresh();
  };

  const updateItem = async (item: WishlistItem, patch: Partial<Pick<WishlistItem, 'folderId'|'category'|'rating'>>) => {
    setBusyItemId(item.id); setMessage('');
    const next = {
      folderId: Object.prototype.hasOwnProperty.call(patch, 'folderId') ? (patch.folderId ?? null) : item.folderId,
      category: Object.prototype.hasOwnProperty.call(patch, 'category') ? (patch.category ?? item.category) : item.category,
      rating: Object.prototype.hasOwnProperty.call(patch, 'rating') ? (patch.rating ?? item.rating) : item.rating,
    };
    const { error } = await supabaseRef.current!.rpc('update_wishlist_item', {
      p_item_id: item.id, p_folder_id: next.folderId, p_category: next.category, p_rating: next.rating,
    });
    setBusyItemId(null);
    if (error) { setMessage(error.message); return; }
    await refresh();
  };

  const deleteItem = async (item: WishlistItem) => {
    if (!window.confirm(`Remove “${item.name}” from your wishlist?`)) return;
    const { error } = await supabaseRef.current!.rpc('delete_wishlist_item', { p_item_id: item.id });
    if (error) { setMessage(error.message); return; }
    await refresh();
  };

  const addToTrip = async (item: WishlistItem) => {
    const tripId = tripTargets[item.id];
    if (!tripId) { setMessage('Choose a target Trip first.'); return; }
    setBusyItemId(item.id); setMessage('');
    const { error } = await supabaseRef.current!.rpc('add_wishlist_item_to_trip', { p_item_id: item.id, p_trip_id: tripId });
    setBusyItemId(null);
    if (error) { setMessage(error.message); return; }
    const trip = trips.find((value) => value.id === tripId);
    setMessage(`Added ${item.name} to ${trip?.name ?? 'the Trip'} as Unplanned.`);
  };

  const addSelectedToTrip = async () => {
    if (!bulkTripId || selectedCount === 0) return;
    setBulkBusy(true); setMessage('');
    try {
      const selectedArray = [...selectedIds];
      const { data, error } = await supabaseRef.current!.rpc('add_wishlist_items_to_trip', {
        p_item_ids: selectedArray,
        p_trip_id: bulkTripId,
      });
      if (error) throw error;
      const trip = trips.find((value) => value.id === bulkTripId);
      setMessage(`Added ${Number(data) || selectedArray.length} selected wishlist place${selectedArray.length === 1 ? '' : 's'} to ${trip?.name ?? 'the Trip'} as Unplanned.`);
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to add selected places to the Trip.'));
    } finally {
      setBulkBusy(false);
    }
  };

  const createTripFromSelection = async () => {
    const name = newTripName.trim();
    if (!name || selectedCount === 0) return;
    setBulkBusy(true); setMessage('');
    try {
      const { data, error } = await supabaseRef.current!.rpc('create_trip_from_wishlist', {
        p_item_ids: [...selectedIds],
        p_name: name,
        p_timezone: 'Asia/Tokyo',
        p_start_date: newTripStartDate || null,
        p_end_date: newTripEndDate || null,
        p_default_days: 4,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (!created?.trip_slug) throw new Error('Trip was created but no slug was returned.');
      setCreateTripMode(null);
      router.push(`/trips/${created.trip_slug}`);
      router.refresh();
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to create a Trip from the selected wishlist places.'));
      setBulkBusy(false);
    }
  };

  const saveNote = async (item: WishlistItem) => {
    const nextNote = (noteDrafts[item.id] ?? '').trim();
    setNoteBusyId(item.id);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('update_wishlist_item_notes', {
        p_item_id: item.id,
        p_notes: nextNote || null,
      });
      if (error) throw error;
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, notes: nextNote || null } : value));
      setMessage(`Saved note for ${item.name}.`);
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to save wishlist note.'));
    } finally {
      setNoteBusyId(null);
    }
  };

  const renderFolder = (folder: WishlistFolder, depth: number) => {
    const count = folderCounts.get(folder.id) ?? 0;
    return <div key={folder.id}>
      <div className={scope === folder.id ? 'folderRow active' : 'folderRow'} style={{ paddingLeft: `${8 + depth * 16}px` }}>
        <button type="button" className="folderSelect" onClick={() => { setScope(folder.id); setAddFolderId(folder.id); setNewFolderParent(folder.id); }}><span>📁</span><span>{folder.name}</span><small>{count}</small></button>
        <button type="button" className="folderMiniAction" onClick={() => void renameFolder(folder)} title="Rename folder">✎</button>
        <button type="button" className="folderMiniAction danger" onClick={() => void deleteFolder(folder)} title="Delete folder">×</button>
      </div>
      {(childrenByParent.get(folder.id) ?? []).map((child) => renderFolder(child, depth + 1))}
    </div>;
  };

  return <main className="tripShell wishlistShell">
    <header className="tripHeader">
      <div><div className="eyebrow">NekoTrip · Global Wishlist</div><h1>Wish List</h1><div className="subtitle">{userName} · independent from every Trip</div></div>
      <div className="headerActions"><Link className="secondaryLink" href="/">Trips</Link></div>
    </header>

    <div className="wishlistLayout">
      <aside className="panel wishlistSidebar">
        <div className="sectionHeading"><div><strong>Folders</strong><small>Nested folders are global to your account.</small></div></div>
        <div className="folderTree">
          <button type="button" className={scope === 'all' ? 'folderRoot active' : 'folderRoot'} onClick={() => setScope('all')}>🗺️ All places <small>{items.length}</small></button>
          <button type="button" className={scope === 'unfiled' ? 'folderRoot active' : 'folderRoot'} onClick={() => { setScope('unfiled'); setAddFolderId(''); }}>📥 Unfiled <small>{items.filter((item) => item.folderId === null).length}</small></button>
          {(childrenByParent.get(null) ?? []).map((folder) => renderFolder(folder, 0))}
        </div>
        <div className="folderCreator">
          <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="New folder name" />
          <select value={newFolderParent} onChange={(event) => setNewFolderParent(event.target.value)}>
            <option value="">Top level</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <button className="primaryButton" type="button" disabled={folderBusy || !newFolderName.trim()} onClick={() => void createFolder()}>{folderBusy ? 'Creating…' : '+ Create folder'}</button>
        </div>
      </aside>

      <section className="panel wishlistListPanel">
        <div className="sectionHeading"><div><strong>Add to wishlist</strong><small>Search once, decide which Trip later.</small></div></div>
        <form className="placeForm" onSubmit={(event) => { event.preventDefault(); void searchPlaces(); }}>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setResults([]); }} placeholder="例如：蔵王キツネ村" aria-label="Wishlist place search" />
          <div className="formRow">
            <select value={addFolderId} onChange={(event) => setAddFolderId(event.target.value)}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          </div>
          <div className="formRow">
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5,4,3,2,1].map((value) => <option key={value} value={value}>{'★'.repeat(value)}{'☆'.repeat(5-value)}</option>)}</select>
            <button className="primaryButton" type="submit" disabled={!query.trim() || searching}>{searching ? 'Searching…' : 'Search Google'}</button>
          </div>
          <button className="secondaryButton" type="button" disabled={!query.trim()} onClick={() => void addPlace(null)}>Add manually without map location</button>
        </form>

        {message && <div className="statusMessage" role="status">{message}</div>}
        {results.length > 0 && <div className="searchResults">{results.map((result) => <button type="button" className="searchResult" key={result.providerPlaceId} onClick={() => void addPlace(result)}><span className="resultPin">📍</span><span className="resultText"><strong>{result.name}</strong><small>{result.formattedAddress ?? 'Address unavailable'}</small></span><span className="addResult">Save</span></button>)}</div>}

        <div className="wishlistScopeTitle"><strong>{scope === 'all' ? 'All saved places' : scope === 'unfiled' ? 'Unfiled' : folderById.get(scope)?.name ?? 'Folder'}</strong><small>{visible.length} place{visible.length === 1 ? '' : 's'}</small></div>

        <div className="wishlistBulkBar">
          <div className="wishlistBulkTop">
            <strong>{selectedCount > 0 ? `${selectedCount} selected` : 'Select places'}</strong>
            <div className="wishlistBulkQuickActions">
              <button className="secondaryButton compactButton" type="button" disabled={visible.length === 0} onClick={selectVisible}>{allVisibleSelected ? 'Unselect visible' : 'Select visible'}</button>
              <button className="secondaryButton compactButton" type="button" disabled={mappedVisibleIds.length === 0} onClick={selectMappedVisible}>Select mapped</button>
              <button className="secondaryButton compactButton" type="button" disabled={viewportPlaceIds.length === 0} onClick={selectMapViewport}>Select map view ({viewportPlaceIds.length})</button>
              <button className="secondaryButton compactButton" type="button" disabled={selectedCount === 0} onClick={() => setSelectedIds(new Set())}>Clear</button>
            </div>
          </div>
          <div className="wishlistBulkTripAction">
            <select value={bulkTripId} onChange={(event) => setBulkTripId(event.target.value)} aria-label="Bulk target Trip">
              <option value="">Choose existing Trip…</option>
              {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
            </select>
            <button className="primaryButton" type="button" disabled={bulkBusy || selectedCount === 0 || !bulkTripId} onClick={() => void addSelectedToTrip()}>{bulkBusy ? 'Adding…' : 'Add selected'}</button>
            <button className="secondaryButton" type="button" disabled={bulkBusy || selectedCount === 0} onClick={() => { setNewTripName(''); setNewTripStartDate(''); setNewTripEndDate(''); setCreateTripMode('create'); }}>Create Trip from selection</button>
          </div>
        </div>

        <div className="placeList wishlistPlaceList">
          {visible.length === 0 && <div className="emptyState">Nothing saved in this view yet.</div>}
          {visible.map((item) => {
            const bulkSelected = selectedIds.has(item.id);
            return <article key={item.id} className={`${selectedId === item.id ? 'placeCard selected' : 'placeCard'}${bulkSelected ? ' bulkSelected' : ''}`} onClick={() => setSelectedId(item.id)}>
              <div className="placeCardTop">
                <label className="wishlistSelectBox" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={bulkSelected} onChange={() => toggleBulkSelection(item.id)} aria-label={`Select ${item.name}`} />
                </label>
                <button type="button" className="placeSelect" onClick={() => setSelectedId(item.id)}><span>{categoryIcons[item.category] ?? '📍'}</span><span><strong>{item.name}</strong>{item.formattedAddress && <small>{item.formattedAddress}</small>}</span></button>
                <button type="button" className="deleteButton" onClick={(event) => { event.stopPropagation(); void deleteItem(item); }}>Remove</button>
              </div>
              <GooglePlaceDetailsCard apiKey={apiKey} providerPlaceId={item.providerPlaceId} fallbackAddress={item.formattedAddress} placeName={item.name} category={item.category} variant="rich" />
              <div className="wishlistNotes" onClick={(event) => event.stopPropagation()}>
                <div className="wishlistNotesHeader"><span>Notes / Why saved</span><small>{(noteDrafts[item.id] ?? '').length}/500</small></div>
                <textarea
                  ref={(element) => { noteTextareaRefs.current[item.id] = element; }}
                  value={noteDrafts[item.id] ?? ''}
                  maxLength={500}
                  placeholder="例如：狐狸成分很高、冬天候選、雨天備案、想跟誰一起去…"
                  onChange={(event) => setNoteDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <div className="wishlistEmojiRow">
                  <button
                    className={emojiPickerItemId === item.id ? 'emojiPickerToggle active' : 'emojiPickerToggle'}
                    type="button"
                    aria-expanded={emojiPickerItemId === item.id}
                    aria-label="Open emoji picker"
                    onClick={() => setEmojiPickerItemId((current) => current === item.id ? null : item.id)}
                  >😊 Emoji</button>
                  {emojiPickerItemId === item.id && <div className="wishlistEmojiPickerPanel" role="group" aria-label="Travel emoji picker">
                    <div className="wishlistEmojiTabs">
                      {noteEmojiGroups.map((group) => <button key={group.label} className={emojiGroup === group.label ? 'emojiCategory active' : 'emojiCategory'} type="button" onClick={() => setEmojiGroup(group.label)}>{group.label}</button>)}
                    </div>
                    <div className="wishlistEmojiPicker">
                      {(noteEmojiGroups.find((group) => group.label === emojiGroup)?.emojis ?? noteEmojiGroups[0].emojis).map((emoji) => <button key={emoji} className="wishlistEmojiButton" type="button" onClick={() => insertNoteEmoji(item.id, emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}
                    </div>
                  </div>}
                </div>
                <div className="wishlistNotesActions">
                  <span className="muted">Private to your Wishlist.</span>
                  <button className="secondaryButton compactButton" type="button" disabled={noteBusyId === item.id || (noteDrafts[item.id] ?? '').trim() === (item.notes ?? '').trim()} onClick={() => void saveNote(item)}>{noteBusyId === item.id ? 'Saving…' : 'Save note'}</button>
                </div>
              </div>
              <div className="wishlistItemControls" onClick={(event) => event.stopPropagation()}>
                <label className="compactField"><span>Folder</span><select className="inlineMetaSelect" value={item.folderId ?? ''} disabled={busyItemId === item.id} onChange={(event) => void updateItem(item, { folderId: event.target.value || null })}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
                <label className="compactField"><span>Type</span><select className="inlineMetaSelect" value={item.category} disabled={busyItemId === item.id} onChange={(event) => void updateItem(item, { category: event.target.value })}>{categories.map((value) => <option key={value} value={value}>{categoryIcons[value] ?? '📍'} {value}</option>)}</select></label>
                <label className="compactField"><span>Stars</span><select className="inlineMetaSelect" value={item.rating} disabled={busyItemId === item.id} onChange={(event) => void updateItem(item, { rating: Number(event.target.value) })}>{[5,4,3,2,1].map((value) => <option key={value} value={value}>{'★'.repeat(value)}{'☆'.repeat(5-value)}</option>)}</select></label>
              </div>
              <div className="wishlistTripAction" onClick={(event) => event.stopPropagation()}>
                <select value={tripTargets[item.id] ?? ''} onChange={(event) => setTripTargets((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">Choose Trip…</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}</select>
                <button className="secondaryButton" type="button" disabled={busyItemId === item.id || !tripTargets[item.id]} onClick={() => void addToTrip(item)}>Add to Trip</button>
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="panel mapPanel wishlistMapPanel">
        <div className="mapHeader"><div><strong>Wishlist Map</strong><small>The map follows the selected folder scope. Use Select mapped to grab every mapped place in the current view.</small></div><span>{mappedCount} mapped / {visible.length} visible</span></div>
        <GoogleTripMap apiKey={apiKey} mapId={mapId} places={visible} selectedId={selectedId} onSelect={setSelectedId} onViewportPlaceIdsChange={setViewportPlaceIds} />
        <div className="selectedPanel">{selected ? <><div className="selectedLabel">Selected wish</div><strong>{categoryIcons[selected.category] ?? '📍'} {selected.name}</strong><small>{selected.formattedAddress ?? 'No mapped address'}</small><div className="selectedMeta">{selected.folderId ? folderById.get(selected.folderId)?.name ?? 'Folder' : 'Unfiled'} · {'★'.repeat(selected.rating)}{'☆'.repeat(5-selected.rating)}</div><button className="secondaryButton compactButton" type="button" onClick={() => toggleBulkSelection(selected.id)}>{selectedIds.has(selected.id) ? 'Remove from selection' : 'Add to selection'}</button></> : <><div className="selectedLabel">Selected wish</div><span className="muted">Choose a saved place or map marker.</span></>}</div>
      </section>
    </div>

    {createTripMode === 'create' && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkBusy) setCreateTripMode(null); }}>
      <section className="modalCard" role="dialog" aria-modal="true" aria-labelledby="wishlist-create-trip-title">
        <div className="modalHeader">
          <div><div className="eyebrow">Wishlist selection</div><h2 id="wishlist-create-trip-title">Create a Trip from {selectedCount} selected place{selectedCount === 1 ? '' : 's'}</h2></div>
          <button type="button" className="iconButton" disabled={bulkBusy} onClick={() => setCreateTripMode(null)} aria-label="Close">×</button>
        </div>
        <div className="settingsSection">
          <label className="confirmLabel"><span>Trip name</span><input className="settingsInput" value={newTripName} onChange={(event) => setNewTripName(event.target.value)} placeholder="Tohoku Winter 2028" maxLength={120} autoFocus /></label>
          <div className="formRow">
            <label className="confirmLabel"><span>Departure date (optional)</span><input className="settingsInput" type="date" value={newTripStartDate} onChange={(event) => setNewTripStartDate(event.target.value)} /></label>
            <label className="confirmLabel"><span>End date (optional)</span><input className="settingsInput" type="date" value={newTripEndDate} onChange={(event) => setNewTripEndDate(event.target.value)} /></label>
          </div>
          <p className="muted settingsHint">The selected wishes stay in your Wishlist and are also copied into the new Trip as Unplanned places.</p>
        </div>
        {message && <div className="statusMessage" role="status">{message}</div>}
        <div className="modalActions">
          <button className="secondaryButton" type="button" disabled={bulkBusy} onClick={() => setCreateTripMode(null)}>Cancel</button>
          <button className="primaryButton" type="button" disabled={bulkBusy || !newTripName.trim() || selectedCount === 0 || (!!newTripEndDate && !!newTripStartDate && newTripEndDate < newTripStartDate)} onClick={() => void createTripFromSelection()}>{bulkBusy ? 'Creating…' : 'Create Trip'}</button>
        </div>
      </section>
    </div>}
  </main>;
}
