import { PhoneAppTarget } from '../types';

export function sanitizePhoneForTel(phone: string | null | undefined): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  } else if (cleaned.startsWith('0') && !cleaned.startsWith('+')) {
    cleaned = '+49' + cleaned.slice(1);
  }
  return cleaned;
}

export function sanitizePhoneForWhatsapp(phone: string): string {
  const tel = sanitizePhoneForTel(phone);
  return tel.replace(/\+/g, '');
}

export function buildWhatsappUrl(phone: string, text?: string): string {
  const digits = sanitizePhoneForWhatsapp(phone);
  if (!text) return `https://wa.me/${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function stripHyphensForCodeOnly(input: string): string {
  return (input || '').replace(/[-–—\u2010-\u2015\s]+/g, '').trim();
}

export function detectGermanContext(input: string, explicitCountry?: string): boolean {
  const c = (explicitCountry || '').trim().toLowerCase();
  if (
    c === 'de' ||
    c === 'deu' ||
    c.includes('niemc') ||
    c.includes('deutschland') ||
    c.includes('germany')
  ) {
    return true;
  }
  if (!input) return false;
  return (
    /\b(niemcy|niemczech|niemiecki|deutschland|germany|plz|de)\b/i.test(input) ||
    /\b(?:DE|D)[-\s]?\d{5}\b/i.test(input)
  );
}

export function sanitizeCodeTokensInQuery(
  input: string,
  explicitCountry?: string
): string {
  if (!input) return '';
  const isGerman = detectGermanContext(input, explicitCountry);
  let normalized = input.trim();

  // Always strip "DE-" / "D-" prefix before 5-digit German postal codes (e.g. DE-10115 or D-10115 -> 10115)
  normalized = normalized.replace(/\b(?:DE|D)[-\s]+(\d{2})[-–—\s]?(\d{3})\b/gi, '$1$2');
  // Also normalize optional PL- prefix before Polish postal code (e.g. PL-00-001 -> 00-001)
  normalized = normalized.replace(/\bPL[-\s]+(\d{2}-\d{3})\b/gi, '$1');

  return normalized
    .split(/\s+/)
    .map((token) => {
      if (!/[-–—]/.test(token)) return token;
      // Preserve international postal codes outside Germany if user didn't turn on strict codeOnlyMode?
      // Wait: if German context is active OR token is a code with digits/uppercase segments,
      // strip hyphens for German postal codes (e.g. 10-115 -> 10115) while preserving e.g. Polish 00-001 when explicitly non-German or keeping all codes clean.
      if (isGerman && /\d/.test(token)) {
        return token.replace(/[-–—\u2010-\u2015]+/g, '');
      }
      const isPolishLikePostal = /^\d{2}-\d{3}$/.test(token);
      if (isPolishLikePostal && !isGerman) {
        return token;
      }
      const hasDigit = /\d/.test(token);
      const isUpperCode = /^[A-Z0-9]+(?:[-–—][A-Z0-9]+)+$/.test(token);
      if (hasDigit || isUpperCode) {
        return token.replace(/[-–—\u2010-\u2015]+/g, '');
      }
      return token;
    })
    .join(' ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDateIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getTodayIsoDate(): string {
  return formatLocalDateIso(new Date());
}

export function getMaxStayIsoDate(): string {
  const maxYear = new Date().getFullYear() + 2;
  return `${maxYear}-12-31`;
}

export function addDaysToIso(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();
  base.setDate(base.getDate() + days);
  return formatLocalDateIso(base);
}

export function clampStayDate(rawValue: string, fallbackIso?: string): string {
  const todayIso = getTodayIsoDate();
  const maxIso = getMaxStayIsoDate();
  const safeFallback =
    fallbackIso && /^\d{4}-\d{2}-\d{2}$/.test(fallbackIso) && fallbackIso >= todayIso && fallbackIso <= maxIso
      ? fallbackIso
      : todayIso;

  if (!rawValue) return safeFallback;
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(rawValue.trim());
  if (!match) return safeFallback;

  const currentYear = new Date().getFullYear();
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || year > currentYear + 2 || year < currentYear) {
    year = currentYear;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return safeFallback;
  }

  const normalizedDate = new Date(year, month - 1, day);
  if (Number.isNaN(normalizedDate.getTime())) return safeFallback;

  const iso = formatLocalDateIso(normalizedDate);
  if (iso < todayIso) return todayIso;
  if (iso > maxIso) return maxIso;
  return iso;
}

export function getCurrentStayDates(
  startOffsetDays = 0,
  nights = 2
): { checkIn: string; checkOut: string } {
  const todayIso = getTodayIsoDate();
  const checkIn = addDaysToIso(todayIso, startOffsetDays);
  const checkOut = addDaysToIso(checkIn, Math.max(1, nights));
  return { checkIn, checkOut };
}

export function getNextWeekendDates(): { checkIn: string; checkOut: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
  let daysUntilFri = (5 - dayOfWeek + 7) % 7;
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    daysUntilFri = 0; // Today if Fri or Sat
  }
  const checkInDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilFri);
  const checkOutDate = new Date(
    checkInDate.getFullYear(),
    checkInDate.getMonth(),
    checkInDate.getDate() + (dayOfWeek === 6 ? 1 : 2)
  );
  return {
    checkIn: formatLocalDateIso(checkInDate),
    checkOut: formatLocalDateIso(checkOutDate),
  };
}

export function formatPolishDateDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function countStayNights(checkIn: string, checkOut: string): number {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkIn);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkOut);
  if (!m1 || !m2) return 1;
  const d1 = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const d2 = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000);
  return diff > 0 ? diff : 1;
}

export function parseStayPriceEur(
  approxPriceEur?: string | null,
  priceNumericEur?: number | null
): number | null {
  if (typeof priceNumericEur === 'number' && Number.isFinite(priceNumericEur) && priceNumericEur > 0) {
    return Math.round(priceNumericEur);
  }
  const raw = String(approxPriceEur || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d{2,4})(?:[.,]\d{1,2})?/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) && num > 0 && num < 5000 ? num : null;
}

export function buildBookingDeepLink(
  name: string,
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  maxPriceEur?: number | null
): string {
  const params = new URLSearchParams();
  params.set('ss', `${name} ${city || 'Europe'}`.trim());
  if (checkIn) params.set('checkin', clampStayDate(checkIn));
  if (checkOut) params.set('checkout', clampStayDate(checkOut));
  params.set('group_adults', String(guests));
  params.set('no_rooms', '1');
  if (typeof maxPriceEur === 'number' && maxPriceEur > 0) {
    params.set('nflt', `price=EUR-0-${Math.round(maxPriceEur)}-1`);
  }
  return `https://www.booking.com/searchresults.pl.html?${params.toString()}`;
}

