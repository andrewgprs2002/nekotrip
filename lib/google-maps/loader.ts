let googleMapsPromise: Promise<typeof google> | null = null;

export async function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    throw new Error('Google Maps can only be loaded in the browser.');
  }

  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is missing.');
  }

  const googleGlobal = (window as typeof window & { google?: typeof google }).google;
  if (googleGlobal?.maps?.importLibrary) {
    return googleGlobal;
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = '__nekotripGoogleMapsReady';
    const existing = document.querySelector<HTMLScriptElement>('script[data-nekotrip-google-maps="true"]');

    const cleanup = () => {
      delete (window as Window & { [key: string]: unknown })[callbackName];
    };

    (window as Window & { [key: string]: unknown })[callbackName] = () => {
      cleanup();
      const loadedGoogle = (window as typeof window & { google?: typeof google }).google;
      if (loadedGoogle?.maps?.importLibrary) {
        resolve(loadedGoogle);
      } else {
        reject(new Error('Google Maps loaded without importLibrary support.'));
      }
    };

    if (existing) {
      existing.addEventListener('error', () => {
        cleanup();
        googleMapsPromise = null;
        reject(new Error('Failed to load Google Maps JavaScript API.'));
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.dataset.nekotripGoogleMaps = 'true';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.onerror = () => {
      cleanup();
      googleMapsPromise = null;
      reject(new Error('Failed to load Google Maps JavaScript API. Check the API key and its restrictions.'));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
