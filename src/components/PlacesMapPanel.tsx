import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { ExternalLink, MapPin, RefreshCw, Star } from 'lucide-react';
import { TransitMode } from '../types';
import { detectGermanContext, sanitizeCodeTokensInQuery } from '../utils/location';

interface MapPlaceItem {
  id: string;
  displayName: string;
  formattedAddress: string;
  location: google.maps.LatLngLiteral;
  rating: number | null;
  googleMapsURI: string | null;
}

interface PlacesMapPanelProps {
  mode: TransitMode | 'food';
  coordinates?: { lat: number; lng: number };
  locationQuery: string;
  hasMapsProvider: boolean;
}

const DEFAULT_GERMANY_CENTER: google.maps.LatLngLiteral = {
  lat: 51.1657,
  lng: 10.4515,
};

function getPlaceSearchMeta(mode: TransitMode | 'food'): {
  primaryType: string;
  queryPrefix: string;
  heading: string;
} {
  if (mode === 'food') {
    return {
      primaryType: 'restaurant',
      queryPrefix: 'Restaurant Döner Pizza Imbiss',
      heading: 'Mapa restauracji w Google Maps',
    };
  }
  if (mode === 'fuel') {
    return {
      primaryType: 'gas_station',
      queryPrefix: 'Tankstelle stacja paliw',
      heading: 'Mapa stacji paliw w okolicy',
    };
  }
  if (mode === 'car') {
    return {
      primaryType: 'parking',
      queryPrefix: 'Autobahn Raststätte Parkplatz Parking',
      heading: 'Mapa punktów drogowych i parkingów',
    };
  }
  if (mode === 'sbahn') {
    return {
      primaryType: 'train_station',
      queryPrefix: 'S-Bahn Station Haltestelle kolej miejska',
      heading: 'Mapa stacji S-Bahn w okolicy',
    };
  }
  if (mode === 'buses') {
    return {
      primaryType: 'bus_station',
      queryPrefix: 'Busbahnhof ZOB przystanek autobusowy',
      heading: 'Mapa dworców i przystanków autobusowych',
    };
  }
  return {
    primaryType: 'train_station',
    queryPrefix: 'Bahnhof stacja kolejowa',
    heading: 'Mapa dworców kolejowych w okolicy',
  };
}

function isQuotaError(err: unknown): boolean {
  const msg = String(
    (err as { message?: string; status?: string; code?: number })?.message ||
      (err as { status?: string })?.status ||
      err ||
      ''
  );
  const code = (err as { code?: number })?.code;
  return (
    code === 429 ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OverQuota') ||
    msg.includes('QuotaExceeded')
  );
}

interface PlaceMarkerProps {
  place: MapPlaceItem;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
}