export function buildAirbnbDeepLink(
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  maxPriceEur?: number | null
): string {
  const cleanCity = city.trim() || 'Europe';
  const query = encodeURIComponent(cleanCity);
  const params = new URLSearchParams();
  if (checkIn) params.set('checkin', clampStayDate(checkIn));
  if (checkOut) params.set('checkout', clampStayDate(checkOut));
  params.set('adults', String(guests));
  if (typeof maxPriceEur === 'number' && maxPriceEur > 0) {
    params.set('price_max', String(Math.round(maxPriceEur)));
  }
  return `https://www.airbnb.pl/s/${query}/homes?${params.toString()}`;
}

export function buildHrsDeepLink(
  name: string,
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2
): string {
  const params = new URLSearchParams();
  params.set('query', `${name} ${city || 'Berlin'}`.trim());
  if (checkIn) params.set('arrival', clampStayDate(checkIn));
  if (checkOut) params.set('departure', clampStayDate(checkOut));
  params.set('adults', String(guests));
  return `https://www.hrs.de/search?${params.toString()}`;
}

export function buildFewoDeepLink(
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2
): string {
  const params = new URLSearchParams();
  params.set('destination', city.trim() || 'Europe');
  if (checkIn) params.set('startDate', clampStayDate(checkIn));
  if (checkOut) params.set('endDate', clampStayDate(checkOut));
  params.set('adults', String(guests));
  return `https://www.fewo-direkt.de/search?${params.toString()}`;
}

export function buildExpediaDeepLink(
  name: string,
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2
): string {
  const params = new URLSearchParams();
  params.set('destination', `${name ? `${name}, ` : ''}${city.trim() || 'Europe'}`);
  if (checkIn) params.set('startDate', clampStayDate(checkIn));
  if (checkOut) params.set('endDate', clampStayDate(checkOut));
  params.set('adults', String(guests));
  return `https://www.expedia.de/Hotel-Search?${params.toString()}`;
}

