'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleTripMap, type RouteMode, type RouteSummary, type RouteOptimizationSuggestion } from '@/components/map/GoogleTripMap';
import { GooglePlaceDetailsCard } from '@/components/place/GooglePlaceDetailsCard';
import { ShareTripButton } from '@/components/trip/ShareTripButton';
import { TripSettingsButton } from '@/components/trip/TripSettingsButton';
import { GooglePlacesProvider, type PlaceSearchResult } from '@/lib/providers/places';
import { createClient } from '@/lib/supabase/client';
import { countTripMembers, loadTripDays, loadTripPlaces } from '@/lib/repositories/trips';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TripDay, TripPlaceItem, TripRole } from '@/lib/domain/types';

const categories = ['Sightseeing', 'Restaurant', 'Cafe', 'Hotel', 'Onsen', 'Shopping', 'Station'];
const categoryIcons: Record<string, string> = {
  Sightseeing: 'ðŸ“·', Restaurant: 'ðŸ£', Cafe: 'â˜•', Hotel: 'ðŸ¨', Onsen: 'â™¨ï¸', Shopping: 'ðŸ›ï¸', Station: 'ðŸš‰',
};

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as { message?: unknown }).message === 'string') {
    return (cause as { message: string }).message;
  }
  return fallback;
}

interface TripWorkspaceProps {
  tripId: string;
  tripSlug: string;
  tripName: string;
  tripStartDate: string | null;
  tripEndDate: string | null;
  tripTimezone: string;
  userId: string;
  userName: string;
  memberRole: TripRole;
  initialDays: TripDay[];
  initialItems: TripPlaceItem[];
  initialMemberCount: number;
}

