let googleMapsPromise: Promise<typeof google> | null = null;

type GoogleMapsRuntime = typeof google.maps & {
  importLibrary?: (libraryName: string) => Promise<unknown>;
  __ib__?: () => void;
};

function hasImportLibrary(value: unknown): value is (libraryName: string) => Promise<unknown> {
  return typeof value === 'function';
}

function installDynamicLibraryBootstrap(apiKey: string) {
  const win = window as typeof window & { google?: typeof google };

  win.google ||= {} as typeof google;
  win.google.maps ||= {} as typeof google.maps;

  const maps = win.google.maps as GoogleMapsRuntime;

  if (hasImportLibrary(maps.importLibrary)) return;

  let bootstrapPromise: Promise<void> | null = null;
  const requestedLibraries = new Set<string>();

  const load = () => {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams();

      params.set('key', apiKey);
      params.set('v', 'weekly');
      params.set('loading', 'async');
      params.set('libraries', [...requestedLibraries].join(','));
      params.set('callback', 'google.maps.__ib__');

      maps.__ib__ = () => resolve();

      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.defer = true;
      script.dataset.nekotripGoogleMaps = 'dynamic';

      script.onerror = () => {
        bootstrapPromise = null;
        reject(new Error('Unable to load Google Maps JavaScript API.'));
      };

      document.head.appendChild(script);
    });

    return bootstrapPromise;
  };

  const bootstrapImportLibrary = async (libraryName: string) => {
    requestedLibraries.add(libraryName);
    await load();

    const loadedMaps = window.google.maps as GoogleMapsRuntime;
    const imported = loadedMaps.importLibrary;

    if (!hasImportLibrary(imported) || imported === bootstrapImportLibrary) {
      throw new Error('Google Maps loaded without Dynamic Library Import support.');
    }

    return imported(libraryName);
  };

  maps.importLibrary = bootstrapImportLibrary;
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in the browser.'));
  }

  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is missing.'));
  }

  const currentGoogle = (window as typeof window & { google?: typeof google }).google;
  const currentImportLibrary = (currentGoogle?.maps as GoogleMapsRuntime | undefined)?.importLibrary;

  if (currentGoogle?.maps && hasImportLibrary(currentImportLibrary)) {
    return Promise.resolve(currentGoogle);
  }

  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = (async () => {
    installDynamicLibraryBootstrap(apiKey);

    const mapsRuntime = window.google.maps as GoogleMapsRuntime;
    if (!hasImportLibrary(mapsRuntime.importLibrary)) {
      throw new Error('Google Maps Dynamic Library Import bootstrap failed.');
    }

    await mapsRuntime.importLibrary('maps');

    const loadedGoogle = (window as typeof window & { google?: typeof google }).google;
    const loadedImportLibrary = (loadedGoogle?.maps as GoogleMapsRuntime | undefined)?.importLibrary;

    if (!loadedGoogle?.maps || !hasImportLibrary(loadedImportLibrary)) {
      throw new Error('Google Maps loaded, but google.maps.importLibrary is unavailable.');
    }

    return loadedGoogle;
  })().catch((error) => {
    googleMapsPromise = null;
    throw error;
  });

  return googleMapsPromise;
}