export function buildGoogleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildGoogleMapsDirectionsUrl(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function buildGoogleMapsDrivingRouteUrl(
  origin: string,
  destination: string
): string {
  const params = new URLSearchParams();
  params.set('api', '1');
  if (origin.trim()) params.set('origin', origin.trim());
  params.set('destination', destination.trim() || 'Berlin');
  params.set('travelmode', 'driving');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildYouTubeSearchUrl(query?: string): string {
  const clean = (query || '').trim();
  if (!clean) return 'https://www.youtube.com/';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(clean)}`;
}

export function buildYouTubeMusicSearchUrl(query?: string): string {
  const clean = (query || '').trim();
  if (!clean) return 'https://music.youtube.com/';
  return `https://music.youtube.com/search?q=${encodeURIComponent(clean)}`;
}

export function buildBrowserUrl(query?: string): string {
  const q = (query || '').trim();
  if (!q) return 'https://www.google.com/';
  if (/^https?:\/\//i.test(q)) return q;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q)) return `https://${q}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function buildAndroidAlarmIntentUrl(timeHHMM: string, label: string): string {
  const [hStr, mStr] = timeHHMM.split(':');
  const hour = Number(hStr) || 7;
  const minutes = Number(mStr) || 0;
  const safeMsg = encodeURIComponent(label || 'Budzik Miekiszon');
  return `intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${hour};i.android.intent.extra.alarm.MINUTES=${minutes};S.android.intent.extra.alarm.MESSAGE=${safeMsg};B.android.intent.extra.alarm.SKIP_UI=false;end`;
}

function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

function buildAndroidPackageIntent(webUrl: string, pkgName: string): string {
  try {
    const u = new URL(webUrl);
    const hostAndPath = `${u.host}${u.pathname}${u.search}`;
    return `intent://${hostAndPath}#Intent;scheme=${u.protocol.replace(':', '')};package=${pkgName};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  } catch {
    return webUrl;
  }
}

export function getAppLaunchInfo(
  app: PhoneAppTarget,
  query?: string,
  contactPhone?: string
): { title: string; url: string; fallbackUrl?: string; appLabel: string } {
  const q = (query || '').trim();
  const onAndroid = isAndroidDevice();

  switch (app) {
    case 'chrome': {
      const webUrl = buildBrowserUrl(q);
      return {
        title: q ? `Google Chrome: ${q}` : 'Otwórz Google Chrome',
        url: onAndroid ? buildAndroidPackageIntent(webUrl, 'com.android.chrome') : webUrl,
        fallbackUrl: webUrl,
        appLabel: 'Google Chrome',
      };
    }
    case 'youtube_music': {
      const webUrl = buildYouTubeMusicSearchUrl(q);
      return {
        title: q ? `YouTube Music: ${q}` : 'Otwórz YouTube Music',
        url: onAndroid
          ? buildAndroidPackageIntent(webUrl, 'com.google.android.apps.youtube.music')
          : webUrl,
        fallbackUrl: webUrl,
        appLabel: 'YouTube Music',
      };
    }
    case 'youtube': {
      const webUrl = buildYouTubeSearchUrl(q);
      return {
        title: q ? `YouTube: ${q}` : 'Otwórz aplikację YouTube',
        url: onAndroid
          ? buildAndroidPackageIntent(webUrl, 'com.google.android.youtube')
          : webUrl,
        fallbackUrl: webUrl,
        appLabel: 'YouTube',
      };
    }
    case 'browser': {
      const webUrl = buildBrowserUrl(q);
      return {
        title: q ? `Google Chrome: ${q}` : 'Przeglądarka Google Chrome',
        url: onAndroid ? buildAndroidPackageIntent(webUrl, 'com.android.chrome') : webUrl,
        fallbackUrl: webUrl,
        appLabel: 'Google Chrome',
      };
    }
    case 'maps':
      return {
        title: q ? `Mapy Google: ${q}` : 'Otwórz Mapy Google',
        url: q ? buildGoogleMapsSearchUrl(q) : 'https://maps.google.com/',
        appLabel: 'Mapy Google',
      };
    case 'whatsapp':
      return {
        title: contactPhone ? `WhatsApp: ${q || contactPhone}` : 'Otwórz WhatsApp',
        url: contactPhone ? buildWhatsappUrl(contactPhone, '') : 'https://wa.me/',
        appLabel: 'WhatsApp',
      };
    case 'booking':
      return {
        title: q ? `Booking.com: ${q}` : 'Otwórz Booking.com',
        url: q
          ? `https://www.booking.com/searchresults.pl.html?ss=${encodeURIComponent(q)}`
          : 'https://www.booking.com/',
        appLabel: 'Booking.com',
      };
    case 'spotify':
      return {
        title: q ? `Spotify: ${q}` : 'Otwórz Spotify',
        url: q
          ? `https://open.spotify.com/search/${encodeURIComponent(q)}`
          : 'https://open.spotify.com/',
        appLabel: 'Spotify',
      };
    case 'calendar':
      return {
        title: 'Otwórz Kalendarz Google',
        url: 'https://calendar.google.com/',
        appLabel: 'Kalendarz',
      };
    case 'clock':
      return {
        title: 'Zegar Android',
        url: buildAndroidAlarmIntentUrl('07:00', q || 'Budzik Miekiszon'),
        appLabel: 'Zegar Android',
      };
    case 'phone':
    default:
      return {
        title: 'Telefon',
        url: contactPhone ? `tel:${sanitizePhoneForTel(contactPhone)}` : 'tel:',
        appLabel: 'Telefon',
      };
  }
}
