import React, { useEffect } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  AssistantLanguage,
  FoodCategory,
  FoodResult,
  FoodSearchResponse,
  GroundingLink,
  PostOfficeInfo,
} from '../types';
import {
  buildGoogleMapsSearchUrl,
  detectGermanContext,
  sanitizeCodeTokensInQuery,
  stripHyphensForCodeOnly,
} from '../utils/location';

export type GoogleFoodSearchFn = (params: {
  location: string;
  category: FoodCategory;
  coordinates?: { lat: number; lng: number };
  language: AssistantLanguage;
}) => Promise<FoodSearchResponse | null>;

interface GooglePlacesFoodBridgeProps {
  onRegisterSearch: (fn: GoogleFoodSearchFn | null) => void;
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

function formatPriceLevel(level?: string | null): string {
  switch (String(level || '').toUpperCase()) {
    case 'FREE':
      return '€';
    case 'INEXPENSIVE':
      return '€';
    case 'MODERATE':
      return '€€';
    case 'EXPENSIVE':
      return '€€€';
    case 'VERY_EXPENSIVE':
      return '€€€€';
    default:
      return '€€';
  }
}

function inferFoodCategory(
  requested: FoodCategory,
  name: string,
  primaryType?: string | null
): 'doner' | 'pizza' | 'chinese' | 'other' {
  if (requested === 'doner' || requested === 'pizza' || requested === 'chinese') {
    return requested;
  }
  const haystack = `${name} ${primaryType || ''}`.toLowerCase();
  if (haystack.includes('döner') || haystack.includes('doner') || haystack.includes('kebab')) {
    return 'doner';
  }
  if (haystack.includes('pizza') || haystack.includes('pizzeria')) {
    return 'pizza';
  }
  if (
    haystack.includes('china') ||
    haystack.includes('chinese') ||
    haystack.includes('chiń') ||
    haystack.includes('wok') ||
    haystack.includes('asia')
  ) {
    return 'chinese';
  }
  return 'other';
}

function defaultCategoryLabel(cat: FoodCategory): string {
  switch (cat) {
    case 'doner':
      return 'Döner / Kebab';
    case 'pizza':
      return 'Pizza';
    case 'chinese':
      return 'Kuchnia chińska';
    case 'near_post':
      return 'W pobliżu poczty';
    default:
      return 'Restauracja';
  }
}

export const GooglePlacesFoodBridge: React.FC<GooglePlacesFoodBridgeProps> = ({
  onRegisterSearch,
}) => {
  const placesLib = useMapsLibrary('places');

  useEffect(() => {
    if (!placesLib) {
      onRegisterSearch(null);
      return;
    }

    const runSearch: GoogleFoodSearchFn = async ({
      location,
      category,
      coordinates,
      language,
    }) => {
      const cleanLocation = sanitizeCodeTokensInQuery(location);
      const isPolishPostal = /\b\d{2}-\d{3}\b/.test(cleanLocation);
      const isBareFiveDigit = /^\d{5}$/.test(cleanLocation);
      const isGerman = detectGermanContext(location) || isBareFiveDigit;
      const inferredRegion = isPolishPostal
        ? 'PL'
        : isGerman
          ? 'DE'
          : undefined;
      if (!cleanLocation && !coordinates) return null;

      const categoryQueryMap: Record<FoodCategory, string> = {
        all: 'Restaurant Döner Pizza Asiatisch',
        doner: 'Döner Kebab Imbiss',
        pizza: 'Pizza Pizzeria Restaurant',
        chinese: 'Chinesisches Restaurant China Imbiss Asia Wok',
        near_post: 'Restaurant Imbiss near Post Office',
      };

      const fields = [
        'id',
        'displayName',
        'formattedAddress',
        'addressComponents',
        'nationalPhoneNumber',
        'internationalPhoneNumber',
        'rating',
        'userRatingCount',
        'priceLevel',
        'regularOpeningHours',
        'googleMapsURI',
        'primaryTypeDisplayName',
      ];

      const querySubject = categoryQueryMap[category] || categoryQueryMap.all;
      const textQuery = cleanLocation
        ? `${querySubject} ${cleanLocation}`
        : querySubject;

      try {
        let rawPlaces: google.maps.places.Place[] = [];

        if (cleanLocation) {
          const searchReq: google.maps.places.SearchByTextRequest = {
            textQuery,
            fields,
            includedType: 'restaurant',
            maxResultCount: 10,
            language: language === 'de' ? 'de' : 'pl',
            ...(inferredRegion ? { region: inferredRegion } : {}),
            internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
          };
          const res = await placesLib.Place.searchByText(searchReq);
          rawPlaces = res.places ?? [];
        } else if (coordinates) {
          const nearbyRes = await placesLib.Place.searchNearby({
            fields,
            locationRestriction: {
              center: coordinates,
              radius: 6000,
            },
            includedPrimaryTypes: ['restaurant', 'fast_food_restaurant', 'meal_takeaway'],
            maxResultCount: 10,
            language: language === 'de' ? 'de' : 'pl',
            internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
          });
          rawPlaces = nearbyRes.places ?? [];

          // Fallback to searchByText with locationBias if nearby category needs keyword specificity
          if (rawPlaces.length === 0 || category !== 'all') {
            const textRes = await placesLib.Place.searchByText({
              textQuery: querySubject,
              fields,
              includedType: 'restaurant',
              locationBias: { center: coordinates, radius: 7000 },
              maxResultCount: 10,
              language: language === 'de' ? 'de' : 'pl',
              internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
            });
            if ((textRes.places ?? []).length > 0) {
              rawPlaces = textRes.places ?? [];
            }
          }
        }

        if (rawPlaces.length === 0) {
          return null;
        }

        let postOffice: PostOfficeInfo | null = null;
        if (category === 'near_post') {
          try {
            const postReq: google.maps.places.SearchByTextRequest = {
              textQuery: cleanLocation
                ? `Post Office Postfiliale ${cleanLocation}`
                : 'Post Office Postfiliale',
              fields: ['displayName', 'formattedAddress', 'addressComponents'],
              maxResultCount: 1,
              language: language === 'de' ? 'de' : 'pl',
              ...(inferredRegion ? { region: inferredRegion } : {}),
              internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
            };
            if (!cleanLocation && coordinates) {
              postReq.locationBias = { center: coordinates, radius: 5000 };
            }
            const postRes = await placesLib.Place.searchByText(postReq);
            const firstPost = postRes.places?.[0];
            if (firstPost) {
              const postComps = firstPost.addressComponents || [];
              const postCountry =
                postComps.find((c) => c.types.includes('country'))?.shortText || '';
              const rawPostPostal =
                postComps.find((c) => c.types.includes('postal_code'))?.longText || '';
              const postPostal =
                postCountry === 'DE' || isGerman
                  ? stripHyphensForCodeOnly(rawPostPostal)
                  : rawPostPostal;
              const postCity =
                postComps.find((c) => c.types.includes('locality'))?.longText || '';
              postOffice = {
                name: firstPost.displayName || 'Placówka pocztowa',
                address: firstPost.formattedAddress || '',
                postalCode: postPostal,
                city: postCity || cleanLocation,
                distanceNote: 'Najbliższa placówka pocztowa w Google Maps',
              };
            }
          } catch {
            // Post office info is optional
          }
        }

        const results: FoodResult[] = rawPlaces.slice(0, 8).map((p, idx) => {
          const comps = p.addressComponents || [];
          const placeCountry =
            comps.find((c) => c.types.includes('country'))?.shortText || '';
          const rawPostalCode =
            comps.find((c) => c.types.includes('postal_code'))?.longText || '';
          const postalCode =
            placeCountry === 'DE' || isGerman
              ? stripHyphensForCodeOnly(rawPostalCode)
              : rawPostalCode;
          const city =
            comps.find((c) => c.types.includes('locality'))?.longText ||
            comps.find((c) => c.types.includes('administrative_area_level_3'))?.longText ||
            '';
          const street = comps.find((c) => c.types.includes('route'))?.longText || '';
          const streetNum =
            comps.find((c) => c.types.includes('street_number'))?.longText || '';
          const formatted = p.formattedAddress || '';
          const shortAddress =
            street && streetNum
              ? `${street} ${streetNum}`
              : formatted.split(',')[0]?.trim() || formatted;

          const name = p.displayName || `Restauracja ${idx + 1}`;
          const typeLabel =
            p.primaryTypeDisplayName || defaultCategoryLabel(category);
          const weekdayDesc = p.regularOpeningHours?.weekdayDescriptions || [];
          const openingHours =
            weekdayDesc.length > 0 ? weekdayDesc[0] : 'Sprawdź godziny w Google Maps';
          const phone = p.internationalPhoneNumber || p.nationalPhoneNumber || null;

          return {
            id: p.id || `gplace_${idx}`,
            name,
            category: inferFoodCategory(category, name, p.primaryTypeDisplayName),
            categoryLabel: typeLabel,
            address: shortAddress,
            postalCode,
            city: city || cleanLocation,
            phone,
            rating: typeof p.rating === 'number' ? p.rating : null,
            reviewCount:
              typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
            priceLevel: formatPriceLevel(p.priceLevel),
            openingHours,
            nearPostNote:
              category === 'near_post' && postOffice
                ? `W pobliżu: ${postOffice.name}`
                : null,
            highlight: `${typeLabel} · Pobrane na żywo z Google`,
            mapsUrl:
              p.googleMapsURI || buildGoogleMapsSearchUrl(`${name} ${formatted}`.trim()),
          };
        });

        const groundingLinks: GroundingLink[] = results.map((r) => ({
          title: r.name,
          url: r.mapsUrl,
          source: 'maps',
        }));

        const firstCity = results[0]?.city;
        const resolvedLabel =
          cleanLocation &&
          firstCity &&
          firstCity.toLowerCase() !== cleanLocation.toLowerCase() &&
          /^(?:\d{5}|\d{2}-\d{3})$/.test(cleanLocation)
            ? `${firstCity} (${cleanLocation})`
            : cleanLocation || firstCity || 'Lokalizacja GPS';

        return {
          validGermany: true,
          resolvedLocation: resolvedLabel,
          postOffice,
          results,
          groundingLinks,
        };
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        return null;
      }
    };

    onRegisterSearch(runSearch);
    return () => {
      onRegisterSearch(null);
    };
  }, [placesLib, onRegisterSearch]);

  return null;
};
