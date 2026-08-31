import { loadGoogleMaps } from '@/lib/google-maps/loader';

export interface PlaceSearchResult {
  provider: string;
  providerPlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude: number;
  longitude: number;
}

export interface PlaceDetails {
  name: string | null;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  primaryTypeDisplayName: string | null;
  businessStatusLabel: string | null;
  businessStatusTone: 'open'|'closed'|'neutral';
  todayHours: string | null;
  weekdayDescriptions: string[];
  websiteURI: string | null;
  googleMapsURI: string | null;
  photoUrl: string | null;
  photoAttributions: Array<{ name: string; uri: string | null }>;
}

export interface PlaceRichDetails {
  phoneNumber: string | null;
  priceLevelLabel: string | null;
  editorialSummary: string | null;
  isGoodForChildren: boolean | null;
  isReservable: boolean | null;
  hasRestroom: boolean | null;
  accessibility: string[];
}

export interface PlacesProvider {
  search(query: string): Promise<PlaceSearchResult[]>;
  resolveById(providerPlaceId: string): Promise<PlaceSearchResult | null>;
}

function nullableBoolean(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function formatPriceLevel(value: unknown): string | null {
  const normalized = String(value ?? '').toUpperCase();
  if (!normalized) return null;
  if (normalized.includes('VERY_EXPENSIVE')) return '$$$$ · Very expensive';
  if (normalized.includes('EXPENSIVE')) return '$$$ · Expensive';
  if (normalized.includes('MODERATE')) return '$$ · Moderate';
  if (normalized.includes('INEXPENSIVE')) return '$ · Inexpensive';
  if (normalized.includes('FREE')) return 'Free';
  return String(value);
}

export class GooglePlacesProvider implements PlacesProvider {
  constructor(private readonly apiKey: string) {}

  private async getPlaceLibrary() {
    await loadGoogleMaps(this.apiKey);
    return google.maps.importLibrary('places') as Promise<google.maps.PlacesLibrary>;
  }

  async search(query: string): Promise<PlaceSearchResult[]> {
    const textQuery = query.trim();
    if (!textQuery) return [];
    const { Place } = await this.getPlaceLibrary();
    const { places } = await Place.searchByText({
      textQuery,
      fields: ['id','displayName','formattedAddress','location'],
      language: 'ja',
      region: 'jp',
      maxResultCount: 5,
    });
    return places.flatMap((place) => (!place.id || !place.displayName || !place.location) ? [] : [{
      provider: 'google',
      providerPlaceId: place.id,
      name: place.displayName,
      formattedAddress: place.formattedAddress ?? undefined,
      latitude: place.location.lat(),
      longitude: place.location.lng(),
    }]);
  }

  async resolveById(providerPlaceId: string): Promise<PlaceSearchResult | null> {
    const id = providerPlaceId.trim();
    if (!id) return null;
    const { Place } = await this.getPlaceLibrary();
    const place = new Place({ id, requestedLanguage: 'ja', requestedRegion: 'jp' });
    await place.fetchFields({ fields: ['id','displayName','formattedAddress','location'] });
    if (!place.id || !place.displayName || !place.location) return null;
    return {
      provider: 'google',
      providerPlaceId: place.id,
      name: place.displayName,
      formattedAddress: place.formattedAddress ?? undefined,
      latitude: place.location.lat(),
      longitude: place.location.lng(),
    };
  }

  async getDetails(providerPlaceId: string): Promise<PlaceDetails> {
    const id = providerPlaceId.trim();
    if (!id) throw new Error('Google Place ID is missing.');
    const { Place } = await this.getPlaceLibrary();
    const place = new Place({ id, requestedLanguage: 'ja', requestedRegion: 'jp' });
    await place.fetchFields({
      fields: ['displayName','formattedAddress','rating','userRatingCount','primaryTypeDisplayName','businessStatus','currentOpeningHours','websiteURI','googleMapsURI','photos'],
    });

    const hours = place.currentOpeningHours?.weekdayDescriptions ?? [];
    const status = String(place.businessStatus ?? '');
    const businessStatusLabel = status.includes('CLOSED_PERMANENTLY') ? 'Permanently closed'
      : status.includes('CLOSED_TEMPORARILY') ? 'Temporarily closed'
        : status.includes('FUTURE_OPENING') ? 'Opening soon'
          : status.includes('OPERATIONAL') ? 'Operational'
            : null;
    const businessStatusTone: PlaceDetails['businessStatusTone'] = status.includes('CLOSED') ? 'closed' : status.includes('OPERATIONAL') ? 'open' : 'neutral';
    const photo = place.photos?.[0];

    return {
      name: place.displayName ?? null,
      formattedAddress: place.formattedAddress ?? null,
      rating: typeof place.rating === 'number' ? place.rating : null,
      userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      primaryTypeDisplayName: place.primaryTypeDisplayName ?? null,
      businessStatusLabel,
      businessStatusTone,
      todayHours: hours.length === 7 ? hours[new Date().getDay()] ?? null : null,
      weekdayDescriptions: hours,
      websiteURI: place.websiteURI ?? null,
      googleMapsURI: place.googleMapsURI ?? null,
      photoUrl: photo ? photo.getURI({ maxWidth: 1080, maxHeight: 620 }) : null,
      photoAttributions: (photo?.authorAttributions ?? []).map((a) => ({ name: a.displayName || 'Contributor', uri: a.uri ?? null })),
    };
  }

  async getRichDetails(providerPlaceId: string): Promise<PlaceRichDetails> {
    const id = providerPlaceId.trim();
    if (!id) throw new Error('Google Place ID is missing.');
    const { Place } = await this.getPlaceLibrary();
    const place = new Place({ id, requestedLanguage: 'ja', requestedRegion: 'jp' });
    await place.fetchFields({
      fields: ['nationalPhoneNumber','priceLevel','editorialSummary','isGoodForChildren','isReservable','hasRestroom','accessibilityOptions'],
    });

    const accessibility: string[] = [];
    const a = place.accessibilityOptions;
    if (a?.hasWheelchairAccessibleEntrance === true) accessibility.push('Wheelchair entrance');
    if (a?.hasWheelchairAccessibleParking === true) accessibility.push('Accessible parking');
    if (a?.hasWheelchairAccessibleRestroom === true) accessibility.push('Accessible restroom');
    if (a?.hasWheelchairAccessibleSeating === true) accessibility.push('Accessible seating');

    return {
      phoneNumber: place.nationalPhoneNumber ?? null,
      priceLevelLabel: formatPriceLevel(place.priceLevel),
      editorialSummary: place.editorialSummary ?? null,
      isGoodForChildren: nullableBoolean(place.isGoodForChildren),
      isReservable: nullableBoolean(place.isReservable),
      hasRestroom: nullableBoolean(place.hasRestroom),
      accessibility,
    };
  }
}
