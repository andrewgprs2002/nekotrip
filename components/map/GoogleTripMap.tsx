'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps/loader';

export interface MapPlace {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

export type RouteMode = 'DRIVING' | 'TRANSIT' | 'WALKING';

export interface RouteLegSummary {
  from: string;
  to: string;
  fromId: string | null;
  toId: string | null;
  distance: string;
  duration: string;
  durationMillis: number;
}

export interface RouteSummary {
  state: 'idle' | 'loading' | 'ready' | 'error';
  mode: RouteMode;
  distance: string;
  duration: string;
  distanceMeters: number;
  durationMillis: number;
  legs: RouteLegSummary[];
  warnings: string[];
  error?: string;
}

export interface RouteOptimizationSuggestion {
  orderedPlaceIds: string[];
  distance: string;
  duration: string;
  distanceMeters: number;
  durationMillis: number;
}

interface GoogleTripMapProps {
  apiKey: string;
  mapId?: string;
  places: MapPlace[];
  routePlaces?: MapPlace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  routeEnabled?: boolean;
  routeMode?: RouteMode;
  trafficAware?: boolean;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  departureTime?: Date | null;
  arrivalTime?: Date | null;
  timeAnchor?: 'departure' | 'arrival';
  optimizeRequestNonce?: number;
  onOptimizationSuggestion?: (suggestion: RouteOptimizationSuggestion | null, error?: string) => void;
  onRouteSummary?: (summary: RouteSummary) => void;
  onViewportPlaceIdsChange?: (ids: string[]) => void;
}

type RouteLike = {
  distanceMeters?: number;
  durationMillis?: number;
  localizedValues?: { distance?: string; duration?: string };
  optimizedIntermediateWaypointIndices?: number[];
  legs?: Array<{
    distanceMeters?: number;
    durationMillis?: number;
    localizedValues?: { distance?: string; duration?: string };
  }>;
  warnings?: string[];
  viewport?: google.maps.LatLngBounds;
  createPolylines: () => google.maps.Polyline[];
};

type RouteClassLike = {
  computeRoutes: (request: Record<string, unknown>) => Promise<{ routes?: RouteLike[] }>;
};

function formatDistance(meters?: number) {
  if (!Number.isFinite(meters)) return '—';
  if ((meters ?? 0) < 1000) return `${Math.round(meters ?? 0)} m`;
  return `${((meters ?? 0) / 1000).toFixed((meters ?? 0) >= 10000 ? 0 : 1)} km`;
}

function formatDuration(milliseconds?: number) {
  if (!Number.isFinite(milliseconds)) return '—';
  const totalMinutes = Math.max(0, Math.round((milliseconds ?? 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function emptySummary(mode: RouteMode, state: RouteSummary['state'] = 'idle', error?: string): RouteSummary {
  return { state, mode, distance: '—', duration: '—', distanceMeters: 0, durationMillis: 0, legs: [], warnings: [], error };
}

export function GoogleTripMap({
  apiKey,
  mapId,
  places,
  routePlaces,
  selectedId,
  onSelect,
  routeEnabled = false,
  routeMode = 'DRIVING',
  trafficAware = false,
  avoidTolls = false,
  avoidHighways = false,
  departureTime = null,
  arrivalTime = null,
  timeAnchor = 'departure',
  optimizeRequestNonce = 0,
  onOptimizationSuggestion,
  onRouteSummary,
  onViewportPlaceIdsChange,
}: GoogleTripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const routePolylinesRef = useRef<google.maps.Polyline[]>([]);
  const routeRequestRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappedPlaces = useMemo(
    () => places.filter((place): place is MapPlace & { latitude: number; longitude: number } =>
      typeof place.latitude === 'number' && typeof place.longitude === 'number'),
    [places],
  );

  const mappedRoutePlaces = useMemo(
    () => (routePlaces ?? places).filter((place): place is MapPlace & { latitude: number; longitude: number } =>
      typeof place.latitude === 'number' && typeof place.longitude === 'number'),
    [places, routePlaces],
  );

  const displayPlaces = useMemo(() => {
    const result: Array<MapPlace & { latitude: number; longitude: number }> = [];
    const seen = new Set<string>();
    // When planning a route, number markers in the same order the route uses.
    // Any other visible mapped places are appended afterwards.
    const ordered = routeEnabled
      ? [...mappedRoutePlaces, ...mappedPlaces]
      : [...mappedPlaces, ...mappedRoutePlaces];
    for (const place of ordered) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      result.push(place);
    }
    return result;
  }, [mappedPlaces, mappedRoutePlaces, routeEnabled]);

  const routeKey = useMemo(
    () => mappedRoutePlaces.map((place, index) => `${index}:${place.id}:${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`).join('|'),
    [mappedRoutePlaces],
  );

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      if (!containerRef.current || !apiKey) return;
      try {
        await loadGoogleMaps(apiKey);
        const { Map } = await google.maps.importLibrary('maps') as google.maps.MapsLibrary;
        if (cancelled || !containerRef.current) return;
        mapRef.current = new Map(containerRef.current, {
          center: { lat: 36.2, lng: 138.25 }, zoom: 5, mapId: mapId || 'DEMO_MAP_ID',
          streetViewControl: false, mapTypeControl: false, fullscreenControl: false, gestureHandling: 'greedy',
        });
        setReady(true);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load Google Maps.');
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [apiKey, mapId]);

  useEffect(() => {
    if (!ready || !mapRef.current || !onViewportPlaceIdsChange) return;
    const map = mapRef.current;
    const publishViewport = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      onViewportPlaceIdsChange(mappedPlaces
        .filter((place) => bounds.contains({ lat: place.latitude, lng: place.longitude }))
        .map((place) => place.id));
    };
    const listener = map.addListener('idle', publishViewport);
    publishViewport();
    return () => listener.remove();
  }, [mappedPlaces, onViewportPlaceIdsChange, ready]);

  useEffect(() => {
    let cancelled = false;
    async function renderMarkers() {
      if (!ready || !mapRef.current) return;
      for (const marker of markersRef.current) marker.map = null;
      markersRef.current = [];

      const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker') as google.maps.MarkerLibrary;
      if (cancelled || !mapRef.current) return;
      const bounds = new google.maps.LatLngBounds();

      displayPlaces.forEach((place, index) => {
        const position = { lat: place.latitude, lng: place.longitude };
        const pin = new PinElement({ glyph: String(index + 1), scale: selectedId === place.id ? 1.25 : 1 });
        const marker = new AdvancedMarkerElement({
          map: mapRef.current!, position, title: place.name, content: pin.element,
          gmpClickable: true, zIndex: selectedId === place.id ? 1000 : index + 1,
        });
        marker.addListener('click', () => onSelect(place.id));
        markersRef.current.push(marker);
        bounds.extend(position);
      });

      if (!routeEnabled || mappedRoutePlaces.length < 2) {
        if (displayPlaces.length === 1) {
          mapRef.current.setCenter(bounds.getCenter());
          mapRef.current.setZoom(13);
        } else if (displayPlaces.length > 1) {
          mapRef.current.fitBounds(bounds, 72);
        }
      }
    }

    void renderMarkers().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to render map markers.');
    });
    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.map = null;
      markersRef.current = [];
    };
  }, [displayPlaces, mappedRoutePlaces.length, onSelect, ready, routeEnabled, selectedId]);

