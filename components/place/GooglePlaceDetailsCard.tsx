'use client';

import { useEffect, useRef, useState } from 'react';
import { GooglePlacesProvider, type PlaceDetails, type PlaceRichDetails } from '@/lib/providers/places';

type PlaceCardVariant = 'compact' | 'rich';

interface Props {
  apiKey: string;
  providerPlaceId: string | null;
  fallbackAddress?: string | null;
  placeName?: string | null;
  category?: string | null;
  compact?: boolean;
  variant?: PlaceCardVariant;
}

export function GooglePlaceDetailsCard({
  apiKey,
  providerPlaceId,
  fallbackAddress,
  placeName,
  category,
  compact = false,
  variant,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const providerRef = useRef<GooglePlacesProvider | null>(null);
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [richDetails, setRichDetails] = useState<PlaceRichDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [richLoading, setRichLoading] = useState(false);
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [richExpanded, setRichExpanded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [tabelogCopied, setTabelogCopied] = useState(false);
  const effectiveVariant: PlaceCardVariant = variant ?? (compact ? 'compact' : 'rich');

  if (apiKey && !providerRef.current) providerRef.current = new GooglePlacesProvider(apiKey);

  useEffect(() => {
    setDetails(null);
    setRichDetails(null);
    setHoursExpanded(false);
    setRichExpanded(false);
    setShouldLoad(false);

    const el = hostRef.current;
    if (!el || !providerPlaceId || !apiKey) return;
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: effectiveVariant === 'rich' ? '360px' : '220px' });

    observer.observe(el);
    return () => observer.disconnect();
  }, [apiKey, effectiveVariant, providerPlaceId]);

  useEffect(() => {
    if (!shouldLoad || !providerPlaceId || !providerRef.current) return;
    let cancelled = false;
    setLoading(true);
    providerRef.current.getDetails(providerPlaceId)
      .then((value) => { if (!cancelled) setDetails(value); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [providerPlaceId, shouldLoad]);

  async function toggleRichDetails() {
    if (richExpanded) {
      setRichExpanded(false);
      return;
    }
    setRichExpanded(true);
    if (richDetails || !providerPlaceId || !providerRef.current) return;
    setRichLoading(true);
    try {
      setRichDetails(await providerRef.current.getRichDetails(providerPlaceId));
    } catch {
      // Keep the basic card useful even if an optional expensive field is unavailable.
    } finally {
      setRichLoading(false);
    }
  }

  if (!providerPlaceId) {
    return fallbackAddress ? <div className="googlePlaceFallback">{fallbackAddress}</div> : null;
  }

  const rich = effectiveVariant === 'rich';
  const isRestaurant = category?.toLowerCase() === 'restaurant';
  const tabelogName = (placeName ?? details?.name ?? '').trim();
  const tabelogHomeUrl = isRestaurant && tabelogName ? 'https://tabelog.com/tw/' : null;

  function openTabelogAndCopyName() {
    if (!tabelogHomeUrl || !tabelogName) return;

    // Keep the whole action synchronous so the browser still treats both
    // clipboard access and opening Tabelog as part of the same user click.
    // This avoids leaving an about:blank tab behind when navigation is blocked.
    let copied = false;
    const textarea = document.createElement('textarea');
    textarea.value = tabelogName;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      document.body.removeChild(textarea);
    }

    // Best-effort modern clipboard write as well. Do not await it: awaiting can
    // consume the popup's user-gesture permission in some browsers.
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      void navigator.clipboard.writeText(tabelogName).then(() => {
        setTabelogCopied(true);
        window.setTimeout(() => setTabelogCopied(false), 2200);
      }).catch(() => { /* synchronous fallback above already ran */ });
    }

    setTabelogCopied(copied);
    window.setTimeout(() => setTabelogCopied(false), 2200);
    window.open(tabelogHomeUrl, '_blank', 'noopener,noreferrer');
  }
  return <div className={`googlePlaceCard ${rich ? 'rich' : 'compact'}`} ref={hostRef} onClick={(event) => event.stopPropagation()}>
    {loading && <div className="googlePlaceLoading">Loading Google place info…</div>}
    {details && <>
      {details.photoUrl && <div className="googlePlacePhotoWrap">
        <img className="googlePlacePhoto" src={details.photoUrl} alt={details.name ? `${details.name} place photo` : 'Google place photo'} loading="lazy" />
        {details.photoAttributions.length > 0 && <div className="googlePhotoAttribution">Photo: {details.photoAttributions.map((a, i) => a.uri ? <a key={`${a.name}-${i}`} href={a.uri} target="_blank" rel="noreferrer">{a.name}</a> : <span key={`${a.name}-${i}`}>{a.name}</span>)}</div>}
      </div>}

      <div className="googlePlaceInfo">
        <div className="googlePlaceMetaRow">
          {details.rating !== null && <span className="googleRating"><strong>{details.rating.toFixed(1)}</strong> ★{details.userRatingCount !== null ? ` (${details.userRatingCount.toLocaleString()})` : ''}</span>}
          {details.primaryTypeDisplayName && <span className="googleType">{details.primaryTypeDisplayName}</span>}
        </div>

        {details.businessStatusLabel && <div className={`businessStatus ${details.businessStatusTone}`}>{details.businessStatusLabel}{details.todayHours ? ` · ${details.todayHours}` : ''}</div>}
        <div className="googlePlaceAddress">{details.formattedAddress || fallbackAddress || 'Address unavailable'}</div>

        <div className="googlePlaceLinks">
          {details.googleMapsURI && <a href={details.googleMapsURI} target="_blank" rel="noreferrer">Google Maps ↗</a>}
          {details.websiteURI && <a href={details.websiteURI} target="_blank" rel="noreferrer">Website ↗</a>}
          {tabelogHomeUrl && <button type="button" onClick={openTabelogAndCopyName} title={`Copies “${tabelogName}” first, then opens Tabelog Traditional Chinese homepage without running a search.`}>{tabelogCopied ? 'Name copied ✓' : 'Tabelog · Copy name ↗'}</button>}
          {details.weekdayDescriptions.length > 0 && <button type="button" onClick={() => setHoursExpanded((value) => !value)}>{hoursExpanded ? 'Hide hours' : 'Hours'}</button>}
          {rich && <button type="button" onClick={() => void toggleRichDetails()}>{richExpanded ? 'Less details' : 'More details'}</button>}
        </div>

        {hoursExpanded && <div className="googleHoursList">{details.weekdayDescriptions.map((line) => <span key={line}>{line}</span>)}</div>}

        {rich && richExpanded && <div className="googleRichDetails">
          {richLoading && <div className="googleRichLoading">Loading more details…</div>}
          {richDetails && <>
            {richDetails.editorialSummary && <p className="googleEditorialSummary">{richDetails.editorialSummary}</p>}
            <div className="googleRichFacts">
              {richDetails.priceLevelLabel && <div><span>Price</span><strong>{richDetails.priceLevelLabel}</strong></div>}
              {richDetails.phoneNumber && <div><span>Phone</span><strong>{richDetails.phoneNumber}</strong></div>}
              {richDetails.isGoodForChildren !== null && <div><span>Children</span><strong>{richDetails.isGoodForChildren ? 'Good for children' : 'Not marked child-friendly'}</strong></div>}
              {richDetails.isReservable !== null && <div><span>Reservations</span><strong>{richDetails.isReservable ? 'Available' : 'Not listed'}</strong></div>}
              {richDetails.hasRestroom !== null && <div><span>Restroom</span><strong>{richDetails.hasRestroom ? 'Available' : 'Not listed'}</strong></div>}
            </div>
            {richDetails.accessibility.length > 0 && <div className="googleAccessibility"><span>Accessibility</span><div>{richDetails.accessibility.map((value) => <span className="googleFactChip" key={value}>{value}</span>)}</div></div>}
          </>}
        </div>}
      </div>
    </>}
  </div>;
}
