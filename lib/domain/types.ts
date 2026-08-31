export type TripRole = 'owner' | 'editor' | 'viewer';
export type TripPlaceStatus = 'candidate' | 'planned' | 'booked' | 'visited' | 'skipped';
export type Preference = 'must_go' | 'interested' | 'neutral' | 'skip';

export interface Trip {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  startDate: string | null;
  endDate: string | null;
}

export interface TripDay {
  id: string;
  tripId: string;
  date: string | null;
  title: string;
  orderIndex: number;

  // Per-day route planning settings (v0.6+)
  routeStartTripPlaceId: string | null;
  routeEndTripPlaceId: string | null;
  routeDepartureTime: string | null;
  routeArrivalTime: string | null;
  routeTimeAnchor: 'departure' | 'arrival';
  avoidTolls: boolean;
  avoidHighways: boolean;
}

export interface Place {
  id: string;
  provider: string;
  providerPlaceId: string | null;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  createdBy: string;
}

export interface TripPlaceItem {
  id: string;
  tripId: string;
  placeId: string;
  dayId: string | null;
  orderIndex: number;
  category: string;
  plannedDurationMinutes: number | null;
  notes: string | null;
  status: TripPlaceStatus;
  name: string;
  provider: string;
  providerPlaceId: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  priority: number;
}

export interface WishlistFolder {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  orderIndex: number;
}

export interface WishlistItem {
  id: string;
  userId: string;
  placeId: string;
  folderId: string | null;
  category: string;
  rating: number;
  notes: string | null;
  name: string;
  provider: string;
  providerPlaceId: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface WishlistTripOption {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'editor';
}
