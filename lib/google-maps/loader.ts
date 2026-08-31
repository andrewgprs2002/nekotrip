let googleMapsPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in the browser.'));
  }

  const googleGlobal = (window as typeof window & { google?: typeof google }).google;
  if (googleGlobal?.maps) {
    return Promise.resolve(googleGlobal);
  }

  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-nekotrip-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => {
        const loadedGoogle = (window as typeof window & { google?: typeof google }).google;
        if (loadedGoogle?.maps) resolve(loadedGoogle);
        else reject(new Error('Google Maps loaded but the global object is unavailable.'));
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load Google Maps JavaScript API.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.nekotripGoogleMaps = 'true';

    script.onload = () => {
      const loadedGoogle = (window as typeof window & { google?: typeof google }).google;
      if (loadedGoogle?.maps) resolve(loadedGoogle);
      else reject(new Error('Google Maps loaded but the global object is unavailable.'));
    };
    script.onerror = () => reject(new Error('Unable to load Google Maps JavaScript API.'));

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