  useEffect(() => {
    const requestId = ++routeRequestRef.current;
    let cancelled = false;

    const clearRoute = () => {
      for (const polyline of routePolylinesRef.current) polyline.setMap(null);
      routePolylinesRef.current = [];
    };

    async function renderRoute() {
      clearRoute();
      if (!routeEnabled) {
        onRouteSummary?.(emptySummary(routeMode));
        return;
      }
      if (!ready || !mapRef.current) return;
      if (mappedRoutePlaces.length < 2) {
        onRouteSummary?.(emptySummary(routeMode, 'idle', '至少需要 2 個有地圖座標的停靠點才能規劃路線。'));
        return;
      }
      if (mappedRoutePlaces.length > 27) {
        onRouteSummary?.(emptySummary(routeMode, 'error', '單一路線最多支援 27 個停靠點（25 個中途點）。請把行程拆成不同天。'));
        return;
      }

      onRouteSummary?.(emptySummary(routeMode, 'loading'));

      try {
        await loadGoogleMaps(apiKey);
        const { Route } = await google.maps.importLibrary('routes') as unknown as { Route: RouteClassLike };
        const baseFields = ['path', 'distanceMeters', 'durationMillis', 'localizedValues', 'legs', 'viewport', 'warnings'];
        let routesUsed: RouteLike[] = [];

        if (routeMode === 'TRANSIT') {
          // Transit cannot use intermediate waypoints, so compose the day one leg at a time.
          // When planning by arrival time, work backwards so every leg has a coherent schedule.
          if (timeAnchor === 'arrival' && arrivalTime) {
            let nextArrival = arrivalTime;
            for (let index = mappedRoutePlaces.length - 2; index >= 0; index -= 1) {
              const from = mappedRoutePlaces[index];
              const to = mappedRoutePlaces[index + 1];
              const response = await Route.computeRoutes({
                origin: { lat: from.latitude, lng: from.longitude },
                destination: { lat: to.latitude, lng: to.longitude },
                travelMode: 'TRANSIT', language: 'zh-TW', fields: baseFields,
                arrivalTime: nextArrival,
              });
              if (cancelled || requestId !== routeRequestRef.current) return;
              const legRoute = response.routes?.[0];
              if (!legRoute) throw new Error(`找不到 ${from.name} → ${to.name} 的大眾運輸路線。`);
              routesUsed.unshift(legRoute);
              nextArrival = new Date(nextArrival.getTime() - (legRoute.durationMillis ?? 0));
            }
          } else {
            let nextDeparture = departureTime;
            for (let index = 0; index < mappedRoutePlaces.length - 1; index += 1) {
              const from = mappedRoutePlaces[index];
              const to = mappedRoutePlaces[index + 1];
              const request: Record<string, unknown> = {
                origin: { lat: from.latitude, lng: from.longitude },
                destination: { lat: to.latitude, lng: to.longitude },
                travelMode: 'TRANSIT', language: 'zh-TW', fields: baseFields,
              };
              if (nextDeparture) request.departureTime = nextDeparture;
              const response = await Route.computeRoutes(request);
              if (cancelled || requestId !== routeRequestRef.current) return;
              const legRoute = response.routes?.[0];
              if (!legRoute) throw new Error(`找不到 ${from.name} → ${to.name} 的大眾運輸路線。`);
              routesUsed.push(legRoute);
              if (nextDeparture) nextDeparture = new Date(nextDeparture.getTime() + (legRoute.durationMillis ?? 0));
            }
          }
        } else {
          const request: Record<string, unknown> = {
            origin: { lat: mappedRoutePlaces[0].latitude, lng: mappedRoutePlaces[0].longitude },
            destination: { lat: mappedRoutePlaces[mappedRoutePlaces.length - 1].latitude, lng: mappedRoutePlaces[mappedRoutePlaces.length - 1].longitude },
            intermediates: mappedRoutePlaces.slice(1, -1).map((place) => ({ location: { lat: place.latitude, lng: place.longitude } })),
            travelMode: routeMode,
            language: 'zh-TW',
            fields: baseFields,
          };
          if (routeMode === 'DRIVING') {
            request.routeModifiers = { avoidTolls, avoidHighways };
            request.routingPreference = trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE';
            if (timeAnchor === 'departure' && departureTime && departureTime.getTime() > Date.now()) request.departureTime = departureTime;
          }
          const response = await Route.computeRoutes(request);
          if (cancelled || requestId !== routeRequestRef.current) return;
          const route = response.routes?.[0];
          if (!route) throw new Error('Google Routes 找不到這組停靠點之間的可用路線。');
          routesUsed = [route];
        }

        if (cancelled || requestId !== routeRequestRef.current) return;
        const allPolylines = routesUsed.flatMap((route) => route.createPolylines());
        allPolylines.forEach((polyline) => polyline.setMap(mapRef.current));
        routePolylinesRef.current = allPolylines;

        const routeBounds = new google.maps.LatLngBounds();
        for (const route of routesUsed) if (route.viewport) routeBounds.union(route.viewport);
        if (!routeBounds.isEmpty() && mapRef.current) mapRef.current.fitBounds(routeBounds, 72);

        let totalDistance = 0;
        let totalDuration = 0;
        const warnings: string[] = [];
        const legs: RouteLegSummary[] = [];

        if (routeMode === 'TRANSIT') {
          routesUsed.forEach((route, index) => {
            totalDistance += route.distanceMeters ?? 0;
            totalDuration += route.durationMillis ?? 0;
            warnings.push(...(route.warnings ?? []));
            legs.push({
              from: mappedRoutePlaces[index]?.name ?? `Stop ${index + 1}`,
              to: mappedRoutePlaces[index + 1]?.name ?? `Stop ${index + 2}`,
              fromId: mappedRoutePlaces[index]?.id ?? null,
              toId: mappedRoutePlaces[index + 1]?.id ?? null,
              distance: route.localizedValues?.distance ?? formatDistance(route.distanceMeters),
              duration: route.localizedValues?.duration ?? formatDuration(route.durationMillis),
              durationMillis: route.durationMillis ?? 0,
            });
          });
        } else {
          const route = routesUsed[0];
          totalDistance = route.distanceMeters ?? 0;
          totalDuration = route.durationMillis ?? 0;
          warnings.push(...(route.warnings ?? []));
          (route.legs ?? []).forEach((leg, index) => {
            legs.push({
              from: mappedRoutePlaces[index]?.name ?? `Stop ${index + 1}`,
              to: mappedRoutePlaces[index + 1]?.name ?? `Stop ${index + 2}`,
              fromId: mappedRoutePlaces[index]?.id ?? null,
              toId: mappedRoutePlaces[index + 1]?.id ?? null,
              distance: leg.localizedValues?.distance ?? formatDistance(leg.distanceMeters),
              duration: leg.localizedValues?.duration ?? formatDuration(leg.durationMillis),
              durationMillis: leg.durationMillis ?? 0,
            });
          });
        }

        if (routeMode === 'WALKING') warnings.unshift('Walking routes are in beta and may not always include clear pedestrian paths or sidewalks.');
        if (avoidTolls) warnings.push('Avoid tolls is a preference; Google may still use a toll road if no practical alternative exists.');
        if (avoidHighways) warnings.push('Avoid highways is a preference; Google may still use a highway if no practical alternative exists.');

        onRouteSummary?.({
          state: 'ready', mode: routeMode, distance: formatDistance(totalDistance), duration: formatDuration(totalDuration),
          distanceMeters: totalDistance, durationMillis: totalDuration, legs, warnings: [...new Set(warnings)],
        });
      } catch (cause) {
        if (cancelled || requestId !== routeRequestRef.current) return;
        clearRoute();
        const errorMessage = cause instanceof Error ? cause.message : 'Unable to calculate route.';
        onRouteSummary?.(emptySummary(routeMode, 'error', errorMessage));
      }
    }

    void renderRoute();
    return () => { cancelled = true; clearRoute(); };
  }, [apiKey, arrivalTime, avoidHighways, avoidTolls, departureTime, onRouteSummary, ready, routeEnabled, routeKey, routeMode, timeAnchor, trafficAware]);