export function TripWorkspace({
  tripId, tripSlug, tripName, tripStartDate, tripEndDate, tripTimezone, userId, userName, memberRole,
  initialDays, initialItems, initialMemberCount,
}: TripWorkspaceProps) {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? '';
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const lastTripRevisionRef = useRef<string | null>(null);
  const pollBusyRef = useRef(false);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const providerRef = useRef<GooglePlacesProvider | null>(null);
  if (apiKey && !providerRef.current) providerRef.current = new GooglePlacesProvider(apiKey);

  const [tripTitle, setTripTitle] = useState(tripName);
  const [startDate, setStartDate] = useState<string | null>(tripStartDate);
  const [endDate, setEndDate] = useState<string | null>(tripEndDate);
  const [days, setDays] = useState(initialDays);
  const [items, setItems] = useState(initialItems);
  const [memberCount, setMemberCount] = useState(initialMemberCount);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [dayId, setDayId] = useState('');
  const [category, setCategory] = useState('Sightseeing');
  const [priority, setPriority] = useState(3);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting'|'live'|'error'>('connecting');
  const [busyPlaceId, setBusyPlaceId] = useState<string | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>('DRIVING');
  const [trafficAware, setTrafficAware] = useState(false);
  const [routeSummary, setRouteSummary] = useState<RouteSummary>({ state: 'idle', mode: 'DRIVING', distance: 'â€”', duration: 'â€”', distanceMeters: 0, durationMillis: 0, legs: [], warnings: [] });
  const [routeStartId, setRouteStartId] = useState('');
  const [routeEndId, setRouteEndId] = useState('');
  const [routeDepartureTime, setRouteDepartureTime] = useState('08:00');
  const [routeArrivalTime, setRouteArrivalTime] = useState('18:00');
  const [routeTimeAnchor, setRouteTimeAnchor] = useState<'departure'|'arrival'>('departure');
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidHighways, setAvoidHighways] = useState(false);
  const [routeSettingsBusy, setRouteSettingsBusy] = useState(false);
  const [optimizeRequestNonce, setOptimizeRequestNonce] = useState(0);
  const [optimizationSuggestion, setOptimizationSuggestion] = useState<RouteOptimizationSuggestion | null>(null);
  const [optimizationError, setOptimizationError] = useState('');
  const [optimizationBusy, setOptimizationBusy] = useState(false);
  const canEdit = memberRole === 'owner' || memberRole === 'editor';

  const dayById = useMemo(() => new Map(days.map((day) => [day.id, day])), [days]);
  const dayOrderById = useMemo(() => new Map(days.map((day) => [day.id, day.orderIndex])), [days]);
  const orderCapabilities = useMemo(() => {
    const result = new Map<string, { canMoveUp: boolean; canMoveDown: boolean }>();
    const groups = new Map<string, TripPlaceItem[]>();
    for (const item of items) {
      const key = item.dayId ?? '__unplanned__';
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));
      group.forEach((item, index) => {
        result.set(item.id, { canMoveUp: index > 0, canMoveDown: index < group.length - 1 });
      });
    }
    return result;
  }, [items]);
  const visible = useMemo(() => {
    const filtered = filter === 'all'
      ? items
      : filter === 'unplanned'
        ? items.filter((item) => item.dayId === null)
        : items.filter((item) => item.dayId === filter);

    return [...filtered].sort((a, b) => {
      const aDay = a.dayId === null ? -1 : (dayOrderById.get(a.dayId) ?? Number.MAX_SAFE_INTEGER);
      const bDay = b.dayId === null ? -1 : (dayOrderById.get(b.dayId) ?? Number.MAX_SAFE_INTEGER);
      return aDay - bDay || a.orderIndex - b.orderIndex || a.name.localeCompare(b.name);
    });
  }, [items, filter, dayOrderById]);
  const mappedCount = visible.filter((item) => item.latitude !== null && item.longitude !== null).length;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const routeEnabled = filter !== 'all';
  const activeDay = filter !== 'all' && filter !== 'unplanned' ? dayById.get(filter) ?? null : null;
  const dayItems = activeDay ? visible : [];
  const hotelCandidates = useMemo(() => {
    const mapped = items.filter((item) => item.latitude !== null && item.longitude !== null);
    return [...mapped].sort((a, b) => {
      const ah = a.category === 'Hotel' ? 0 : 1;
      const bh = b.category === 'Hotel' ? 0 : 1;
      return ah - bh || a.name.localeCompare(b.name);
    });
  }, [items]);
  const routePlaces = useMemo(() => {
    if (!activeDay) return visible;
    if (!routeStartId && !routeEndId) return dayItems;
    const start = routeStartId ? items.find((item) => item.id === routeStartId) ?? null : dayItems[0] ?? null;
    const end = routeEndId ? items.find((item) => item.id === routeEndId) ?? null : dayItems[dayItems.length - 1] ?? null;
    const sequence: TripPlaceItem[] = [];
    if (start) sequence.push(start);
    for (const item of dayItems) {
      if (item.id === start?.id || item.id === end?.id) continue;
      sequence.push(item);
    }
    if (end) sequence.push(end); // intentionally allows the same hotel to be both origin and destination.
    return sequence;
  }, [activeDay, dayItems, items, routeEndId, routeStartId, visible]);


  useEffect(() => {
    if (!activeDay) {
      setRouteStartId(''); setRouteEndId(''); setAvoidTolls(false); setAvoidHighways(false);
      setOptimizationSuggestion(null); setOptimizationError('');
      return;
    }
    setRouteStartId(activeDay.routeStartTripPlaceId ?? '');
    setRouteEndId(activeDay.routeEndTripPlaceId ?? '');
    setRouteDepartureTime((activeDay.routeDepartureTime ?? '08:00').slice(0, 5));
    setRouteArrivalTime((activeDay.routeArrivalTime ?? '18:00').slice(0, 5));
    setRouteTimeAnchor(activeDay.routeTimeAnchor === 'arrival' ? 'arrival' : 'departure');
    setAvoidTolls(activeDay.avoidTolls === true);
    setAvoidHighways(activeDay.avoidHighways === true);
    setOptimizationSuggestion(null);
    setOptimizationError('');
  }, [activeDay]);

  function zonedLocalDate(date: string | null, time: string): Date | null {
    if (!date || !time) return null;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
    const targetUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
    let guess = new Date(targetUtc);
    try {
      for (let i = 0; i < 2; i += 1) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tripTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).formatToParts(guess);
        const val = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
        const representedUtc = Date.UTC(val('year'), val('month') - 1, val('day'), val('hour'), val('minute'), val('second'));
        guess = new Date(guess.getTime() + (targetUtc - representedUtc));
      }
      return guess;
    } catch {
      return new Date(`${date}T${time}:00`);
    }
  }

  function formatClock(date: Date | null) {
    if (!date) return 'â€”';
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tripTimezone, hour: 'numeric', minute: '2-digit' }).format(date);
    } catch {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }

  const activeDayDate = activeDay?.date ?? null;
  const plannedDeparture = useMemo(
    () => activeDayDate ? zonedLocalDate(activeDayDate, routeDepartureTime) : null,
    [activeDayDate, routeDepartureTime, tripTimezone],
  );
  const plannedArrival = useMemo(
    () => activeDayDate ? zonedLocalDate(activeDayDate, routeArrivalTime) : null,
    [activeDayDate, routeArrivalTime, tripTimezone],
  );
  const routeStayMinutes = useMemo(() => {
    if (routeSummary.state !== 'ready') return 0;
    return routeSummary.legs.reduce((total, leg, index) => {
      const destination = leg.toId ? items.find((item) => item.id === leg.toId) : null;
      const isExplicitFinalLodging = Boolean(routeEndId) && index === routeSummary.legs.length - 1 && leg.toId === routeEndId;
      return total + (isExplicitFinalLodging ? 0 : Math.max(0, destination?.plannedDurationMinutes ?? 0));
    }, 0);
  }, [items, routeEndId, routeSummary]);

  const dayDurationMillis = routeSummary.durationMillis + routeStayMinutes * 60_000;
  const calculatedArrival = plannedDeparture && routeSummary.state === 'ready'
    ? new Date(plannedDeparture.getTime() + dayDurationMillis) : null;
  const calculatedDeparture = plannedArrival && routeSummary.state === 'ready'
    ? new Date(plannedArrival.getTime() - dayDurationMillis) : null;

  const stopSchedule = useMemo(() => {
    const result = new Map<number, { arrival: Date | null; stayMinutes: number; departure: Date | null }>();
    if (routeSummary.state !== 'ready') return result;
    const start = routeTimeAnchor === 'arrival' ? calculatedDeparture : plannedDeparture;
    if (!start) return result;
    let cursor = new Date(start.getTime());
    routeSummary.legs.forEach((leg, index) => {
      cursor = new Date(cursor.getTime() + leg.durationMillis);
      const arrival = new Date(cursor.getTime());
      const destination = leg.toId ? items.find((item) => item.id === leg.toId) : null;
      const isExplicitFinalLodging = Boolean(routeEndId) && index === routeSummary.legs.length - 1 && leg.toId === routeEndId;
      const stayMinutes = isExplicitFinalLodging ? 0 : Math.max(0, destination?.plannedDurationMinutes ?? 0);
      cursor = new Date(cursor.getTime() + stayMinutes * 60_000);
      result.set(index, { arrival, stayMinutes, departure: stayMinutes > 0 ? new Date(cursor.getTime()) : null });
    });
    return result;
  }, [calculatedDeparture, items, plannedDeparture, routeEndId, routeSummary, routeTimeAnchor]);

  async function saveRouteSettings() {
    if (!activeDay || !canEdit || routeSettingsBusy) return;
    setRouteSettingsBusy(true); setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('update_trip_day_route_settings', {
        p_day_id: activeDay.id,
        p_start_trip_place_id: routeStartId || null,
        p_end_trip_place_id: routeEndId || null,
        p_departure_time: routeDepartureTime || null,
        p_arrival_time: routeArrivalTime || null,
        p_time_anchor: routeTimeAnchor,
        p_avoid_tolls: avoidTolls,
        p_avoid_highways: avoidHighways,
      });
      if (error) throw error;
      await refreshDays();
      await broadcastTripChanged('day_route_settings_updated');
      setMessage(`${activeDay.title} route settings saved.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to save route settings.');
    } finally { setRouteSettingsBusy(false); }
  }

  function requestOptimization() {
    if (!activeDay) return;
    setOptimizationSuggestion(null); setOptimizationError(''); setOptimizationBusy(true);
    setOptimizeRequestNonce((value) => value + 1);
  }

  async function acceptOptimization() {
    if (!activeDay || !optimizationSuggestion || !canEdit) return;
    const dayIdSet = new Set(dayItems.map((item) => item.id));
    const orderedIds: string[] = [];
    for (const id of optimizationSuggestion.orderedPlaceIds) {
      if (dayIdSet.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
    }
    for (const item of dayItems) if (!orderedIds.includes(item.id)) orderedIds.push(item.id);
    setOptimizationBusy(true); setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('apply_day_place_order', {
        p_day_id: activeDay.id,
        p_trip_place_ids: orderedIds,
      });
      if (error) throw error;
      await refreshPlaces();
      await broadcastTripChanged('day_route_order_optimized');
      setOptimizationSuggestion(null);
      setMessage(`${activeDay.title} updated to the suggested route order.`);
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to apply suggested order.'));
    } finally { setOptimizationBusy(false); }
  }

  const refreshPlacesRequestRef = useRef(0);

  const refreshPlaces = useCallback(async () => {
    const requestId = ++refreshPlacesRequestRef.current;

    try {
      const nextItems = await loadTripPlaces(supabaseRef.current!, tripId, userId);

      // Multiple refresh sources can overlap (RPC, Realtime, polling/focus).
      // Only the newest request is allowed to update React state.
      if (requestId !== refreshPlacesRequestRef.current) return;

      setItems(nextItems);
      setSelectedId((current) =>
        current && nextItems.some((item) => item.id === current) ? current : null
      );
    } catch (cause) {
      if (requestId !== refreshPlacesRequestRef.current) return;
      setMessage(cause instanceof Error ? cause.message : 'Unable to refresh trip places.');
    }
  }, [tripId, userId]);

  const refreshMembers = useCallback(async () => {
    try { setMemberCount(await countTripMembers(supabaseRef.current!, tripId)); } catch { /* non-critical */ }
  }, [tripId]);

  const refreshDays = useCallback(async () => {
    try { setDays(await loadTripDays(supabaseRef.current!, tripId)); } catch (cause) {
      console.warn('Unable to refresh trip days', cause);
    }
  }, [tripId]);

  const refreshTripMeta = useCallback(async () => {
    const { data, error } = await supabaseRef.current!
      .from('trips')
      .select('name,start_date,updated_at')
      .eq('id', tripId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      router.replace('/');
      router.refresh();
      return null;
    }
    setTripTitle(data.name);
    setStartDate(data.start_date ?? null);
    return data;
  }, [router, tripId]);

  const broadcastTripChanged = useCallback(async (reason: string) => {
    const channel = realtimeChannelRef.current;
    if (!channel) {
      console.warn('NekoTrip Realtime: no channel available for client broadcast');
      return;
    }

    const result = await channel.send({
      type: 'broadcast',
      event: 'trip_changed',
      payload: { tripId, actorId: userId, reason, sentAt: new Date().toISOString() },
    });

    if (result !== 'ok') {
      console.warn('NekoTrip Realtime: client broadcast did not return ok', result);
    }
  }, [tripId, userId]);

  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const startRealtime = async () => {
      setRealtimeStatus('connecting');

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError || !session?.access_token) {
        console.error('NekoTrip Realtime: no authenticated browser session', sessionError);
        setRealtimeStatus('error');
        return;
      }

      // Private Broadcast channels use Realtime Authorization. Bootstrap the
      // current user JWT before joining the trip-specific topic.
      await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;

      const handleTripChange = (payload: unknown) => {
        console.debug('NekoTrip Realtime broadcast', payload);
        void Promise.all([refreshTripMeta(), refreshDays(), refreshPlaces(), refreshMembers()]);
      };

      channel = supabase
        .channel(`trip:${tripId}`, {
          config: { private: true, broadcast: { self: false, ack: true } },
        })
        .on('broadcast', { event: 'trip_changed' }, handleTripChange)
        .on('broadcast', { event: 'INSERT' }, handleTripChange)
        .on('broadcast', { event: 'UPDATE' }, handleTripChange)
        .on('broadcast', { event: 'DELETE' }, handleTripChange)
        .subscribe((status, error) => {
          if (cancelled) return;
          console.debug('NekoTrip Realtime channel status', status, error ?? '');
          if (status === 'SUBSCRIBED') {
            setRealtimeStatus('live');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.error('NekoTrip Realtime channel status', status, error);
            setRealtimeStatus('error');
          }
        });

      realtimeChannelRef.current = channel;
    };

    void startRealtime();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.access_token) {
        void supabase.realtime.setAuth(nextSession.access_token);
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      realtimeChannelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refreshDays, refreshMembers, refreshPlaces, refreshTripMeta, tripId]);

  // Deterministic database fallback. Broadcast remains the low-latency fast path,
  // but this tiny revision poll guarantees that another editor's committed
  // changes are noticed even if a WebSocket event is dropped or blocked.
  useEffect(() => {
    const supabase = supabaseRef.current!;
    let cancelled = false;

    const checkRevision = async (forceRefresh = false) => {
      if (cancelled || pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const { data, error } = await supabase
          .from('trips')
          .select('name,start_date,updated_at')
          .eq('id', tripId)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          router.replace('/');
          router.refresh();
          return;
        }

        setTripTitle(data.name);
        setStartDate(data.start_date ?? null);
        const revision = data.updated_at ?? null;
        const changed = revision !== null && lastTripRevisionRef.current !== null && revision !== lastTripRevisionRef.current;
        const firstRun = lastTripRevisionRef.current === null;
        lastTripRevisionRef.current = revision;

        if (forceRefresh || firstRun || changed) {
          console.debug('NekoTrip DB sync', { forceRefresh, firstRun, changed, revision });
          await Promise.all([refreshDays(), refreshPlaces(), refreshMembers()]);
        }
      } catch (cause) {
        console.warn('NekoTrip DB fallback sync failed', cause);
      } finally {
        pollBusyRef.current = false;
      }
    };

    void checkRevision(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkRevision(false);
    }, 2500);
    const onFocus = () => void checkRevision(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkRevision(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshDays, refreshMembers, refreshPlaces, router, tripId]);

  const selectPlace = useCallback((id: string) => setSelectedId(id), []);

  async function searchPlaces() {
    const text = query.trim();
    if (!text) return;
    if (!providerRef.current) {
      setMessage('Google Maps API key å°šæœªè¨­å®šã€‚è«‹å…ˆå®Œæˆ .env.local è¨­å®šã€‚');
      return;
    }
    setSearching(true);
    setMessage('');
    try {
      const found = await providerRef.current.search(text);
      setResults(found);
      if (found.length === 0) setMessage('Google Places æ‰¾ä¸åˆ°ç¬¦åˆçš„åœ°é»žï¼Œè«‹æ›å€‹åç¨±æˆ–åŠ ä¸ŠåŸŽå¸‚åç¨±ã€‚');
    } catch (cause) {
      setResults([]);
      setMessage(cause instanceof Error ? cause.message : 'Google Places search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function persistPlace(place: PlaceSearchResult | null) {
    if (!canEdit) return;
    const name = place?.name ?? query.trim();
    if (!name) return;
    setMessage('');
    try {
      const { data, error } = await supabaseRef.current!.rpc('add_trip_place', {
        p_trip_id: tripId,
        p_name: name,
        p_provider: place?.provider ?? 'manual',
        p_provider_place_id: place?.providerPlaceId ?? null,
        p_formatted_address: place?.formattedAddress ?? null,
        p_latitude: place?.latitude ?? null,
        p_longitude: place?.longitude ?? null,
        p_day_id: dayId || null,
        p_category: category,
        p_rating: priority,
      });
      if (error) throw error;
      setSelectedId(typeof data === 'string' ? data : null);
      setQuery('');
      setResults([]);
      setMessage(`å·²åŠ å…¥ ${name}ã€‚è³‡æ–™å·²å­˜é€² Supabaseï¼Œå…¶ä»–é–‹è‘—é€™è¶Ÿæ—…ç¨‹çš„äººæœƒå³æ™‚æ”¶åˆ°æ›´æ–°ã€‚`);
      await refreshPlaces();
      await broadcastTripChanged('place_added');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to add place.');
    }
  }

  async function deletePlace(id: string) {
    if (!canEdit) return;
    try {
      const { error } = await supabaseRef.current!.rpc('delete_trip_place', { p_trip_place_id: id });
      if (error) throw error;
      if (selectedId === id) setSelectedId(null);
      await refreshPlaces();
      await broadcastTripChanged('place_deleted');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to delete place.');
    }
  }

  async function updatePlaceDetails(
    id: string,
    changes: { dayId?: string | null; category?: string; priority?: number },
  ) {
    if (!canEdit || busyPlaceId) return;
    const current = items.find((item) => item.id === id);
    if (!current) return;

    const nextDayId = changes.dayId !== undefined ? changes.dayId : current.dayId;
    const nextCategory = changes.category ?? current.category;
    const nextPriority = changes.priority ?? current.priority;

    const previousItems = items;

    setBusyPlaceId(id);
    setMessage('');

    // Keep the controlled selectors stable while the RPC is in flight.
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id
          ? {
              ...item,
              dayId: nextDayId,
              category: nextCategory,
              priority: nextPriority,
            }
          : item
      )
    );

    try {
      const { error } = await supabaseRef.current!.rpc('update_trip_place_details', {
        p_trip_place_id: id,
        p_day_id: nextDayId,
        p_category: nextCategory,
        p_rating: nextPriority,
      });
      if (error) throw error;
      await refreshPlaces();
      await broadcastTripChanged('place_updated');
    } catch (cause) {
      setItems(previousItems);
      setMessage(cause instanceof Error ? cause.message : 'Unable to update place.');
    } finally {
      setBusyPlaceId(null);
    }
  }

  async function updateStayDuration(id: string, minutes: number) {
    if (!canEdit || busyPlaceId) return;
    const cleanMinutes = Math.max(0, Math.min(1440, Math.round(minutes || 0)));
    setBusyPlaceId(id);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('update_trip_place_duration', {
        p_trip_place_id: id,
        p_minutes: cleanMinutes,
      });
      if (error) throw error;
      await refreshPlaces();
      await broadcastTripChanged('place_duration_updated');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to update stay duration.');
    } finally {
      setBusyPlaceId(null);
    }
  }

  async function reorderPlace(id: string, direction: 'up' | 'down') {
    if (!canEdit || busyPlaceId) return;
    setBusyPlaceId(id);
    setMessage('');
    try {
      const { error } = await supabaseRef.current!.rpc('reorder_trip_place', {
        p_trip_place_id: id,
        p_direction: direction,
      });
      if (error) throw error;
      await refreshPlaces();
      await broadcastTripChanged('place_reordered');
    } catch (cause) {
      setMessage(errorMessage(cause, 'Unable to reorder place.'));
    } finally {
      setBusyPlaceId(null);
    }
  }

  return <main className="tripShell">
    <header className="tripHeader">
      <div>
        <div className="eyebrow">NekoTrip Â· {memberRole}</div>
        <h1>{tripTitle}</h1>
        <div className="subtitle">{userName} Â· <span className={realtimeStatus === 'live' ? 'liveText' : realtimeStatus === 'error' ? 'errorText' : ''}>{realtimeStatus === 'live' ? 'â— Live sync Â· realtime + DB fallback' : realtimeStatus === 'error' ? 'â— Live sync Â· DB fallback' : 'â—‹ Connecting realtime Â· DB fallback active'}</span></div>
      </div>
      <div className="headerActions">
        <div className="memberPill"><span className="onlineDot" /> {memberCount} member{memberCount === 1 ? '' : 's'}</div>
        <ShareTripButton tripId={tripId} userId={userId} canInvite={memberRole === 'owner'} />
        <TripSettingsButton
          tripId={tripId}
          tripName={tripTitle}
          tripStartDate={startDate}
          tripEndDate={endDate}
          memberRole={memberRole}
          onRenamed={(nextName) => {
            setTripTitle(nextName);
            void broadcastTripChanged('trip_renamed');
          }}
          onDatesChanged={(nextStartDate, nextEndDate) => {
            setStartDate(nextStartDate);
            setEndDate(nextEndDate);
            void refreshDays();
            void broadcastTripChanged('trip_dates_changed');
          }}
          onBeforeDelete={() => broadcastTripChanged('trip_deleting')}
        />
        <Link className="secondaryLink" href="/wishlist">Wish List</Link>
        <Link className="secondaryLink" href="/">Trips</Link>
      </div>
    </header>

    <div className="workspaceGrid">
      <section className="panel itineraryPanel">
        <div className="sectionHeading">
          <div><strong>Add place</strong><small>{canEdit ? 'Search Google Places; every change is persisted and synced.' : 'Viewer access: browse only.'}</small></div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void searchPlaces(); }} className="placeForm">
          <input value={query} disabled={!canEdit} onChange={(event) => { setQuery(event.target.value); setResults([]); setMessage(''); }} placeholder="ä¾‹å¦‚ï¼šè»½äº•æ²¢ãƒ—ãƒªãƒ³ã‚¹ã‚·ãƒ§ãƒƒãƒ”ãƒ³ã‚°ãƒ—ãƒ©ã‚¶" aria-label="Place search" />
          <div className="formRow">
            <select value={dayId} disabled={!canEdit} onChange={(event) => setDayId(event.target.value)} aria-label="Trip day">
              <option value="">Unplanned</option>
              {days.map((value) => <option key={value.id} value={value.id}>{value.title}{value.date ? ` Â· ${value.date}` : ''}</option>)}
            </select>
            <select value={category} disabled={!canEdit} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
              {categories.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
          <div className="formRow">
            <select value={priority} disabled={!canEdit} onChange={(event) => setPriority(Number(event.target.value))} aria-label="Your priority">
              {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{'â˜…'.repeat(value)}{'â˜†'.repeat(5 - value)}</option>)}
            </select>
            <button className="primaryButton" type="submit" disabled={!canEdit || searching || !query.trim()}>{searching ? 'Searchingâ€¦' : 'Search Google'}</button>
          </div>
          <button className="secondaryButton" type="button" disabled={!canEdit || !query.trim()} onClick={() => void persistPlace(null)}>Add manually without map location</button>
        </form>

        {message && <div className="statusMessage" role="status">{message}</div>}

        {results.length > 0 && <div className="searchResults" aria-label="Google Places search results">
          <div className="resultsLabel">Google Places results</div>
          {results.map((result) => <button type="button" className="searchResult" key={result.providerPlaceId} onClick={() => void persistPlace(result)}>
            <span className="resultPin">ðŸ“</span>
            <span className="resultText"><strong>{result.name}</strong><small>{result.formattedAddress || 'Address unavailable'}</small></span>
            <span className="addResult">Add</span>
          </button>)}
        </div>}

        <div className="filters">
          <button type="button" onClick={() => setFilter('all')} className={filter === 'all' ? 'filter active' : 'filter'}>All</button>
          <button type="button" onClick={() => setFilter('unplanned')} className={filter === 'unplanned' ? 'filter active' : 'filter'}>Unplanned</button>
          {days.map((value) => <button key={value.id} type="button" onClick={() => setFilter(value.id)} className={filter === value.id ? 'filter active' : 'filter'}>{value.title}</button>)}
        </div>

        <div className="placeList">
          {visible.length === 0 && <div className="emptyState">No places in this view.</div>}
          {visible.map((place, placeIndex) => <article key={place.id} className={selectedId === place.id ? 'placeCard selected' : 'placeCard'} onClick={() => selectPlace(place.id)}>
            <div className="placeCardTop">
              <button type="button" className="placeSelect" onClick={() => selectPlace(place.id)}>
                <span className="placeOrderBadge" aria-label={`Stop ${placeIndex + 1}`}>{placeIndex + 1}</span>
                <span className="placeCategoryIcon">{categoryIcons[place.category] ?? 'ðŸ“'}</span>
                <span><strong>{place.name}</strong>{place.formattedAddress && <small>{place.formattedAddress}</small>}</span>
              </button>
              {canEdit && <button type="button" className="deleteButton" onClick={(event) => { event.stopPropagation(); void deletePlace(place.id); }} aria-label={`Delete ${place.name}`}>Delete</button>}
            </div>
            <GooglePlaceDetailsCard
              apiKey={apiKey}
              providerPlaceId={place.providerPlaceId}
              fallbackAddress={place.formattedAddress}
              placeName={place.name}
              category={place.category}
              compact
            />
            <div className="placeControls" onClick={(event) => event.stopPropagation()}>
              <label className="compactField">
                <span>Day</span>
                <select
                  className="inlineMetaSelect"
                  value={place.dayId ?? ''}
                  disabled={!canEdit || busyPlaceId === place.id}
                  onChange={(event) => void updatePlaceDetails(place.id, { dayId: event.target.value || null })}
                  aria-label={`Move ${place.name} to day`}
                >
                  <option value="">Unplanned</option>
                  {days.map((value) => <option key={value.id} value={value.id}>{value.title}{value.date ? ` Â· ${value.date}` : ''}</option>)}
                </select>
              </label>

              <label className="compactField">
                <span>Type</span>
                <select
                  className="inlineMetaSelect"
                  value={place.category}
                  disabled={!canEdit || busyPlaceId === place.id}
                  onChange={(event) => void updatePlaceDetails(place.id, { category: event.target.value })}
                  aria-label={`Change ${place.name} category`}
                >
                  {categories.map((value) => <option key={value} value={value}>{categoryIcons[value] ?? 'ðŸ“'} {value}</option>)}
                </select>
              </label>

              <label className="compactField">
                <span>Your stars</span>
                <select
                  className="inlineMetaSelect starSelect"
                  value={place.priority}
                  disabled={!canEdit || busyPlaceId === place.id}
                  onChange={(event) => void updatePlaceDetails(place.id, { priority: Number(event.target.value) })}
                  aria-label={`Change your rating for ${place.name}`}
                >
                  {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{'â˜…'.repeat(value)}{'â˜†'.repeat(5 - value)}</option>)}
                </select>
              </label>

              <label className="compactField">
                <span>Stay (min)</span>
                <input
                  className="inlineMetaSelect stayMinutesInput"
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={place.plannedDurationMinutes ?? 0}
                  disabled={!canEdit || busyPlaceId === place.id}
                  onChange={(event) => void updateStayDuration(place.id, Number(event.target.value))}
                  aria-label={`Set stay duration for ${place.name}`}
                />
              </label>

              <div className="compactField orderField">
                <span>Order</span>
                <div className="orderButtons">
                  <button
                    type="button"
                    className="orderButton"
                    disabled={!canEdit || busyPlaceId === place.id || !orderCapabilities.get(place.id)?.canMoveUp}
                    onClick={() => void reorderPlace(place.id, 'up')}
                    aria-label={`Move ${place.name} earlier`}
                    title="Move earlier"
                  >â†‘</button>
                  <button
                    type="button"
                    className="orderButton"
                    disabled={!canEdit || busyPlaceId === place.id || !orderCapabilities.get(place.id)?.canMoveDown}
                    onClick={() => void reorderPlace(place.id, 'down')}
                    aria-label={`Move ${place.name} later`}
                    title="Move later"
                  >â†“</button>
                </div>
              </div>
              {place.latitude === null && <span className="unmappedBadge controlBadge">Unmapped</span>}
            </div>
          </article>)}
        </div>
      </section>

      <section className="panel mapPanel">
        <div className="mapHeader">
          <div><strong>Trip Map</strong><small>Choose a day to draw its route. Reordering stops recalculates the route automatically.</small></div>
          <span>{mappedCount} mapped / {visible.length} visible</span>
        </div>

        <div className="routeControls">
          <label>
            <span>Route mode</span>
            <select value={routeMode} onChange={(event) => setRouteMode(event.target.value as RouteMode)}>
              <option value="DRIVING">ðŸš— Drive</option>
              <option value="TRANSIT">ðŸš† Transit</option>
              <option value="WALKING">ðŸš¶ Walk</option>
            </select>
          </label>
          <label className="trafficToggle">
            <input
              type="checkbox"
              checked={trafficAware}
              disabled={routeMode !== 'DRIVING'}
              onChange={(event) => setTrafficAware(event.target.checked)}
            />
            <span>Use live traffic</span>
          </label>
          <div className="routeContext">
            {routeEnabled
              ? <><strong>{filter === 'unplanned' ? 'Unplanned' : dayById.get(filter)?.title ?? 'Day'}</strong><small>Route follows the current stop order.</small></>
              : <><strong>Select a day</strong><small>â€œAllâ€ view does not draw a multi-day route.</small></>}
          </div>
        </div>

        {activeDay && <div className="dayRoutePlanner">
          <div className="dayRoutePlannerHeader">
            <div><strong>{activeDay.title} route plan</strong><small>Hotel endpoints, schedule and driving preferences are saved per day.</small></div>
            <button className="secondaryButton compactButton" type="button" disabled={!canEdit || routeSettingsBusy} onClick={() => void saveRouteSettings()}>{routeSettingsBusy ? 'Savingâ€¦' : 'Save day route'}</button>
          </div>
          <div className="dayRoutePlannerGrid">
            <label><span>Start / lodging</span><select value={routeStartId} onChange={(e) => setRouteStartId(e.target.value)}><option value="">Use first itinerary stop</option>{hotelCandidates.map((item) => <option key={`start-${item.id}`} value={item.id}>{item.category === 'Hotel' ? 'ðŸ¨ ' : ''}{item.name}</option>)}</select></label>
            <label><span>End / lodging</span><select value={routeEndId} onChange={(e) => setRouteEndId(e.target.value)}><option value="">Use last itinerary stop</option>{hotelCandidates.map((item) => <option key={`end-${item.id}`} value={item.id}>{item.category === 'Hotel' ? 'ðŸ¨ ' : ''}{item.name}</option>)}</select></label>
            <label><span>Depart at</span><input type="time" value={routeDepartureTime} onChange={(e) => setRouteDepartureTime(e.target.value)} /></label>
            <label><span>Arrive by</span><input type="time" value={routeArrivalTime} onChange={(e) => setRouteArrivalTime(e.target.value)} /></label>
          </div>
          <div className="routePreferenceRow">
            <div className="routeTimeAnchor"><span>Routing time</span><label><input type="radio" name="routeTimeAnchor" checked={routeTimeAnchor === 'departure'} onChange={() => setRouteTimeAnchor('departure')} /> Depart at</label><label><input type="radio" name="routeTimeAnchor" checked={routeTimeAnchor === 'arrival'} onChange={() => setRouteTimeAnchor('arrival')} /> Arrive by</label></div>
            <label className="trafficToggle"><input type="checkbox" checked={avoidTolls} onChange={(e) => setAvoidTolls(e.target.checked)} /><span>Avoid tolls</span></label>
            <label className="trafficToggle"><input type="checkbox" checked={avoidHighways} onChange={(e) => setAvoidHighways(e.target.checked)} /><span>Avoid highways</span></label>
            <button className="secondaryButton compactButton" type="button" disabled={!canEdit || optimizationBusy || routeMode === 'TRANSIT' || routePlaces.filter((item) => item.latitude !== null && item.longitude !== null).length < 3} onClick={requestOptimization}>{optimizationBusy ? 'Optimizingâ€¦' : 'Suggest best order'}</button>
          </div>
          {optimizationError && <div className="routeHint routeHintError">{optimizationError}</div>}
          {optimizationSuggestion && <div className="optimizationSuggestion">
            <div><span>Suggested route</span><strong>{optimizationSuggestion.distance} Â· {optimizationSuggestion.duration}</strong><small>Preview only â€” nothing changes until you accept it.</small></div>
            <div className="optimizationOrder">{optimizationSuggestion.orderedPlaceIds.map((id, index) => <span key={`${id}-${index}`}>{index + 1}. {items.find((item) => item.id === id)?.name ?? 'Stop'}</span>)}</div>
            <div className="optimizationActions"><button className="secondaryButton compactButton" type="button" onClick={() => setOptimizationSuggestion(null)}>Keep current order</button><button className="primaryButton compactButton" type="button" disabled={optimizationBusy} onClick={() => void acceptOptimization()}>Accept suggested order</button></div>
          </div>}
        </div>}

        <GoogleTripMap
          apiKey={apiKey}
          mapId={mapId}
          places={visible}
          routePlaces={routePlaces}
          selectedId={selectedId}
          onSelect={selectPlace}
          routeEnabled={routeEnabled}
          routeMode={routeMode}
          trafficAware={trafficAware}
          avoidTolls={avoidTolls}
          avoidHighways={avoidHighways}
          departureTime={plannedDeparture}
          arrivalTime={plannedArrival}
          timeAnchor={routeTimeAnchor}
          optimizeRequestNonce={optimizeRequestNonce}
          onOptimizationSuggestion={(suggestion, error) => {
            setOptimizationBusy(false);
            setOptimizationSuggestion(suggestion);
            setOptimizationError(error ?? '');
          }}
          onRouteSummary={setRouteSummary}
        />

        <div className="routeSummaryPanel">
          <div className="routeSummaryTop">
            <div>
              <div className="selectedLabel">Live route</div>
              <strong>{routeMode === 'DRIVING' ? 'ðŸš— Driving' : routeMode === 'TRANSIT' ? 'ðŸš† Transit' : 'ðŸš¶ Walking'}</strong>
            </div>
            {routeSummary.state === 'loading'
              ? <span className="routeStatus">Calculatingâ€¦</span>
              : routeSummary.state === 'ready'
                ? <span className="routeStatus ready">Updated</span>
                : routeSummary.state === 'error'
                  ? <span className="routeStatus error">Route error</span>
                  : <span className="routeStatus">Waiting</span>}
          </div>

          {!routeEnabled && <div className="routeHint">Choose Day 1 / Day 2 / Unplanned to calculate a route for that group.</div>}
          {routeEnabled && mappedCount < visible.length && <div className="routeHint">{visible.length - mappedCount} unmapped stop{visible.length - mappedCount === 1 ? '' : 's'} will be skipped until a map location is attached.</div>}
          {routeEnabled && routeMode === 'TRANSIT' && <div className="routeHint">Transit uses Googleâ€™s current/default departure-time context until NekoTrip stores a departure time for the day.</div>}
          {routeEnabled && routeSummary.error && <div className="routeHint routeHintError">{routeSummary.error}</div>}
          {routeEnabled && routeSummary.state === 'ready' && <>
            <div className="routeTotals">
              <div><span>Distance</span><strong>{routeSummary.distance}</strong></div>
              <div><span>Travel time</span><strong>{routeSummary.duration}</strong></div>
              <div><span>Stops</span><strong>{routePlaces.filter((item) => item.latitude !== null && item.longitude !== null).length}</strong></div>
              <div><span>Traffic</span><strong>{routeMode === 'DRIVING' && trafficAware ? 'Live' : 'Standard'}</strong></div>
            </div>
            {activeDay && <div className="routeScheduleSummary">
              <div><span>Planned departure</span><strong>{formatClock(plannedDeparture)}</strong></div>
              <div><span>{routeTimeAnchor === 'arrival' ? 'Estimated departure' : 'Estimated arrival'}</span><strong>{routeTimeAnchor === 'arrival' ? formatClock(calculatedDeparture) : formatClock(calculatedArrival)}</strong></div>
              <div><span>Arrive by</span><strong>{formatClock(plannedArrival)}</strong></div>
              <div><span>Day total</span><strong>{Math.floor(dayDurationMillis / 3600000) > 0 ? `${Math.floor(dayDurationMillis / 3600000)} hr ` : ''}{Math.round((dayDurationMillis % 3600000) / 60000)} min Â· {routeSummary.distance}</strong><small>{routeSummary.duration} travel + {routeStayMinutes} min stops</small></div>
            </div>}
            {routeSummary.legs.length > 0 && <div className="routeLegs">
              {routeSummary.legs.map((leg, index) => {
                const schedule = stopSchedule.get(index);
                return <div className="routeLeg" key={`${leg.from}-${leg.to}-${index}`}>
                  <span className="routeLegNumber">{index + 1}</span>
                  <div>
                    <strong>{leg.from} â†’ {leg.to}</strong>
                    <small>{leg.distance} Â· {leg.duration}</small>
                    {schedule && <div className="routeStopTiming">
                      <span><b>{formatClock(schedule.arrival)}</b> arrival</span>
                      {schedule.stayMinutes > 0 && <span>{schedule.stayMinutes} min stay Â· depart {formatClock(schedule.departure)}</span>}
                    </div>}
                  </div>
                </div>;
              })}
            </div>}
            {routeSummary.warnings.length > 0 && <div className="routeWarnings">
              {routeSummary.warnings.map((warning, index) => <small key={`${warning}-${index}`}>âš ï¸ {warning}</small>)}
            </div>}
          </>}
        </div>

        <div className="selectedPanel">
          {selected ? <>
            <div className="selectedLabel">Selected place</div>
            <strong>{categoryIcons[selected.category] ?? 'ðŸ“'} {selected.name}</strong>
            <small>{selected.formattedAddress || 'No mapped address yet'}</small>
            <div className="selectedMeta">{selected.dayId ? dayById.get(selected.dayId)?.title ?? 'Day' : 'Unplanned'} Â· {selected.category} Â· {'â˜…'.repeat(selected.priority)}{'â˜†'.repeat(5 - selected.priority)}</div>
            {selected.providerPlaceId && <code className="placeId">Google Place ID: {selected.providerPlaceId}</code>}
          </> : <><div className="selectedLabel">Selected place</div><span className="muted">Choose a place card or marker.</span></>}
        </div>
      </section>
    </div>
    <footer className="tripFooter">Trip slug: <code>{tripSlug}</code></footer>
  </main>;
}