const PlaceMarkerWithInfoWindow: React.FC<PlaceMarkerProps> = ({
  place,
  isSelected,
  onSelect,
  onClose,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={place.location}
        title={place.displayName}
        onClick={onSelect}
      >
        <Pin
          background={isSelected ? '#4ADE80' : '#22C55E'}
          borderColor="#052E16"
          glyphColor="#041409"
          scale={isSelected ? 1.15 : 1}
        />
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="space-y-1.5 p-0.5 text-[#111813]">
            <p className="text-sm font-bold leading-snug">{place.displayName}</p>
            {place.formattedAddress && (
              <p className="text-xs text-[#4B594F]">{place.formattedAddress}</p>
            )}
            {place.rating !== null && (
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                <Star className="h-3 w-3 fill-current" />
                <span className="tabular-nums">{place.rating.toFixed(1)}</span>
              </p>
            )}
            {place.googleMapsURI && (
              <div className="pt-1">
                <a
                  href={place.googleMapsURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D] underline"
                >
                  <span>Otwórz w Google Maps</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface MapSearchControllerProps {
  mode: TransitMode | 'food';
  coordinates?: { lat: number; lng: number };
  locationQuery: string;
  refreshNonce: number;
  onPlacesChange: (places: MapPlaceItem[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onErrorChange: (err: string | null) => void;
}

const MapSearchController: React.FC<MapSearchControllerProps> = ({
  mode,
  coordinates,
  locationQuery,
  refreshNonce,
  onPlacesChange,
  onLoadingChange,
  onErrorChange,
}) => {
  const map = useMap();
  const coreLib = useMapsLibrary('core');
  const placesLib = useMapsLibrary('places');
  const cacheRef = useRef<Record<string, MapPlaceItem[]>>({});

  useEffect(() => {
    if (!placesLib || !coreLib || !map) return;

    const trimmedLoc = locationQuery.trim();
    if (!coordinates && !trimmedLoc) {
      onPlacesChange([]);
      return;
    }

    const cacheKey = `${mode}|${coordinates ? `${coordinates.lat.toFixed(3)},${coordinates.lng.toFixed(3)}` : ''}|${trimmedLoc.toLowerCase()}`;
    if (refreshNonce === 0 && cacheRef.current[cacheKey]) {
      const cached = cacheRef.current[cacheKey];
      onPlacesChange(cached);
      if (cached.length > 0) {
        const bounds = new coreLib.LatLngBounds();
        cached.forEach((p) => bounds.extend(p.location));
        if (coordinates) bounds.extend(coordinates);
        map.fitBounds(bounds, 48);
      } else if (coordinates) {
        map.panTo(coordinates);
        map.setZoom(13);
      }
      return;
    }

    let cancelled = false;
    const { primaryType, queryPrefix } = getPlaceSearchMeta(mode);

    const runSearch = async () => {
      onLoadingChange(true);
      onErrorChange(null);
      try {
        const fields = [
          'id',
          'displayName',
          'formattedAddress',
          'location',
          'rating',
          'googleMapsURI',
        ];

        let rawPlaces: google.maps.places.Place[] = [];

        const cleanLoc = sanitizeCodeTokensInQuery(trimmedLoc);
        const isPolishPostal = /\b\d{2}-\d{3}\b/.test(cleanLoc);
        const isGerman = detectGermanContext(trimmedLoc) || /^\d{5}$/.test(cleanLoc);
        const inferredRegion = isPolishPostal ? 'PL' : isGerman ? 'DE' : undefined;

        if (cleanLoc && !coordinates) {
          const res = await placesLib.Place.searchByText({
            textQuery: `${queryPrefix} ${cleanLoc}`,
            fields,
            maxResultCount: 8,
            language: 'pl',
            ...(inferredRegion ? { region: inferredRegion } : {}),
          });
          rawPlaces = res.places ?? [];
        } else if (coordinates) {
          const res = await placesLib.Place.searchNearby({
            fields,
            locationRestriction: {
              center: coordinates,
              radius: 5000,
            },
            includedPrimaryTypes: [primaryType],
            maxResultCount: 8,
            language: 'pl',
          });
          rawPlaces = res.places ?? [];
        }

        if (cancelled) return;

        const mapped: MapPlaceItem[] = rawPlaces
          .filter((p) => Boolean(p.location))
          .map((p) => ({
            id: p.id,
            displayName: p.displayName || 'Punkt na mapie',
            formattedAddress: p.formattedAddress || '',
            location: {
              lat: p.location!.lat(),
              lng: p.location!.lng(),
            },
            rating: typeof p.rating === 'number' ? p.rating : null,
            googleMapsURI: p.googleMapsURI || null,
          }));

        cacheRef.current[cacheKey] = mapped;
        onPlacesChange(mapped);

        if (mapped.length > 0) {
          const bounds = new coreLib.LatLngBounds();
          mapped.forEach((item) => bounds.extend(item.location));
          if (coordinates) bounds.extend(coordinates);
          map.fitBounds(bounds, 48);
        } else if (coordinates) {
          map.panTo(coordinates);
          map.setZoom(13);
        }
      } catch (err) {
        if (cancelled) return;
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          onErrorChange('Przekroczono limit zapytań Google Maps Platform.');
        } else {
          onErrorChange('Nie udało się pobrać punktów na mapie Google.');
        }
      } finally {
        if (!cancelled) onLoadingChange(false);
      }
    };

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [
    placesLib,
    coreLib,
    map,
    mode,
    coordinates,
    locationQuery,
    refreshNonce,
    onPlacesChange,
    onLoadingChange,
    onErrorChange,
  ]);

  return null;
};

export const PlacesMapPanel: React.FC<PlacesMapPanelProps> = ({
  mode,
  coordinates,
  locationQuery,
  hasMapsProvider,
}) => {
  const [places, setPlaces] = useState<MapPlaceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const meta = getPlaceSearchMeta(mode);

  const handlePlacesChange = useCallback((next: MapPlaceItem[]) => {
    setPlaces(next);
    setSelectedId(null);
  }, []);

  if (!hasMapsProvider) {
    return (
      <section className="rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-4 text-xs text-[#8B95A1]">
        Mapa Google będzie dostępna po skonfigurowaniu klucza Google Maps API w środowisku.
      </section>
    );
  }

  return (
    <section
      aria-label={meta.heading}
      className="space-y-3 rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4ADE80]">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Google Maps</span>
          </div>
          <h3 className="mt-0.5 font-display text-base font-semibold text-white">
            {meta.heading}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {places.length > 0 && (
            <span className="text-xs text-[#8B95A1] tabular-nums">
              Znaleziono punktów: {places.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={isLoading || (!coordinates && !locationQuery.trim())}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#262D36] bg-[#12161B] px-3 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E] disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Odśwież mapę</span>
          </button>
        </div>
      </div>

      {mapError && (
        <p className="rounded-xl border border-[#EF4444]/40 bg-[#26090A] px-3 py-2 text-xs text-[#FCA5A5]">
          {mapError}
        </p>
      )}

      {!coordinates && !locationQuery.trim() && (
        <p className="text-xs text-[#8B95A1]">
          Włącz GPS lub wpisz kod pocztowy albo miejscowość (dowolny kraj), aby zobaczyć pobliskie punkty na mapie.
        </p>
      )}

      <div className="h-[340px] w-full overflow-hidden rounded-xl border border-[#1E232A] bg-[#050608] sm:h-[380px]">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          colorScheme="DARK"
          defaultCenter={coordinates || DEFAULT_GERMANY_CENTER}
          defaultZoom={coordinates ? 13 : 6}
          gestureHandling="greedy"
          streetViewControl={false}
          mapTypeControl={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
          onClick={() => setSelectedId(null)}
        >
          <MapSearchController
            mode={mode}
            coordinates={coordinates}
            locationQuery={locationQuery}
            refreshNonce={refreshNonce}
            onPlacesChange={handlePlacesChange}
            onLoadingChange={setIsLoading}
            onErrorChange={setMapError}
          />

          {coordinates && (
            <AdvancedMarker position={coordinates} title="Twoja lokalizacja GPS">
              <Pin
                background="#38BDF8"
                borderColor="#0C4A6E"
                glyphColor="#041409"
                scale={0.95}
              />
            </AdvancedMarker>
          )}

          {places.map((place) => (
            <PlaceMarkerWithInfoWindow
              key={place.id}
              place={place}
              isSelected={selectedId === place.id}
              onSelect={() => setSelectedId(place.id)}
              onClose={() => setSelectedId(null)}
            />
          ))}
        </GoogleMap>
      </div>
    </section>
  );
};