  useEffect(() => {
    if (!optimizeRequestNonce || !onOptimizationSuggestion) return;
    const publishOptimization = onOptimizationSuggestion;
    let cancelled = false;
    async function optimize() {
      if (!routeEnabled || mappedRoutePlaces.length < 3) {
        publishOptimization(null, '至少需要 3 個停靠點才能提出最佳化順序。');
        return;
      }
      if (routeMode === 'TRANSIT') {
        publishOptimization(null, 'Google Transit 不支援中途點排序最佳化；請切到 Drive 或 Walk。');
        return;
      }
      try {
        await loadGoogleMaps(apiKey);
        const { Route } = await google.maps.importLibrary('routes') as unknown as { Route: RouteClassLike };
        const request: Record<string, unknown> = {
          origin: { lat: mappedRoutePlaces[0].latitude, lng: mappedRoutePlaces[0].longitude },
          destination: { lat: mappedRoutePlaces[mappedRoutePlaces.length - 1].latitude, lng: mappedRoutePlaces[mappedRoutePlaces.length - 1].longitude },
          intermediates: mappedRoutePlaces.slice(1, -1).map((place) => ({ location: { lat: place.latitude, lng: place.longitude } })),
          travelMode: routeMode,
          optimizeWaypointOrder: true,
          language: 'zh-TW',
          fields: ['distanceMeters', 'durationMillis', 'optimizedIntermediateWaypointIndices'],
        };
        if (routeMode === 'DRIVING') {
          request.routeModifiers = { avoidTolls, avoidHighways };
          request.routingPreference = trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE';
          if (timeAnchor === 'departure' && departureTime && departureTime.getTime() > Date.now()) request.departureTime = departureTime;
        }
        const response = await Route.computeRoutes(request);
        if (cancelled) return;
        const route = response.routes?.[0];
        if (!route) throw new Error('Google Routes 沒有回傳最佳化結果。');
        const intermediates = mappedRoutePlaces.slice(1, -1);
        const indices = route.optimizedIntermediateWaypointIndices ?? intermediates.map((_, index) => index);
        const ordered = [mappedRoutePlaces[0], ...indices.map((index) => intermediates[index]).filter(Boolean), mappedRoutePlaces[mappedRoutePlaces.length - 1]];
        publishOptimization({
          orderedPlaceIds: ordered.map((place) => place.id),
          distance: formatDistance(route.distanceMeters), duration: formatDuration(route.durationMillis),
          distanceMeters: route.distanceMeters ?? 0, durationMillis: route.durationMillis ?? 0,
        });
      } catch (cause) {
        if (!cancelled) publishOptimization(null, cause instanceof Error ? cause.message : 'Unable to optimize route.');
      }
    }
    void optimize();
    return () => { cancelled = true; };
  // optimizeRequestNonce is intentionally the trigger; the latest route settings are captured for that request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimizeRequestNonce]);

  useEffect(() => {
    if (!mapRef.current || selectedId === null) return;
    const selected = displayPlaces.find((place) => place.id === selectedId);
    if (selected) mapRef.current.panTo({ lat: selected.latitude, lng: selected.longitude });
  }, [displayPlaces, selectedId]);

  if (!apiKey) return <div className="mapSetup"><div className="mapSetupIcon">🗺️</div><strong>Google Maps API key required</strong><p>Add <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to <code>.env.local</code>, then restart the dev server.</p></div>;

  return <div className="mapFrame">
    <div ref={containerRef} className="mapCanvas" aria-label="Google map showing trip places and route" />
    {!ready && !error && <div className="mapOverlay">Loading Google Maps…</div>}
    {error && <div className="mapOverlay mapError">{error}</div>}
  </div>;
}
