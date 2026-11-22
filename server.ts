import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  type FunctionDeclaration,
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function getValidMapsApiKey(): string {
  const raw = (
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();
  if (
    !raw ||
    raw.length < 20 ||
    /^(MY_GOOGLE_MAPS_API_KEY|YOUR_API_KEY|REPLACE_ME|PLACEHOLDER)/i.test(raw)
  ) {
    return '';
  }
  return raw;
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error('Brak klucza GEMINI_API_KEY w konfiguracji serwera.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      apiVersion: 'v1beta',
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ExtractedGroundingLink {
  title: string;
  url: string;
  source: 'maps' | 'web';
  snippet?: string;
}

function extractGroundingLinks(response: any): ExtractedGroundingLink[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const links: ExtractedGroundingLink[] = [];

  for (const chunk of chunks) {
    if (chunk?.maps?.uri && !seen.has(chunk.maps.uri)) {
      seen.add(chunk.maps.uri);
      const reviewSnippet =
        chunk.maps.placeAnswerSources?.reviewSnippets?.[0]?.content || undefined;
      links.push({
        title: chunk.maps.title || 'Google Maps',
        url: chunk.maps.uri,
        source: 'maps',
        snippet: reviewSnippet,
      });
    }
    if (chunk?.web?.uri && !seen.has(chunk.web.uri)) {
      seen.add(chunk.web.uri);
      links.push({
        title: chunk.web.title || 'Źródło internetowe',
        url: chunk.web.uri,
        source: 'web',
      });
    }
  }
  return links;
}

function stripHyphensForCodeOnly(input: string): string {
  return (input || '').replace(/[-–—\u2010-\u2015\s]+/g, '').trim();
}

function detectGermanContext(input: string, explicitCountry?: string): boolean {
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
    /\bDE[-\s]?\d{5}\b/i.test(input)
  );
}

function sanitizeCodeTokensInQuery(input: string, explicitCountry?: string): string {
  if (!input) return '';
  const isGerman = detectGermanContext(input, explicitCountry);
  let normalized = input.trim();

  if (isGerman) {
    normalized = normalized.replace(/\b(?:DE|D)[-\s]+(\d{2})[-–—\s]?(\d{3})\b/gi, '$1$2');
  }

  return normalized
    .split(/\s+/)
    .map((token) => {
      if (!/[-–—]/.test(token)) return token;
      if (isGerman && /\d/.test(token)) {
        return token.replace(/[-–—\u2010-\u2015]+/g, '');
      }
      if (/^\d{2}-\d{3}$/.test(token) && !isGerman) {
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

const fastResponseCache = new Map<string, { expiresAt: number; payload: any }>();

function getCachedPayload<T>(key: string): T | null {
  const hit = fastResponseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    fastResponseCache.delete(key);
    return null;
  }
  return hit.payload as T;
}

function setCachedPayload(key: string, payload: any, ttlMs = 180_000): void {
  if (fastResponseCache.size > 250) {
    const oldestKey = fastResponseCache.keys().next().value;
    if (oldestKey) fastResponseCache.delete(oldestKey);
  }
  fastResponseCache.set(key, { expiresAt: Date.now() + ttlMs, payload });
}

function resolveCountryMeta(
  input: string,
  explicitCountry?: string
): { regionCode?: string; countryName?: string } {
  const combined = `${explicitCountry || ''} ${input || ''}`.trim().toLowerCase();
  if (
    detectGermanContext(input, explicitCountry) ||
    /\bdeu?\b/i.test(explicitCountry || '')
  ) {
    return { regionCode: 'DE', countryName: 'Germany' };
  }
  if (
    /\b(polsk[aieę]|poland|polen|pl)\b/i.test(combined) ||
    (!explicitCountry && /^\d{2}-\d{3}$/.test((input || '').trim()))
  ) {
    return { regionCode: 'PL', countryName: 'Poland' };
  }
  if (/\b(franc\w*|frankreich|france|fr)\b/i.test(combined)) {
    return { regionCode: 'FR', countryName: 'France' };
  }
  if (/\b(austr\w*|österreich|at)\b/i.test(combined)) {
    return { regionCode: 'AT', countryName: 'Austria' };
  }
  if (/\b(czech\w*|tschech\w*|česk\w*|cz)\b/i.test(combined)) {
    return { regionCode: 'CZ', countryName: 'Czechia' };
  }
  if (/\b(szwajc\w*|schweiz|switzerland|ch)\b/i.test(combined)) {
    return { regionCode: 'CH', countryName: 'Switzerland' };
  }
  if (/\b(holand\w*|niderland\w*|niederlande|netherlands|nl)\b/i.test(combined)) {
    return { regionCode: 'NL', countryName: 'Netherlands' };
  }
  if (/\b(włoch\w*|ital\w*|it)\b/i.test(combined)) {
    return { regionCode: 'IT', countryName: 'Italy' };
  }
  if (/\b(hiszpan\w*|span\w*|es)\b/i.test(combined)) {
    return { regionCode: 'ES', countryName: 'Spain' };
  }
  if (/\b(uk|gb|england|wielk\w*\s+bryt\w*|united kingdom)\b/i.test(combined)) {
    return { regionCode: 'GB', countryName: 'United Kingdom' };
  }
  return {};
}

function formatPlacesLocationQuery(
  cleanLocation: string,
  meta: { regionCode?: string; countryName?: string }
): string {
  if (!cleanLocation) return '';
  let text = cleanLocation.trim();
  if (meta.regionCode && meta.countryName) {
    const isoRegex = new RegExp(`(?:,|\\s)+${meta.regionCode}$`, 'i');
    text = text.replace(isoRegex, '').trim();
    if (!text.toLowerCase().includes(meta.countryName.toLowerCase())) {
      text = `${text}, ${meta.countryName}`;
    }
  }
  return text;
}

async function resolvePostalBiasCoords(
  placesLocationText: string,
  regionCode: string | undefined,
  mapsApiKey: string
): Promise<{ lat: number; lng: number } | null> {
  if (!placesLocationText || !/\d/.test(placesLocationText)) return null;
  const geoKey = `geo|${regionCode || ''}|${placesLocationText.toLowerCase()}`;
  const cached = getCachedPayload<{ lat: number; lng: number } | null>(geoKey);
  if (cached) return cached;

  if (mapsApiKey) {
    try {
      const gRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          placesLocationText
        )}${regionCode ? `&region=${regionCode}` : ''}&key=${mapsApiKey}`,
        { signal: AbortSignal.timeout(1200) }
      );
      if (gRes.ok) {
        const gJson: any = await gRes.json();
        const loc = gJson?.results?.[0]?.geometry?.location;
        if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
          const coords = { lat: loc.lat, lng: loc.lng };
          setCachedPayload(geoKey, coords, 3_600_000);
          return coords;
        }
      }
    } catch {
      // fall through to Nominatim
    }
  }

  try {
    const nRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
        placesLocationText
      )}${regionCode ? `&countrycodes=${regionCode.toLowerCase()}` : ''}`,
      {
        headers: { 'User-Agent': 'MiekiszonAssistant/1.0' },
        signal: AbortSignal.timeout(1200),
      }
    );
    if (nRes.ok) {
      const nJson: any = await nRes.json();
      const first = Array.isArray(nJson) ? nJson[0] : null;
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const coords = { lat, lng };
        setCachedPayload(geoKey, coords, 3_600_000);
        return coords;
      }
    }
  } catch {
    // ignore timeout
  }
  return null;
}

interface ResolvedVoiceConfig {
  id: string;
  gender: 'female' | 'male';
  voiceName: 'Kore' | 'Aoede' | 'Zephyr' | 'Charon' | 'Fenrir' | 'Puck' | 'Orus';
  ttsStylePl: string;
  ttsStyleDe: string;
  personaPl: string;
  personaDe: string;
}

function resolveVoiceConfig(rawVoice?: string | null): ResolvedVoiceConfig {
  switch (rawVoice) {
    case 'female_aoede':
      return {
        id: 'female_aoede',
        gender: 'female',
        voiceName: 'Aoede',
        ttsStylePl: 'Gentle, melodic, expressive Polish woman around 28 years old, warm everyday conversational tone',
        ttsStyleDe: 'Sanfte, melodische deutsche Frauenstimme (ca. 28 Jahre), natürlich und herzlich',
        personaPl: 'Nazywasz się Miękiszon. Mówisz delikatnym, melodyjnym, uprzejmym głosem kobiecym (Aoede) wyłącznie po polsku.',
        personaDe: 'Du heißt Miękiszon. Du sprichst mit einer sanften, melodischen weiblichen Stimme (Aoede) ausschließlich natürliches Deutsch.',
      };
    case 'female_zephyr':
      return {
        id: 'female_zephyr',
        gender: 'female',
        voiceName: 'Zephyr',
        ttsStylePl: 'Bright, clear, calm Polish woman around 32 years old, crisp articulation and friendly tone',
        ttsStyleDe: 'Klare, freundliche, ruhige deutsche Frauenstimme (ca. 32 Jahre), präzise Aussprache',
        personaPl: 'Nazywasz się Miękiszon. Mówisz pogodnym, wyraźnym i życzliwym głosem kobiecym (Zephyr) wyłącznie po polsku.',
        personaDe: 'Du heißt Miękiszon. Du sprichst mit einer klaren, freundlichen weiblichen Stimme (Zephyr) ausschließlich natürliches Deutsch.',
      };
    case 'male':
    case 'male_charon':
      return {
        id: 'male_charon',
        gender: 'male',
        voiceName: 'Charon',
        ttsStylePl: 'Calm, warm, deep Polish man around 32 years old, composed and clear everyday tone',
        ttsStyleDe: 'Ruhige, tiefe, besonnene deutsche Männerstimme (ca. 32 Jahre), klar und höflich',
        personaPl: 'Nazywasz się Miękiszon. Mówisz spokojnym, głębokim, uprzejmym męskim głosem (Charon) wyłącznie po polsku.',
        personaDe: 'Du heißt Miękiszon. Du sprichst mit einer ruhigen, tiefen, höflichen männlichen Stimme (Charon) ausschließlich natürliches Deutsch.',
      };
    case 'male_fenrir':
      return {
        id: 'male_fenrir',
        gender: 'male',
        voiceName: 'Fenrir',
        ttsStylePl: 'Confident, articulate, grounded Polish man around 35 years old, helpful everyday assistant tone',
        ttsStyleDe: 'Markante, selbstbewusste, klare deutsche Männerstimme (ca. 35 Jahre), direkt und hilfsbereit',
        personaPl: 'Nazywasz się Miękiszon. Mówisz wyrazistym, pewnym i rzeczowym głosem męskim (Fenrir) wyłącznie po polsku.',
        personaDe: 'Du heißt Miękiszon. Du sprichst mit einer markanten, klaren männlichen Stimme (Fenrir) ausschließlich natürliches Deutsch.',
      };
    case 'male_puck':
      return {
        id: 'male_puck',
        gender: 'male',
        voiceName: 'Puck',
        ttsStylePl: 'Energetic, friendly, upbeat Polish man around 27 years old, natural conversational tone',
        ttsStyleDe: 'Lebendige, freundliche, dynamische deutsche Männerstimme (ca. 27 Jahre), natürlich und engagiert',
        personaPl: 'Nazywasz się Miękiszon. Mówisz żywym, przyjaznym i naturalnym głosem męskim (Puck) wyłącznie po polsku.',
        personaDe: 'Du heißt Miękiszon. Du sprichst mit einer lebendigen, freundlichen männlichen Stimme (Puck) ausschließlich natürliches Deutsch.',
      };
    case 'male_massimo':
      return {
        id: 'male_massimo',
        gender: 'male',
        voiceName: 'Orus',
        ttsStylePl:
          'Deep, low-pitched, velvety, charismatic and intensely confident Polish male voice like Massimo from 365 dni (~34 years old), smooth unhurried cadence, magnetic gravelly warmth, speaking natural idiomatic Polish',
        ttsStyleDe:
          'Sehr tiefe, samtige, charismatische und souveräne Männerstimme wie Massimo aus 365 Tage (ca. 34 Jahre), ruhiger eindringlicher Rhythmus, leicht rauchig und selbstbewusst',
        personaPl:
          'Nazywasz się Miękiszon i mówisz głębokim, niskim, charyzmatycznym i pewnym siebie polskim głosem męskim w stylu Massimo z filmu 365 dni (Orus) — spokojnie, zdecydowanie, ciepło i wyłącznie poprawną polszczyzną.',
        personaDe:
          'Du heißt Miękiszon und sprichst mit einer tiefen, samtigen, charismatischen Männerstimme im Stil von Massimo aus 365 Tage (Orus) — ruhig, souverän und ausschließlich natürliches Deutsch.',
      };
    case 'female':
    case 'female_kore':
    default:
      return {
        id: 'female_kore',
        gender: 'female',
        voiceName: 'Kore',
        ttsStylePl: 'Subtle, calm, warm Polish woman around 30 years old, gentle soft-spoken natural everyday tone',
        ttsStyleDe: 'Subtile, warme, ruhige deutsche Frauenstimme (ca. 30 Jahre), sanft und natürlich',
        personaPl: 'Nazywasz się Miękiszon. Mówisz subtelnym, ciepłym, opanowanym damskim głosem (Kore) wyłącznie po polsku.',
        personaDe: 'Du heißt Miękiszon. Du sprichst mit einer subtilen, warmen, ruhigen weiblichen Stimme (Kore) ausschließlich natürliches Deutsch.',
      };
  }
}

function getBerlinTodayIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value || String(new Date().getFullYear());
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function addDaysIsoServer(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function normalizeStayDates(rawIn?: string, rawOut?: string): { checkIn: string; checkOut: string } {
  const todayIso = getBerlinTodayIso();
  const currentYear = Number(todayIso.slice(0, 4));
  const maxIso = `${currentYear + 2}-12-31`;

  const cleanDate = (val: string | undefined, fallback: string): string => {
    if (!val) return fallback;
    const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(val.trim());
    if (!match) return fallback;
    let year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || year < currentYear || year > currentYear + 2) {
      year = currentYear;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return fallback;
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(dt.getTime())) return fallback;
    const iso = dt.toISOString().slice(0, 10);
    if (iso < todayIso) return todayIso;
    if (iso > maxIso) return maxIso;
    return iso;
  };

  const checkIn = cleanDate(rawIn, todayIso);
  let checkOut = cleanDate(rawOut, addDaysIsoServer(checkIn, 2));
  if (checkOut <= checkIn) {
    checkOut = addDaysIsoServer(checkIn, 2);
  }
  return { checkIn, checkOut };
}

function buildBookingUrl(
  name: string,
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  countryLabel = ''
): string {
  const params = new URLSearchParams();
  params.set('ss', `${name} ${city} ${countryLabel}`.replace(/\s+/g, ' ').trim());
  if (checkIn) params.set('checkin', checkIn);
  if (checkOut) params.set('checkout', checkOut);
  params.set('group_adults', String(guests));
  params.set('no_rooms', '1');
  return `https://www.booking.com/searchresults.pl.html?${params.toString()}`;
}

function buildAirbnbUrl(
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  countryLabel = ''
): string {
  const locationPart = [city, countryLabel].filter(Boolean).join(', ') || 'Europe';
  const query = encodeURIComponent(locationPart);
  const params = new URLSearchParams();
  if (checkIn) params.set('checkin', checkIn);
  if (checkOut) params.set('checkout', checkOut);
  params.set('adults', String(guests));
  return `https://www.airbnb.pl/s/${query}/homes?${params.toString()}`;
}

function buildHrsUrl(
  name: string,
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  countryLabel = ''
): string {
  const params = new URLSearchParams();
  params.set('query', `${name} ${city} ${countryLabel}`.replace(/\s+/g, ' ').trim());
  if (checkIn) params.set('arrival', checkIn);
  if (checkOut) params.set('departure', checkOut);
  params.set('adults', String(guests));
  return `https://www.hrs.de/search?${params.toString()}`;
}

function buildFewoUrl(
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  countryLabel = ''
): string {
  const params = new URLSearchParams();
  params.set('destination', [city, countryLabel].filter(Boolean).join(', ') || 'Europe');
  if (checkIn) params.set('startDate', checkIn);
  if (checkOut) params.set('endDate', checkOut);
  params.set('adults', String(guests));
  return `https://www.fewo-direkt.de/search?${params.toString()}`;
}

function buildExpediaUrl(
  name: string,
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
  countryLabel = ''
): string {
  const params = new URLSearchParams();
  params.set(
    'destination',
    [name, city, countryLabel].filter(Boolean).join(', ') || 'Europe'
  );
  if (checkIn) params.set('startDate', checkIn);
  if (checkOut) params.set('endDate', checkOut);
  params.set('adults', String(guests));
  return `https://www.expedia.de/Hotel-Search?${params.toString()}`;
}

function isQuotaOrRateError(err: any): boolean {
  const msg = String(err?.message || err || '');
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    /quota|rate[\s_-]?limit/i.test(msg)
  );
}

function formatFriendlyApiError(
  err: any,
  fallback: string
): { status: number; message: string } {
  const rawMsg = String(err?.message || err || '');
  let msg = rawMsg;
  let parsedCode: number | null = null;

  if (/^\s*\{.*"error"\s*:/.test(rawMsg)) {
    try {
      const parsed = JSON.parse(rawMsg);
      if (parsed?.error?.message) {
        msg = String(parsed.error.message);
        if (parsed?.error?.code) {
          parsedCode = Number(parsed.error.code) || null;
        }
      }
    } catch {
      // fall through
    }
  }

  if (isQuotaOrRateError(err) || parsedCode === 429) {
    return {
      status: 429,
      message:
        'Przekroczono chwilowy limit zapytań Gemini API (429). Spróbuj ponownie za chwilę lub sprawdź plan i klucz API.',
    };
  }
  if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || parsedCode === 401) {
    return {
      status: 401,
      message:
        'Błąd autoryzacji Gemini API (401). Sprawdź poprawność klucza GEMINI_API_KEY w zmiennych środowiskowych.',
    };
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || parsedCode === 403) {
    return {
      status: 403,
      message:
        'Brak uprawnień klucza Gemini API (403). Sprawdź konfigurację klucza i uprawnienia projektu.',
    };
  }
  if (msg.includes('404') || msg.includes('NOT_FOUND') || parsedCode === 404) {
    return {
      status: 404,
      message:
        'Wybrany model Gemini nie jest dostępny (404). Zweryfikuj nazwę modelu lub uprawnienia klucza.',
    };
  }
  if (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid') ||
    parsedCode === 400
  ) {
    return {
      status: 400,
      message:
        msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')
          ? 'Nieprawidłowy klucz Gemini API (400). Sprawdź klucz GEMINI_API_KEY w konfiguracji serwera.'
          : `Nieprawidłowe żądanie do Gemini API (400): ${msg}`,
    };
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || parsedCode === 503) {
    return {
      status: 503,
      message:
        'Usługa Gemini API jest chwilowo niedostępna (503). Spróbuj ponownie za moment.',
    };
  }
  return { status: parsedCode || 500, message: msg || fallback };
}

function parseModelJsonObject<T = Record<string, any>>(rawText?: string | null): T | null {
  if (!rawText) return null;
  let cleaned = rawText.trim();
  if (!cleaned) return null;
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(cleaned);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? (parsed as T) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeAudioMimeType(rawMime?: string | null): string {
  const base = String(rawMime || 'audio/wav')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (
    base === 'audio/wav' ||
    base === 'audio/wave' ||
    base === 'audio/x-wav'
  ) {
    return 'audio/wav';
  }
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') {
    return 'audio/mp4';
  }
  if (base === 'audio/mpeg' || base === 'audio/mp3') {
    return 'audio/mp3';
  }
  if (base === 'audio/ogg' || base === 'audio/opus') {
    return 'audio/ogg';
  }
  if (base === 'audio/webm') {
    return 'audio/webm';
  }
  return base || 'audio/wav';
}

interface NominatimBounds {
  lat: number;
  lng: number;
  viewbox: string; // left,top,right,bottom
  resolvedLocation: string;
  countryName?: string;
}

async function resolveNominatimBounds(
  cleanLocation: string,
  coordinates?: { lat: number; lng: number },
  regionCode?: string
): Promise<NominatimBounds | null> {
  if (cleanLocation) {
    try {
      const nUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(
        cleanLocation
      )}${regionCode ? `&countrycodes=${regionCode.toLowerCase()}` : ''}`;
      const resp = await fetch(nUrl, {
        headers: { 'User-Agent': 'MiekiszonAssistant/1.0' },
        signal: AbortSignal.timeout(4500),
      });
      if (resp.ok) {
        const arr: any = await resp.json();
        const first = Array.isArray(arr) ? arr[0] : null;
        const lat = Number(first?.lat);
        const lng = Number(first?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const bb = Array.isArray(first?.boundingbox) ? first.boundingbox.map(Number) : null;
          const delta = 0.035;
          const south = bb && Number.isFinite(bb[0]) ? Math.min(bb[0], lat - delta) : lat - delta;
          const north = bb && Number.isFinite(bb[1]) ? Math.max(bb[1], lat + delta) : lat + delta;
          const west = bb && Number.isFinite(bb[2]) ? Math.min(bb[2], lng - delta) : lng - delta;
          const east = bb && Number.isFinite(bb[3]) ? Math.max(bb[3], lng + delta) : lng + delta;
          const addr = first?.address || {};
          const cityName =
            addr.city || addr.town || addr.village || addr.municipality || first?.name || cleanLocation;
          return {
            lat,
            lng,
            viewbox: `${west},${north},${east},${south}`,
            resolvedLocation: first?.display_name
              ? `${cityName}${addr.postcode ? ` (${addr.postcode})` : ''}`
              : cleanLocation,
            countryName: addr.country || undefined,
          };
        }
      }
    } catch {
      // fall through to coordinates if present
    }
  }

  if (
    coordinates &&
    typeof coordinates.lat === 'number' &&
    typeof coordinates.lng === 'number'
  ) {
    const { lat, lng } = coordinates;
    const delta = 0.035;
    let resolvedLocation = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    let countryName: string | undefined;
    try {
      const revResp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
        {
          headers: { 'User-Agent': 'MiekiszonAssistant/1.0' },
          signal: AbortSignal.timeout(3500),
        }
      );
      if (revResp.ok) {
        const rev: any = await revResp.json();
        const addr = rev?.address || {};
        const city = addr.city || addr.town || addr.village || addr.suburb || '';
        const pc =
          addr.country_code === 'de'
            ? stripHyphensForCodeOnly(addr.postcode || '')
            : addr.postcode || '';
        const joined = `${pc ? `${pc} ` : ''}${city}`.trim();
        if (joined) resolvedLocation = joined;
        countryName = addr.country || undefined;
      }
    } catch {
      // ignore reverse lookup error
    }
    return {
      lat,
      lng,
      viewbox: `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`,
      resolvedLocation,
      countryName,
    };
  }

  return null;
}

async function queryNominatimPlaces(
  query: string,
  viewbox: string,
  limit = 10
): Promise<any[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=${limit}&q=${encodeURIComponent(
      query
    )}&viewbox=${encodeURIComponent(viewbox)}&bounded=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'MiekiszonAssistant/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function searchFoodViaNominatim(params: {
  cleanLocation: string;
  coordinates?: { lat: number; lng: number };
  category: 'all' | 'doner' | 'pizza' | 'chinese' | 'near_post';
  isGerman: boolean;
  country?: string;
}): Promise<any | null> {
  const countryMeta = resolveCountryMeta(params.cleanLocation, params.country);
  const bounds = await resolveNominatimBounds(
    params.cleanLocation,
    params.coordinates,
    countryMeta.regionCode
  );
  if (!bounds) return null;

  let searchViewbox = bounds.viewbox;
  let postOffice: any = null;

  if (params.category === 'near_post') {
    const posts = await queryNominatimPlaces('[amenity=post_office]', bounds.viewbox, 4);
    const pickedPost = posts.find((p) => p?.lat && p?.lon);
    if (pickedPost) {
      const pAddr = pickedPost.address || {};
      const pLat = Number(pickedPost.lat);
      const pLng = Number(pickedPost.lon);
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        const d = 0.015;
        searchViewbox = `${pLng - d},${pLat + d},${pLng + d},${pLat - d}`;
      }
      const rawPc = pAddr.postcode || '';
      const postalCode =
        pAddr.country_code === 'de' || params.isGerman
          ? stripHyphensForCodeOnly(rawPc)
          : rawPc;
      postOffice = {
        name: pickedPost.name || 'Placówka pocztowa',
        address: [pAddr.road, pAddr.house_number].filter(Boolean).join(' ') || bounds.resolvedLocation,
        postalCode,
        city: pAddr.city || pAddr.town || pAddr.village || bounds.resolvedLocation,
        distanceNote: 'Centrum wyszukiwania w pobliżu poczty (OpenStreetMap)',
      };
    }
  }

  const queriesByCategory: Record<string, string[]> = {
    all: ['[amenity=restaurant]', '[amenity=fast_food]'],
    doner: ['kebab', '[amenity=fast_food]', '[amenity=restaurant]'],
    pizza: ['pizzeria', 'pizza', '[amenity=restaurant]'],
    chinese: ['asia restaurant', '[amenity=restaurant]', '[amenity=fast_food]'],
    near_post: ['[amenity=restaurant]', '[amenity=fast_food]'],
  };

  const queryList = queriesByCategory[params.category] || queriesByCategory.all;
  const batches = await Promise.all(
    queryList.map((q) => queryNominatimPlaces(q, searchViewbox, 8))
  );
  const flatRaw = batches.flat();

  const seen = new Set<string>();
  const candidates: any[] = [];
  for (const item of flatRaw) {
    const name = String(item?.name || item?.address?.amenity || '').trim();
    if (!name) continue;
    const isFood =
      item?.category === 'amenity' &&
      ['restaurant', 'fast_food', 'cafe', 'biergarten', 'pub'].includes(String(item?.type || ''));
    if (!isFood) continue;
    const road = String(item?.address?.road || '').trim();
    const dedupKey = `${name.toLowerCase()}|${road.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    candidates.push(item);
  }

  if (candidates.length === 0) return null;

  const scoreItem = (item: any): number => {
    const text = `${item?.name || ''} ${item?.extratags?.cuisine || ''}`.toLowerCase();
    if (params.category === 'doner') {
      if (/(kebab|döner|doner|kebap|turkish|falafel|shawarma|gyros)/.test(text)) return 3;
    } else if (params.category === 'pizza') {
      if (/(pizza|pizzeria|italian|pasta|trattoria|osteri)/.test(text)) return 3;
    } else if (params.category === 'chinese') {
      if (/(chin|asia|thai|viet|sushi|wok|noodle|ramen|bamboo|panda)/.test(text)) return 3;
    }
    return item?.extratags?.phone || item?.extratags?.['contact:phone'] ? 1 : 0;
  };

  candidates.sort((a, b) => scoreItem(b) - scoreItem(a));

  const results = candidates.slice(0, 8).map((item, idx) => {
    const addr = item.address || {};
    const extras = item.extratags || {};
    const name = String(item.name || addr.amenity || `Restauracja ${idx + 1}`).trim();
    const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
    const city = addr.city || addr.town || addr.village || addr.municipality || bounds.resolvedLocation;
    const rawPc = String(addr.postcode || '');
    const postalCode =
      addr.country_code === 'de' || params.isGerman
        ? stripHyphensForCodeOnly(rawPc)
        : rawPc;
    const cuisineRaw = String(extras.cuisine || '').replace(/;/g, ', ');
    const lowerText = `${name} ${cuisineRaw}`.toLowerCase();
    const mappedCat: 'doner' | 'pizza' | 'chinese' | 'other' = /(kebab|döner|doner|falafel|turkish)/.test(
      lowerText
    )
      ? 'doner'
      : /(pizza|italian)/.test(lowerText)
        ? 'pizza'
        : /(chin|asia|thai|viet|sushi|wok)/.test(lowerText)
          ? 'chinese'
          : 'other';

    const categoryLabel =
      mappedCat === 'doner'
        ? 'Döner / Kebab'
        : mappedCat === 'pizza'
          ? 'Pizza / Włoska'
          : mappedCat === 'chinese'
            ? 'Kuchnia azjatycka'
            : item.type === 'fast_food'
              ? 'Fast food / Bistro'
              : 'Restauracja';

    const fullAddress = `${street || item.display_name}${postalCode ? `, ${postalCode}` : ''} ${city}`.trim();
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${name} ${fullAddress}`
    )}`;

    return {
      id: `osm_food_${item.osm_id || idx}`,
      name,
      category: mappedCat,
      categoryLabel,
      address: street || String(item.display_name || '').split(',').slice(0, 2).join(', '),
      postalCode,
      city,
      phone: extras.phone || extras['contact:phone'] || null,
      rating: null,
      reviewCount: null,
      priceLevel: item.type === 'fast_food' ? '€' : '€€',
      openingHours: extras.opening_hours || 'Sprawdź godziny w Google Maps',
      nearPostNote:
        params.category === 'near_post' && postOffice
          ? `W pobliżu: ${postOffice.name}`
          : null,
      highlight: cuisineRaw
        ? `Kuchnia: ${cuisineRaw}`
        : `${categoryLabel} w bazie OpenStreetMap`,
      mapsUrl,
    };
  });

  return {
    validGermany: true,
    resolvedLocation: params.cleanLocation || bounds.resolvedLocation,
    postOffice,
    results,
    groundingLinks: results.slice(0, 6).map((r) => ({
      title: `${r.name} (Google Maps)`,
      url: r.mapsUrl,
      source: 'maps' as const,
    })),
  };
}

async function searchStaysViaNominatim(params: {
  cleanLocation: string;
  coordinates?: { lat: number; lng: number };
  stayType: 'all' | 'hotel' | 'apartment' | 'budget';
  safeCheckIn: string;
  safeCheckOut: string;
  safeGuests: number;
  isGerman: boolean;
  country?: string;
}): Promise<any | null> {
  const countryMeta = resolveCountryMeta(params.cleanLocation, params.country);
  const bounds = await resolveNominatimBounds(
    params.cleanLocation,
    params.coordinates,
    countryMeta.regionCode
  );
  if (!bounds) return null;

  const queriesByType: Record<string, string[]> = {
    all: ['[tourism=hotel]', '[tourism=guest_house]', '[tourism=hostel]', '[tourism=apartment]'],
    hotel: ['[tourism=hotel]'],
    apartment: ['[tourism=apartment]', '[tourism=guest_house]'],
    budget: ['[tourism=hostel]', '[tourism=guest_house]', '[tourism=hotel]'],
  };
  const qList = queriesByType[params.stayType] || queriesByType.all;
  const batches = await Promise.all(qList.map((q) => queryNominatimPlaces(q, bounds.viewbox, 6)));
  const flatRaw = batches.flat();

  const seen = new Set<string>();
  const stays: any[] = [];
  for (const item of flatRaw) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const road = String(item?.address?.road || '').trim();
    const key = `${name.toLowerCase()}|${road.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stays.push(item);
  }

  if (stays.length === 0) return null;

  const fallbackCountry = countryMeta.countryName || bounds.countryName || params.country || '';
  const results = stays.slice(0, 8).map((item, idx) => {
    const addr = item.address || {};
    const extras = item.extratags || {};
    const name = String(item.name || `Nocleg ${idx + 1}`).trim();
    const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
    const city = addr.city || addr.town || addr.village || addr.municipality || bounds.resolvedLocation;
    const rawPc = String(addr.postcode || '');
    const postalCode =
      addr.country_code === 'de' || params.isGerman
        ? stripHyphensForCodeOnly(rawPc)
        : rawPc;
    const rawType = String(item.type || '');
    const mappedStayType: 'hotel' | 'apartment' | 'budget' | 'other' =
      rawType === 'hotel'
        ? 'hotel'
        : rawType === 'apartment'
          ? 'apartment'
          : rawType === 'hostel' || rawType === 'guest_house'
            ? 'budget'
            : 'other';

    const stayTypeLabel =
      mappedStayType === 'hotel'
        ? 'Hotel'
        : mappedStayType === 'apartment'
          ? 'Apartament'
          : mappedStayType === 'budget'
            ? 'Hostel / Pensjonat'
            : 'Nocleg';

    const fullAddr = `${street || item.display_name}${postalCode ? `, ${postalCode}` : ''} ${city}`.trim();
    return {
      id: `osm_stay_${item.osm_id || idx}`,
      name,
      stayType: mappedStayType,
      stayTypeLabel,
      address: street || String(item.display_name || '').split(',').slice(0, 2).join(', '),
      postalCode,
      city,
      phone: extras.phone || extras['contact:phone'] || null,
      rating: null,
      approxPriceEur: 'Sprawdź w portalu',
      distanceInfo: 'W pobliżu lokalizacji',
      highlight: `${stayTypeLabel} na termin ${params.safeCheckIn} – ${params.safeCheckOut} (${params.safeGuests} os.).`,
      bookingUrl: buildBookingUrl(
        name,
        city,
        params.safeCheckIn,
        params.safeCheckOut,
        params.safeGuests,
        fallbackCountry
      ),
      airbnbUrl: buildAirbnbUrl(
        city,
        params.safeCheckIn,
        params.safeCheckOut,
        params.safeGuests,
        fallbackCountry
      ),
      hrsUrl: buildHrsUrl(
        name,
        city,
        params.safeCheckIn,
        params.safeCheckOut,
        params.safeGuests,
        fallbackCountry
      ),
      fewoUrl: buildFewoUrl(
        city,
        params.safeCheckIn,
        params.safeCheckOut,
        params.safeGuests,
        fallbackCountry
      ),
      expediaUrl: buildExpediaUrl(
        name,
        city,
        params.safeCheckIn,
        params.safeCheckOut,
        params.safeGuests,
        fallbackCountry
      ),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${name} ${fullAddr}`
      )}`,
    };
  });

  return {
    validGermany: true,
    resolvedLocation: params.cleanLocation || bounds.resolvedLocation,
    results,
    groundingLinks: results.slice(0, 6).map((r) => ({
      title: `${r.name} (Google Maps)`,
      url: r.mapsUrl,
      source: 'maps' as const,
    })),
  };
}

function formatDurationMinutes(totalSeconds: number, lang: 'pl' | 'de'): string {
  const mins = Math.max(1, Math.round(totalSeconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return lang === 'de' ? `${h} Std. ${m} Min.` : `${h} godz. ${m} min`;
}

async function searchTransitViaOpenSources(params: {
  mode: 'trains' | 'sbahn' | 'buses' | 'fuel' | 'car';
  baseLoc: string;
  cleanTo: string;
  cleanQuery: string;
  country?: string;
  coordinates?: { lat: number; lng: number };
  language: 'pl' | 'de';
}): Promise<any> {
  const originText = params.baseLoc || 'Berlin';
  const destText = params.cleanTo.trim();
  const isDe = params.language === 'de';
  const originMeta = resolveCountryMeta(originText, params.country);
  const bounds = await resolveNominatimBounds(
    originText,
    params.coordinates,
    originMeta.regionCode
  );

  if (params.mode === 'car') {
    const targetDest = destText || params.cleanQuery.trim() || 'Berlin';
    const destMeta = resolveCountryMeta(targetDest, params.country);
    const destBounds = await resolveNominatimBounds(
      targetDest,
      undefined,
      destMeta.regionCode
    );
    const gMapsCarUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      originText
    )}&destination=${encodeURIComponent(targetDest)}&travelmode=driving`;

    const carRoutes: any[] = [];
    if (bounds && destBounds) {
      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${bounds.lng},${bounds.lat};${destBounds.lng},${destBounds.lat}?overview=false&steps=false&alternatives=true`;
        const rResp = await fetch(osrmUrl, {
          headers: { 'User-Agent': 'MiekiszonAssistant/1.0' },
          signal: AbortSignal.timeout(5000),
        });
        if (rResp.ok) {
          const rJson: any = await rResp.json();
          const routes: any[] = Array.isArray(rJson?.routes) ? rJson.routes : [];
          routes.slice(0, 3).forEach((rt, idx) => {
            const distKmNum = Number(rt?.distance || 0) / 1000;
            const durSec = Number(rt?.duration || 0);
            const distText =
              distKmNum >= 1 ? `${Math.round(distKmNum)} km` : `${Math.round(distKmNum * 1000)} m`;
            const durText = formatDurationMinutes(durSec, params.language);
            const approxEur = Math.max(2, Math.round(distKmNum * 0.07 * 1.75));
            const summaryHighways = String(rt?.legs?.[0]?.summary || '').trim();
            carRoutes.push({
              id: `osrm_car_${idx + 1}`,
              routeName:
                idx === 0
                  ? `${originText} → ${targetDest} (${isDe ? 'Schnellste Route' : 'Najszybsza trasa'})`
                  : `${originText} → ${targetDest} (${isDe ? 'Alternative' : 'Wariant'} ${idx + 1})`,
              distanceKm: distText,
              durationText: durText,
              highways: summaryHighways || (isDe ? 'Autobahn / Hauptstraßen' : 'Autostrady i drogi główne'),
              trafficNote: isDe
                ? 'Live-Verkehr in Google Maps prüfen'
                : 'Sprawdź natężenie ruchu na żywo w Google Maps',
              estimatedFuelCostEur: `~${approxEur} EUR`,
              stepsSummary: isDe
                ? `Fahrstrecke von ${bounds.resolvedLocation} nach ${destBounds.resolvedLocation}: ca. ${distText} (${durText}).`
                : `Trasa samochodowa z ${bounds.resolvedLocation} do ${destBounds.resolvedLocation}: ok. ${distText} (${durText}).`,
              directionsUrl: gMapsCarUrl,
            });
          });
        }
      } catch {
        // fall back to direct Google Maps driving route card below
      }
    }

    if (carRoutes.length === 0) {
      carRoutes.push({
        id: 'car_direct_1',
        routeName: `${originText} → ${targetDest}`,
        distanceKm: isDe ? 'In Google Maps' : 'Wg Google Maps',
        durationText: isDe ? 'Live-Navigation' : 'Nawigacja na żywo',
        highways: isDe ? 'Empfohlene Route' : 'Zalecana trasa',
        trafficNote: isDe
          ? 'Aktuelle Staus & Sperrungen in Google Maps'
          : 'Aktualne korki i czas dojazdu w Google Maps',
        estimatedFuelCostEur: '',
        stepsSummary: isDe
          ? `Direkte Routenführung mit Live-Verkehr von ${originText} nach ${targetDest} öffnen.`
          : `Otwórz bezpośrednią nawigację samochodową z ${originText} do ${targetDest} w Google Maps.`,
        directionsUrl: gMapsCarUrl,
      });
    }

    return {
      validGermany: true,
      mode: 'car',
      resolvedQuery: `${originText} → ${targetDest}`,
      summarySpeech:
        carRoutes[0] && carRoutes[0].id.startsWith('osrm_')
          ? isDe
            ? `Die Fahrt von ${originText} nach ${targetDest} beträgt ${carRoutes[0].distanceKm} und dauert etwa ${carRoutes[0].durationText}.`
            : `Trasa samochodowa z ${originText} do ${targetDest} ma ${carRoutes[0].distanceKm}, czas jazdy to około ${carRoutes[0].durationText}.`
          : isDe
            ? `Ich habe die Autofahrt von ${originText} nach ${targetDest} in Google Maps vorbereitet.`
            : `Przygotowałem trasę samochodową z ${originText} do ${targetDest} w Google Maps.`,
      connections: [],
      fuelStations: [],
      carRoutes,
      groundingLinks: [
        {
          title: `Google Maps: ${originText} → ${targetDest}`,
          url: gMapsCarUrl,
          source: 'maps' as const,
        },
      ],
    };
  }

  if (params.mode === 'fuel') {
    const rawStations = bounds
      ? await queryNominatimPlaces('[amenity=fuel]', bounds.viewbox, 8)
      : [];
    const seen = new Set<string>();
    const fuelStations: any[] = [];
    for (let i = 0; i < rawStations.length; i++) {
      const s = rawStations[i];
      const addr = s?.address || {};
      const extras = s?.extratags || {};
      const name = String(s?.name || extras?.brand || `Stacja paliw ${i + 1}`).trim();
      const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
      const pc =
        addr.country_code === 'de' ? stripHyphensForCodeOnly(addr.postcode || '') : addr.postcode || '';
      const city = addr.city || addr.town || addr.village || bounds?.resolvedLocation || originText;
      const fullAddr = `${street || s?.display_name || originText}${pc ? `, ${pc}` : ''} ${city}`.trim();
      const dedup = `${name.toLowerCase()}|${street.toLowerCase()}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      fuelStations.push({
        id: `osm_fuel_${s.osm_id || i}`,
        brand: String(extras?.brand || name.split(' ')[0] || 'Stacja'),
        stationName: name,
        address: fullAddr,
        distanceInfo: isDe ? 'In der Nähe' : 'W pobliżu',
        dieselEur: null,
        e5Eur: null,
        e10Eur: null,
        updatedNote: extras?.opening_hours || (isDe ? 'Preise auf Karte prüfen' : 'Sprawdź aktualną cenę na mapie'),
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${name} ${fullAddr}`
        )}`,
      });
      if (fuelStations.length >= 6) break;
    }

    const fallbackFuelUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `Tankstelle ${originText}`
    )}`;
    if (fuelStations.length === 0) {
      fuelStations.push({
        id: 'fuel_fallback_1',
        brand: 'Google Maps',
        stationName: `Stacje paliw — ${originText}`,
        address: originText,
        distanceInfo: isDe ? 'In der Nähe' : 'W pobliżu',
        dieselEur: null,
        e5Eur: null,
        e10Eur: null,
        updatedNote: isDe ? 'Tankstellenkarte öffnen' : 'Otwórz mapę stacji i cen',
        mapsUrl: fallbackFuelUrl,
      });
    }

    return {
      validGermany: true,
      mode: 'fuel',
      resolvedQuery: bounds?.resolvedLocation || originText,
      summarySpeech: isDe
        ? `Ich habe ${fuelStations.length} Tankstellen in der Nähe von ${originText} gefunden.`
        : `Znalazłem ${fuelStations.length} stacji paliw w pobliżu ${originText}.`,
      connections: [],
      fuelStations,
      carRoutes: [],
      groundingLinks: fuelStations.map((s) => ({
        title: s.stationName,
        url: s.mapsUrl,
        source: 'maps' as const,
      })),
    };
  }

  // Trains, S-Bahn & Buses via OpenStreetMap stations + live schedule links
  const stationQueries =
    params.mode === 'buses'
      ? ['[amenity=bus_station]', 'busbahnhof']
      : params.mode === 'sbahn'
        ? ['S-Bahn', '[railway=station]']
        : ['[railway=station]', 'Bahnhof'];

  const rawStations = bounds
    ? (
        await Promise.all(
          stationQueries.map((q) => queryNominatimPlaces(q, bounds.viewbox, 6))
        )
      ).flat()
    : [];

  const seenStations = new Set<string>();
  const connections: any[] = [];
  for (let i = 0; i < rawStations.length; i++) {
    const st = rawStations[i];
    const name = String(st?.name || '').trim();
    if (!name) continue;
    if (seenStations.has(name.toLowerCase())) continue;
    seenStations.add(name.toLowerCase());
    const addr = st?.address || {};
    const street = [addr.road, addr.postcode, addr.city || addr.town || originText]
      .filter(Boolean)
      .join(' ');
    const stationQuery = `${name} ${street || originText}`.trim();
    const transitUrl = destText
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
          stationQuery
        )}&destination=${encodeURIComponent(destText)}&travelmode=transit`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stationQuery)}`;

    connections.push({
      id: `osm_tr_${st.osm_id || i}`,
      operator:
        params.mode === 'sbahn'
          ? 'S-Bahn'
          : params.mode === 'buses'
            ? 'FlixBus / Komunikacja'
            : originMeta.regionCode === 'PL'
              ? 'PKP / Kolej'
              : 'Deutsche Bahn / Kolej',
      lineOrTrain: name,
      departure: street || originText,
      arrival: destText || (isDe ? 'Live-Abfahrten' : 'Rozkład na żywo'),
      duration: isDe ? 'Live-Fahrplan' : 'Na żywo',
      statusNote: isDe ? 'Aktuelle Abfahrten online' : 'Aktualne odjazdy online',
      priceInfo: isDe ? 'Siehe Portal' : 'Wg taryfy',
      details: `${name}${street ? ` (${street})` : ''}`,
      bookingOrScheduleUrl: transitUrl,
    });
    if (connections.length >= 6) break;
  }

  const mapsTransitUrl = destText
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
        originText
      )}&destination=${encodeURIComponent(destText)}&travelmode=transit`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${params.mode === 'sbahn' ? 'S-Bahn' : params.mode === 'buses' ? 'Bus' : 'Bahnhof'} ${originText}`
      )}`;

  if (connections.length === 0) {
    connections.push({
      id: `tr_fallback_${params.mode}`,
      operator:
        params.mode === 'sbahn'
          ? 'S-Bahn'
          : params.mode === 'buses'
            ? 'FlixBus / Komunikacja'
            : 'DB / PKP',
      lineOrTrain:
        params.mode === 'sbahn' ? `S-Bahn (${originText})` : `Połączenia (${originText})`,
      departure: originText,
      arrival: destText || (isDe ? 'Live-Fahrplan' : 'Rozkład na żywo'),
      duration: 'Live',
      statusNote: isDe ? 'Direktverbindung online' : 'Bezpośredni rozkład online',
      priceInfo: isDe ? 'Siehe Portal' : 'Wg taryfy',
      details: isDe
        ? 'Aktuellen Fahrplan und Abfahrten in Google Maps öffnen.'
        : 'Otwórz aktualny rozkład jazdy i odjazdy w Google Maps oraz portalu przewoźnika.',
      bookingOrScheduleUrl: mapsTransitUrl,
    });
  }

  const portalUrl =
    params.mode === 'sbahn'
      ? 'https://sbahn.berlin/en/plan-a-journey/'
      : params.mode === 'buses'
        ? 'https://www.flixbus.pl/'
        : 'https://www.bahn.de/';

  return {
    validGermany: true,
    mode: params.mode,
    resolvedQuery: destText ? `${originText} → ${destText}` : originText,
    summarySpeech: isDe
      ? `Ich habe ${connections.length} Stationen und Fahrpläne für ${originText} gefunden.`
      : `Znalazłem ${connections.length} stacji i połączeń dla ${originText}.`,
    connections,
    fuelStations: [],
    carRoutes: [],
    groundingLinks: [
      ...connections.slice(0, 4).map((c) => ({
        title: c.lineOrTrain,
        url: c.bookingOrScheduleUrl,
        source: 'maps' as const,
      })),
      {
        title: params.mode === 'sbahn' ? 'S-Bahn Fahrplan' : 'Rozkład jazdy online',
        url: portalUrl,
        source: 'web' as const,
      },
    ],
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '12mb' }));

  const distDir = path.resolve(__dirname, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');
  const isDevLifecycle =
    process.env.npm_lifecycle_event === 'dev' || process.env.NODE_ENV === 'development';
  const useStaticDist =
    process.env.NODE_ENV === 'production' ||
    process.env.SERVE_STATIC === 'true' ||
    (!isDevLifecycle && fs.existsSync(distIndexPath));

  // ---------------------------------------------------------------------------
  // 0. Health Check & Public Maps JS API Key Config
  // ---------------------------------------------------------------------------
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.json({
      status: 'ok',
      mode: useStaticDist ? 'production' : 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/api/health', healthHandler);
  app.get('/healthz', healthHandler);

  app.get('/api/config/maps', (_req, res) => {
    res.json({ apiKey: getValidMapsApiKey() });
  });

  // ---------------------------------------------------------------------------
  // 1. Food search globally by postal code, city, or GPS (Germany hyphen-free)
  // ---------------------------------------------------------------------------
  app.post('/api/search/food', async (req, res) => {
    try {
      const { location, country, category = 'all', coordinates } = req.body as {
        location?: string;
        country?: string;
        category?: 'all' | 'doner' | 'pizza' | 'chinese' | 'near_post';
        coordinates?: { lat: number; lng: number };
      };

      const rawCombined =
        country && location && !location.toLowerCase().includes(country.toLowerCase())
          ? `${location.trim()} ${country.trim()}`
          : location || '';
      const cleanLocation = sanitizeCodeTokensInQuery(rawCombined, country);
      const isGerman = detectGermanContext(rawCombined, country);
      const hasCoords =
        typeof coordinates?.lat === 'number' && typeof coordinates?.lng === 'number';

      if (!cleanLocation && !hasCoords) {
        return res.status(400).json({
          error:
            'Włącz lokalizację GPS lub wpisz kod pocztowy / miejscowość w Niemczech lub innym kraju.',
        });
      }

      const cacheKey = `food|${category}|${cleanLocation.toLowerCase()}|${
        hasCoords ? `${coordinates!.lat.toFixed(2)},${coordinates!.lng.toFixed(2)}` : ''
      }`;
      const cached = getCachedPayload<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const categoryDescriptions: Record<string, string> = {
        all: 'najlepsze i najwyżej oceniane restauracje (Döner Kebab, Pizza, kuchnia chińska/azjatycka i lokalna)',
        doner: 'najlepsze lokale z Döner Kebab / Gemüsekebab / Shawarma',
        pizza: 'najlepsze pizzerie i restauracje włoskie z pizzą',
        chinese: 'najlepsze restauracje chińskie i azjatyckie (China Restaurant / Asia Imbiss)',
        near_post:
          'najbliższą placówkę pocztową (np. Deutsche Post / DHL / lokalna poczta) w tej lokalizacji oraz najlepsze restauracje (kebab, pizza, chińskie, bistro) w pobliżu tej poczty',
      };

      const mapsApiKey = getValidMapsApiKey();

      if (mapsApiKey) {
        try {
          const countryMeta = resolveCountryMeta(cleanLocation, country);
          const placesLocationText = formatPlacesLocationQuery(cleanLocation, countryMeta);
          const biasCoords = hasCoords
            ? coordinates!
            : await resolvePostalBiasCoords(placesLocationText, countryMeta.regionCode, mapsApiKey);

          const textQueryByCategory: Record<string, string> = {
            all: 'Restaurant Döner Pizza',
            doner: 'Döner Kebab Imbiss',
            pizza: 'Pizzeria Pizza Restaurant',
            chinese: 'China Restaurant Asiatisch',
            near_post: 'Restaurant Post',
          };
          const queryTarget = placesLocationText
            ? `${textQueryByCategory[category] || 'Restaurant'} in ${placesLocationText}`
            : `${textQueryByCategory[category] || 'Restaurant'}`;

          const placesBody: any = {
            textQuery: queryTarget,
            includedType: 'restaurant',
            languageCode: 'pl',
            maxResultCount: 8,
          };
          if (countryMeta.regionCode) {
            placesBody.regionCode = countryMeta.regionCode;
          }
          if (biasCoords) {
            placesBody.locationBias = {
              circle: {
                center: {
                  latitude: biasCoords.lat,
                  longitude: biasCoords.lng,
                },
                radius: 4500,
              },
            };
          }

          const placesResp = await fetch(
            'https://places.googleapis.com/v1/places:searchText',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': mapsApiKey,
                'X-Goog-FieldMask':
                  'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours,places.googleMapsUri,places.primaryTypeDisplayName',
              },
              body: JSON.stringify(placesBody),
            }
          );

          if (placesResp.ok) {
            const placesJson = await placesResp.json();
            const rawPlaces = Array.isArray(placesJson?.places) ? placesJson.places : [];

            if (rawPlaces.length > 0) {
              const priceMap: Record<string, string> = {
                PRICE_LEVEL_INEXPENSIVE: '€',
                PRICE_LEVEL_MODERATE: '€€',
                PRICE_LEVEL_EXPENSIVE: '€€€',
                PRICE_LEVEL_VERY_EXPENSIVE: '€€€€',
              };
              const mappedResults = rawPlaces.map((p: any, idx: number) => {
                const comps = Array.isArray(p.addressComponents) ? p.addressComponents : [];
                const placeCountry =
                  comps.find((c: any) => Array.isArray(c.types) && c.types.includes('country'))
                    ?.shortText || '';
                const rawPostal =
                  comps.find(
                    (c: any) => Array.isArray(c.types) && c.types.includes('postal_code')
                  )?.longText || '';
                const postal =
                  placeCountry === 'DE' || isGerman
                    ? stripHyphensForCodeOnly(rawPostal)
                    : rawPostal;
                const city =
                  comps.find(
                    (c: any) => Array.isArray(c.types) && c.types.includes('locality')
                  )?.longText || cleanLocation || '';
                const name = p.displayName?.text || `Restauracja ${idx + 1}`;
                const formatted = String(p.formattedAddress || '');
                const typeLabel =
                  p.primaryTypeDisplayName?.text ||
                  (category === 'doner'
                    ? 'Döner / Kebab'
                    : category === 'pizza'
                      ? 'Pizza'
                      : category === 'chinese'
                        ? 'Kuchnia chińska'
                        : 'Restauracja');
                const openToday = p.regularOpeningHours?.weekdayDescriptions?.[0] || '';
                return {
                  id: p.id || `gplace_${idx}`,
                  name,
                  category:
                    category === 'doner' || category === 'pizza' || category === 'chinese'
                      ? category
                      : 'other',
                  categoryLabel: typeLabel,
                  address: formatted,
                  postalCode: postal,
                  city,
                  phone: p.internationalPhoneNumber || p.nationalPhoneNumber || null,
                  rating: typeof p.rating === 'number' ? p.rating : null,
                  reviewCount:
                    typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
                  priceLevel: priceMap[String(p.priceLevel || '')] || '€€',
                  openingHours: openToday,
                  nearPostNote:
                    category === 'near_post'
                      ? 'W pobliżu najbliższej placówki pocztowej'
                      : null,
                  highlight: `${typeLabel} w Google Maps`,
                  mapsUrl:
                    p.googleMapsUri ||
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${name} ${formatted}`
                    )}`,
                };
              });

              const links: ExtractedGroundingLink[] = mappedResults
                .slice(0, 8)
                .map((r: any) => ({
                  title: r.name,
                  url: r.mapsUrl,
                  source: 'maps' as const,
                }));

              const payload = {
                validGermany: true,
                resolvedLocation: cleanLocation || mappedResults[0]?.city || 'Lokalizacja GPS',
                postOffice: null,
                results: mappedResults,
                groundingLinks: links,
              };
              setCachedPayload(cacheKey, payload);
              return res.json(payload);
            }
          }
        } catch (placesErr) {
          console.warn('Server Google Places REST fallback to Gemini:', placesErr);
        }
      }

      const ai = getAiClient();
      const targetDesc = categoryDescriptions[category] || categoryDescriptions.all;
      const locLabel = cleanLocation
        ? `"${cleanLocation}"`
        : `współrzędnych GPS (${coordinates!.lat.toFixed(5)}, ${coordinates!.lng.toFixed(5)})`;

      const searchPrompt = `Sprawdź lokalizację lub kod pocztowy: ${locLabel}.
Obsługujesz dowolny kraj na świecie (w tym Niemcy, Polskę, Francję, Czechy, Austrię, Włochy, Holandię, Wielką Brytanię itd.).
${isGerman ? 'WAŻNE: Ta lokalizacja jest w Niemczech — niemiecki kod pocztowy podawaj ZAWSZE bez myślników (np. 10115).' : ''}
Znajdź w Google realne, istniejące w tej okolicy miejsca — konkretnie: ${targetDesc}.
Dla każdego miejsca podaj:
- dokładną nazwę lokalu
- pełny adres (ulica, numer, kod pocztowy, miasto, kraj)
- prawdziwy numer telefonu z numerem kierunkowym kraju (np. +49, +48, +43 itd.; nigdy nie zmyślaj numeru)
- ocenę w Google i liczbę opinii
- poziom cen (€, €€, €€€) oraz godziny otwarcia
- ${category === 'near_post' ? 'dokładną nazwę i adres najbliższej poczty oraz odległość pieszą lokalu od niej' : 'krótki opis specjalności lokalu'}
Podaj 5-6 realnych miejsc.`;

      const mapsQueryTarget = cleanLocation ? `in ${cleanLocation}` : 'nearby';
      const mapsPrompt = `Find top rated ${
        category === 'doner'
          ? 'Döner Kebab restaurants'
          : category === 'pizza'
            ? 'Pizza restaurants'
            : category === 'chinese'
              ? 'Chinese restaurants'
              : category === 'near_post'
                ? 'post office and restaurants nearby'
                : 'restaurants, pizza, kebab and local food'
      } ${mapsQueryTarget}. Include exact addresses, phone numbers if visible, and reviews.`;

      const mapsConfig: any = {
        tools: [{ googleMaps: {} }],
      };
      if (hasCoords) {
        mapsConfig.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: coordinates!.lat,
              longitude: coordinates!.lng,
            },
          },
        };
      }

      const [searchRes, mapsRes] = await Promise.allSettled([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: searchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: mapsPrompt,
          config: mapsConfig,
        }),
      ]);

      let searchText =
        searchRes.status === 'fulfilled' ? searchRes.value.text ?? '' : '';
      const mapsText =
        mapsRes.status === 'fulfilled' ? mapsRes.value.text ?? '' : '';

      const groundingLinks: ExtractedGroundingLink[] = [
        ...(mapsRes.status === 'fulfilled' ? extractGroundingLinks(mapsRes.value) : []),
        ...(searchRes.status === 'fulfilled' ? extractGroundingLinks(searchRes.value) : []),
      ];

      // If primary Gemini model hit rate limit/429, try gemini-3.1-flash-lite once before OSM fallback
      if (!searchText && !mapsText) {
        const primaryReason =
          (searchRes.status === 'rejected' && searchRes.reason) ||
          (mapsRes.status === 'rejected' && mapsRes.reason);
        if (isQuotaOrRateError(primaryReason)) {
          try {
            const liteRes = await ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: searchPrompt,
              config: {
                tools: [{ googleSearch: {} }],
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              },
            });
            searchText = liteRes.text ?? '';
            groundingLinks.push(...extractGroundingLinks(liteRes));
          } catch {
            // Fall through to Nominatim real-places lookup
          }
        }
      }

      if (!searchText && !mapsText) {
        const osmPayload = await searchFoodViaNominatim({
          cleanLocation,
          coordinates: hasCoords ? coordinates : undefined,
          category,
          isGerman,
          country,
        });
        if (osmPayload && osmPayload.results.length > 0) {
          setCachedPayload(cacheKey, osmPayload);
          return res.json(osmPayload);
        }

        const primaryReason =
          (searchRes.status === 'rejected' && searchRes.reason) ||
          (mapsRes.status === 'rejected' && mapsRes.reason) ||
          new Error('Nie udało się pobrać wyników z wyszukiwarki Google.');
        throw primaryReason;
      }

      try {
        const structureResponse = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `Przekształć poniższe dane na ustrukturyzowany obiekt JSON w języku polskim.

ZASADY:
1. Zawsze ustaw validGermany = true (obsługujemy wszystkie kraje świata po kodzie pocztowym lub nazwie).
2. Jeśli lokalizacja znajduje się w Niemczech, upewnij się, że pole "postalCode" NIE ma myślników (np. "10115").
3. Nigdy nie zmyślaj numerów telefonów (ustaw null jeśli brak). Zachowaj międzynarodowy prefiks kraju.
4. Jeśli kategoria to "near_post", wypełnij "postOffice".
5. Dla "mapsUrl" użyj pasującego linku Maps lub zbuduj https://www.google.com/maps/search/?api=1&query=<nazwa+adres>.

ZAPYTANIE: ${locLabel} (kategoria: ${category})

DANE Z GOOGLE SEARCH:
${searchText}

DANE Z GOOGLE MAPS:
${mapsText}

DOSTĘPNE LINKI MAPS:
${JSON.stringify(groundingLinks.filter((l) => l.source === 'maps').slice(0, 10))}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                validGermany: { type: Type.BOOLEAN },
                message: { type: Type.STRING, nullable: true },
                resolvedLocation: { type: Type.STRING },
                postOffice: {
                  type: Type.OBJECT,
                  nullable: true,
                  properties: {
                    name: { type: Type.STRING },
                    address: { type: Type.STRING },
                    postalCode: { type: Type.STRING },
                    city: { type: Type.STRING },
                    distanceNote: { type: Type.STRING },
                  },
                },
                results: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      name: { type: Type.STRING },
                      category: {
                        type: Type.STRING,
                        description: 'One of: doner, pizza, chinese, other',
                      },
                      categoryLabel: { type: Type.STRING },
                      address: { type: Type.STRING },
                      postalCode: { type: Type.STRING },
                      city: { type: Type.STRING },
                      phone: { type: Type.STRING, nullable: true },
                      rating: { type: Type.NUMBER, nullable: true },
                      reviewCount: { type: Type.INTEGER, nullable: true },
                      priceLevel: { type: Type.STRING },
                      openingHours: { type: Type.STRING },
                      nearPostNote: { type: Type.STRING, nullable: true },
                      highlight: { type: Type.STRING },
                      mapsUrl: { type: Type.STRING },
                    },
                  },
                },
              },
              required: ['validGermany', 'resolvedLocation', 'results'],
            },
          },
        });

        const parsed = JSON.parse((structureResponse.text ?? '{}').trim());
        const payload = {
          ...parsed,
          validGermany: true,
          groundingLinks: groundingLinks.slice(0, 12),
        };
        setCachedPayload(cacheKey, payload);
        res.json(payload);
      } catch (structureErr: any) {
        if (isQuotaOrRateError(structureErr)) {
          const osmPayload = await searchFoodViaNominatim({
            cleanLocation,
            coordinates: hasCoords ? coordinates : undefined,
            category,
            isGerman,
            country,
          });
          if (osmPayload && osmPayload.results.length > 0) {
            setCachedPayload(cacheKey, osmPayload);
            return res.json(osmPayload);
          }
        }
        throw structureErr;
      }
    } catch (error: any) {
      const friendly = formatFriendlyApiError(
        error,
        'Wystąpił błąd podczas wyszukiwania restauracji.'
      );
      if (friendly.status === 429) {
        console.warn('Food search rate-limited (429): returning friendly error.');
      } else {
        console.error('Food search error:', error);
      }
      res.status(friendly.status).json({ error: friendly.message });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Accommodation search globally by postal code / city (Germany hyphen-free)
  // ---------------------------------------------------------------------------
  app.post('/api/search/stays', async (req, res) => {
    try {
      const {
        location,
        country,
        stayType = 'all',
        checkIn,
        checkOut,
        guests = 2,
        coordinates,
      } = req.body as {
        location?: string;
        country?: string;
        stayType?: 'all' | 'hotel' | 'apartment' | 'budget';
        checkIn?: string;
        checkOut?: string;
        guests?: number;
        coordinates?: { lat: number; lng: number };
      };

      const rawCombined =
        country && location && !location.toLowerCase().includes(country.toLowerCase())
          ? `${location.trim()} ${country.trim()}`
          : location || '';
      const cleanLocation = sanitizeCodeTokensInQuery(rawCombined, country);
      const isGerman = detectGermanContext(rawCombined, country);
      const hasCoords =
        typeof coordinates?.lat === 'number' && typeof coordinates?.lng === 'number';

      if (!cleanLocation && !hasCoords) {
        return res.status(400).json({
          error: 'Podaj kod pocztowy / lokalizację lub włącz GPS.',
        });
      }

      const { checkIn: safeCheckIn, checkOut: safeCheckOut } = normalizeStayDates(
        checkIn,
        checkOut
      );
      const safeGuests = Math.max(1, Math.min(10, Number(guests) || 2));

      const cacheKey = `stays|${stayType}|${safeCheckIn}|${safeCheckOut}|${safeGuests}|${cleanLocation.toLowerCase()}|${
        hasCoords ? `${coordinates!.lat.toFixed(2)},${coordinates!.lng.toFixed(2)}` : ''
      }`;
      const cached = getCachedPayload<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      // Fast Google Places REST primary path (~250ms) when Maps API key is available
      const mapsApiKey = getValidMapsApiKey();
      if (mapsApiKey) {
        try {
          const countryMeta = resolveCountryMeta(cleanLocation, country);
          const placesLocationText = formatPlacesLocationQuery(cleanLocation, countryMeta);
          const biasCoords = hasCoords
            ? coordinates!
            : await resolvePostalBiasCoords(placesLocationText, countryMeta.regionCode, mapsApiKey);

          const staysQueryPrefix: Record<string, string> = {
            all: 'Hotel Apartment Pension Zimmer',
            hotel: 'Hotel',
            apartment: 'Apartment Ferienwohnung',
            budget: 'Hostel B&B Guest House Pension',
          };
          const placesBody: any = {
            textQuery: placesLocationText
              ? `${staysQueryPrefix[stayType] || 'Hotel Lodging'} in ${placesLocationText}`
              : staysQueryPrefix[stayType] || 'Hotel Lodging',
            includedType: 'lodging',
            languageCode: 'pl',
            maxResultCount: 6,
          };
          if (countryMeta.regionCode) {
            placesBody.regionCode = countryMeta.regionCode;
          }
          if (biasCoords) {
            placesBody.locationBias = {
              circle: {
                center: {
                  latitude: biasCoords.lat,
                  longitude: biasCoords.lng,
                },
                radius: 5000,
              },
            };
          }

          const placesResp = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': mapsApiKey,
              'X-Goog-FieldMask':
                'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.googleMapsUri,places.primaryTypeDisplayName',
            },
            body: JSON.stringify(placesBody),
          });
          if (placesResp.ok) {
            const pJson: any = await placesResp.json();
            const rawPlaces: any[] = Array.isArray(pJson?.places) ? pJson.places : [];
            if (rawPlaces.length > 0) {
              const mapped = rawPlaces.map((p, idx) => {
                const name = p?.displayName?.text || `Nocleg ${idx + 1}`;
                const formatted = p?.formattedAddress || '';
                const comps: any[] = Array.isArray(p?.addressComponents) ? p.addressComponents : [];
                const placeCountry =
                  comps.find((c) => c.types?.includes('country'))?.shortText || '';
                const rawPostal =
                  comps.find((c) => c.types?.includes('postal_code'))?.longText || '';
                const postal =
                  placeCountry === 'DE' || isGerman
                    ? stripHyphensForCodeOnly(rawPostal)
                    : rawPostal;
                const cityComp =
                  comps.find((c) => c.types?.includes('locality'))?.longText ||
                  cleanLocation ||
                  'Europe';
                const countryNameComp =
                  comps.find((c) => c.types?.includes('country'))?.longText ||
                  countryMeta.countryName ||
                  country ||
                  '';
                return {
                  id: p.id || `stay_${idx}`,
                  name,
                  stayType: stayType === 'all' ? 'hotel' : stayType,
                  stayTypeLabel: p?.primaryTypeDisplayName?.text || 'Hotel / Pokoje',
                  address: formatted,
                  postalCode: postal,
                  city: cityComp,
                  phone: p?.internationalPhoneNumber || p?.nationalPhoneNumber || null,
                  rating: typeof p?.rating === 'number' ? p.rating : null,
                  approxPriceEur: 'Sprawdź w portalu',
                  distanceInfo: 'W pobliżu',
                  highlight: `Wynajem pokoju na termin ${safeCheckIn} – ${safeCheckOut} (${safeGuests} os.).`,
                  bookingUrl: buildBookingUrl(
                    name,
                    cityComp,
                    safeCheckIn,
                    safeCheckOut,
                    safeGuests,
                    countryNameComp
                  ),
                  airbnbUrl: buildAirbnbUrl(
                    cityComp,
                    safeCheckIn,
                    safeCheckOut,
                    safeGuests,
                    countryNameComp
                  ),
                  hrsUrl: buildHrsUrl(
                    name,
                    cityComp,
                    safeCheckIn,
                    safeCheckOut,
                    safeGuests,
                    countryNameComp
                  ),
                  fewoUrl: buildFewoUrl(
                    cityComp,
                    safeCheckIn,
                    safeCheckOut,
                    safeGuests,
                    countryNameComp
                  ),
                  expediaUrl: buildExpediaUrl(
                    name,
                    cityComp,
                    safeCheckIn,
                    safeCheckOut,
                    safeGuests,
                    countryNameComp
                  ),
                  mapsUrl:
                    p?.googleMapsUri ||
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${name} ${formatted}`
                    )}`,
                };
              });
              const payload = {
                validGermany: true,
                resolvedLocation: cleanLocation || mapped[0]?.city || 'Lokalizacja GPS',
                results: mapped,
                groundingLinks: mapped.slice(0, 6).map((m) => ({
                  title: m.name,
                  url: m.mapsUrl,
                  source: 'maps' as const,
                })),
              };
              setCachedPayload(cacheKey, payload);
              return res.json(payload);
            }
          }
        } catch (placesErr) {
          console.warn('Stays Google Places REST fallback to Gemini:', placesErr);
        }
      }

      const ai = getAiClient();

      const stayTypeDesc: Record<string, string> = {
        all: 'najlepsze noclegi i pokoje do wynajęcia (hotele, apartamenty, pokoje gościnne Privatzimmer / Monteurzimmer / Ferienwohnung) dostępne na Booking.com, Airbnb, HRS, FeWo-direkt i Expedia',
        hotel: 'najlepsze hotele z rezerwacją pokoi (Booking.com, HRS, Expedia)',
        apartment: 'najlepsze apartamenty, pokoje i mieszkania wakacyjne (Airbnb, FeWo-direkt, Booking.com)',
        budget: 'dobre i przystępne cenowo pokoje do wynajęcia i noclegi budżetowe (hostele, B&B, pokoje, pensjonaty na Booking.com i Airbnb)',
      };

      const locLabel = cleanLocation
        ? `"${cleanLocation}"`
        : `współrzędnych GPS (${coordinates!.lat.toFixed(5)}, ${coordinates!.lng.toFixed(5)})`;

      const searchPrompt = `Sprawdź lokalizację lub kod pocztowy: ${locLabel}.
Termin pobytu: od ${safeCheckIn} do ${safeCheckOut} dla ${safeGuests} osób.
Obsługujesz dowolny kraj na świecie po kodzie pocztowym, mieście lub współrzędnych (Niemcy, Polska, Austria, Czechy, Francja, Włochy itd.).
${isGerman ? 'WAŻNE: Dla Niemiec podawaj kod pocztowy ZAWSZE bez myślników (np. 10115).' : ''}
Wyszukaj realne, istniejące obiekty oferujące wynajem pokoi i noclegów: ${stayTypeDesc[stayType] || stayTypeDesc.all}.
Dla 5-6 obiektów podaj:
- nazwę obiektu
- typ (hotel / apartment / budget)
- pełny adres wraz z kodem pocztowym, miastem i krajem
- prawdziwy numer telefonu z prefiksem kraju jeśli dostępny
- ocenę i orientacyjną cenę za pokój/noc w EUR w wybranym terminie
- odległość od centrum lub dworca
- krótki opis po polsku (np. rodzaj pokoju, meldunek, dostępność w Booking/Airbnb/HRS).`;

      const mapsPrompt = `Find top rated ${
        stayType === 'hotel'
          ? 'hotels and rooms'
          : stayType === 'apartment'
            ? 'holiday apartments, rooms and Airbnb-style stays'
            : stayType === 'budget'
              ? 'budget hotels, guest rooms and hostels'
              : 'hotels, guest rooms, apartments and accommodations'
      } ${cleanLocation ? `in ${cleanLocation}` : 'nearby'}.`;

      const mapsConfig: any = {
        tools: [{ googleMaps: {} }],
      };
      if (hasCoords) {
        mapsConfig.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: coordinates!.lat,
              longitude: coordinates!.lng,
            },
          },
        };
      }

      const [searchRes, mapsRes] = await Promise.allSettled([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: searchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: mapsPrompt,
          config: mapsConfig,
        }),
      ]);

      let searchText =
        searchRes.status === 'fulfilled' ? searchRes.value.text ?? '' : '';
      const mapsText =
        mapsRes.status === 'fulfilled' ? mapsRes.value.text ?? '' : '';

      const groundingLinks: ExtractedGroundingLink[] = [
        ...(mapsRes.status === 'fulfilled' ? extractGroundingLinks(mapsRes.value) : []),
        ...(searchRes.status === 'fulfilled' ? extractGroundingLinks(searchRes.value) : []),
      ];

      if (!searchText && !mapsText) {
        const primaryReason =
          (searchRes.status === 'rejected' && searchRes.reason) ||
          (mapsRes.status === 'rejected' && mapsRes.reason);
        if (isQuotaOrRateError(primaryReason)) {
          try {
            const liteRes = await ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: searchPrompt,
              config: {
                tools: [{ googleSearch: {} }],
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              },
            });
            searchText = liteRes.text ?? '';
            groundingLinks.push(...extractGroundingLinks(liteRes));
          } catch {
            // Fall through to Nominatim stays fallback
          }
        }
      }

      if (!searchText && !mapsText) {
        const osmStaysPayload = await searchStaysViaNominatim({
          cleanLocation,
          coordinates: hasCoords ? coordinates : undefined,
          stayType,
          safeCheckIn,
          safeCheckOut,
          safeGuests,
          isGerman,
          country,
        });
        if (osmStaysPayload && osmStaysPayload.results.length > 0) {
          setCachedPayload(cacheKey, osmStaysPayload);
          return res.json(osmStaysPayload);
        }

        const primaryReason =
          (searchRes.status === 'rejected' && searchRes.reason) ||
          (mapsRes.status === 'rejected' && mapsRes.reason) ||
          new Error('Nie udało się pobrać wyników noclegów.');
        throw primaryReason;
      }

      try {
        const structureResponse = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `Przekształć poniższe dane o noclegach i wynajmie pokoi na obiekt JSON w języku polskim.
Zawsze ustaw validGermany = true (obsługujemy dowolny kraj po kodzie pocztowym lub lokalizacji).
Jeśli lokalizacja jest w Niemczech, kod pocztowy w "postalCode" musi być bez myślników (np. 10115).
Nigdy nie wymyślaj numerów telefonów (ustaw null jeśli brak w źródle).

DANE Z GOOGLE SEARCH:
${searchText}

DANE Z GOOGLE MAPS:
${mapsText}

DOSTĘPNE LINKI MAPS:
${JSON.stringify(groundingLinks.filter((l) => l.source === 'maps').slice(0, 10))}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                validGermany: { type: Type.BOOLEAN },
                message: { type: Type.STRING, nullable: true },
                resolvedLocation: { type: Type.STRING },
                results: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      name: { type: Type.STRING },
                      stayType: {
                        type: Type.STRING,
                        description: 'One of: hotel, apartment, budget, other',
                      },
                      stayTypeLabel: { type: Type.STRING },
                      address: { type: Type.STRING },
                      postalCode: { type: Type.STRING },
                      city: { type: Type.STRING },
                      phone: { type: Type.STRING, nullable: true },
                      rating: { type: Type.NUMBER, nullable: true },
                      approxPriceEur: { type: Type.STRING },
                      distanceInfo: { type: Type.STRING },
                      highlight: { type: Type.STRING },
                      mapsUrl: { type: Type.STRING },
                    },
                  },
                },
              },
              required: ['validGermany', 'resolvedLocation', 'results'],
            },
          },
        });

        const parsed = JSON.parse((structureResponse.text ?? '{}').trim());
        const fallbackCountry =
          resolveCountryMeta(cleanLocation, country).countryName || country || '';
        const enrichedResults = (parsed.results || []).map((item: any) => {
          const targetCity = item.city || cleanLocation || 'Europe';
          return {
            ...item,
            bookingUrl: buildBookingUrl(
              item.name,
              targetCity,
              safeCheckIn,
              safeCheckOut,
              safeGuests,
              fallbackCountry
            ),
            airbnbUrl: buildAirbnbUrl(
              targetCity,
              safeCheckIn,
              safeCheckOut,
              safeGuests,
              fallbackCountry
            ),
            hrsUrl: buildHrsUrl(
              item.name,
              targetCity,
              safeCheckIn,
              safeCheckOut,
              safeGuests,
              fallbackCountry
            ),
            fewoUrl: buildFewoUrl(
              targetCity,
              safeCheckIn,
              safeCheckOut,
              safeGuests,
              fallbackCountry
            ),
            expediaUrl: buildExpediaUrl(
              item.name,
              targetCity,
              safeCheckIn,
              safeCheckOut,
              safeGuests,
              fallbackCountry
            ),
            mapsUrl:
              item.mapsUrl ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${item.name} ${item.address || cleanLocation}`
              )}`,
          };
        });

        const payload = {
          ...parsed,
          validGermany: true,
          results: enrichedResults,
          groundingLinks: groundingLinks.slice(0, 12),
        };
        setCachedPayload(cacheKey, payload);
        res.json(payload);
      } catch (structureErr: any) {
        if (isQuotaOrRateError(structureErr)) {
          const osmStaysPayload = await searchStaysViaNominatim({
            cleanLocation,
            coordinates: hasCoords ? coordinates : undefined,
            stayType,
            safeCheckIn,
            safeCheckOut,
            safeGuests,
            isGerman,
            country,
          });
          if (osmStaysPayload && osmStaysPayload.results.length > 0) {
            setCachedPayload(cacheKey, osmStaysPayload);
            return res.json(osmStaysPayload);
          }
        }
        throw structureErr;
      }
    } catch (error: any) {
      const friendly = formatFriendlyApiError(
        error,
        'Wystąpił błąd podczas wyszukiwania noclegów.'
      );
      if (friendly.status === 429) {
        console.warn('Stays search rate-limited (429): returning friendly error.');
      } else {
        console.error('Stays search error:', error);
      }
      res.status(friendly.status).json({ error: friendly.message });
    }
  });

  // ---------------------------------------------------------------------------
  // 2B. Automatic Stay Booking (UI or Voice Triggered)
  // ---------------------------------------------------------------------------
  app.post('/api/stays/auto-book', async (req, res) => {
    try {
      const {
        stay,
        location = '',
        country = '',
        checkIn = '',
        checkOut = '',
        guests = 2,
        guestName = 'Gość Miękiszon',
        guestEmail = 'Morfi28@gmx.de',
        coordinates,
        language = 'pl',
      } = req.body as {
        stay?: any;
        location?: string;
        country?: string;
        checkIn?: string;
        checkOut?: string;
        guests?: number;
        guestName?: string;
        guestEmail?: string;
        coordinates?: { lat: number; lng: number };
        language?: 'pl' | 'de';
      };

      const { checkIn: safeCheckIn, checkOut: safeCheckOut } = normalizeStayDates(
        checkIn,
        checkOut
      );
      const safeGuests = Math.max(1, Math.min(10, Number(guests) || 2));
      const rawCombined =
        country && location && !location.toLowerCase().includes(country.toLowerCase())
          ? `${location.trim()} ${country.trim()}`
          : location || '';
      const cleanLoc = sanitizeCodeTokensInQuery(rawCombined, country);

      let chosenStay = stay;

      if (!chosenStay) {
        const ai = getAiClient();
        const locDesc =
          cleanLoc ||
          (coordinates
            ? `GPS (${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)})`
            : 'Berlin');

        const grounded = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Find the best-rated available hotel, room or apartment near ${locDesc} for ${safeGuests} guests (${safeCheckIn} to ${safeCheckOut}). Return exact name, address, city, phone if available, and approximate price in EUR per night.`,
          config: {
            tools: [{ googleSearch: {} }, { googleMaps: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });

        const structured = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `Wyodrębnij 1 najlepszy obiekt noclegowy jako JSON:\n${grounded.text || ''}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                address: { type: Type.STRING },
                city: { type: Type.STRING },
                phone: { type: Type.STRING, nullable: true },
                approxPriceEur: { type: Type.STRING },
              },
              required: ['name', 'address', 'city', 'approxPriceEur'],
            },
          },
        });
        chosenStay = JSON.parse((structured.text ?? '{}').trim());
      }

      const city = chosenStay?.city || cleanLoc || 'Europe';
      const name = chosenStay?.name || 'Hotel';
      const address = chosenStay?.address || city;
      const bookingUrl = buildBookingUrl(name, city, safeCheckIn, safeCheckOut, safeGuests);
      const confirmationCode = `MIEK${Math.random()
        .toString(36)
        .substring(2, 7)
        .toUpperCase()}`;

      const booking = {
        id: `bk_${Date.now()}`,
        confirmationCode,
        stayName: name,
        address,
        city,
        phone: chosenStay?.phone || null,
        checkIn: safeCheckIn,
        checkOut: safeCheckOut,
        guests: safeGuests,
        guestName: guestName.trim() || 'Gość Miękiszon',
        guestEmail: guestEmail.trim() || 'Morfi28@gmx.de',
        approxPriceEur: chosenStay?.approxPriceEur || 'do potwierdzenia',
        status: 'confirmed' as const,
        bookingUrl,
        createdAt: new Date().toISOString(),
      };

      const summarySpeech =
        language === 'de'
          ? `Automatische Reservierung vorbereitet für ${booking.stayName} in ${booking.city} (${booking.checkIn} bis ${booking.checkOut}, Code ${booking.confirmationCode}). Du kannst die Buchung direkt auf Booking.com abschließen.`
          : `Przygotowano automatyczną rezerwację w obiekcie ${booking.stayName} (${booking.city}, termin ${booking.checkIn} – ${booking.checkOut}, kod ${booking.confirmationCode}). Możesz jednym kliknięciem dokończyć ją w Booking.com.`;

      res.json({ booking, summarySpeech });
    } catch (error: any) {
      console.error('Auto-book error:', error);
      res.status(500).json({
        error: error?.message || 'Nie udało się automatycznie zarezerwować noclegu.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Real-Time Transit (Trains, Buses, Car Routes) & Fuel Prices (International)
  // ---------------------------------------------------------------------------
  app.post('/api/search/transit', async (req, res) => {
    try {
      const {
        mode = 'trains',
        from = '',
        to = '',
        query = '',
        location = '',
        country = '',
        coordinates,
        language = 'pl',
      } = req.body as {
        mode?: 'trains' | 'sbahn' | 'buses' | 'fuel' | 'car';
        from?: string;
        to?: string;
        query?: string;
        location?: string;
        country?: string;
        coordinates?: { lat: number; lng: number };
        language?: 'pl' | 'de';
      };

      const fromPreserveDash =
        !detectGermanContext(from) && /^\d{2}-\d{3}\b/.test(from.trim());
      const cleanFrom = sanitizeCodeTokensInQuery(
        from,
        fromPreserveDash ? undefined : country
      );
      const cleanTo = sanitizeCodeTokensInQuery(to, country);
      const cleanQuery = sanitizeCodeTokensInQuery(query, country);
      const cleanLoc = sanitizeCodeTokensInQuery(location, country);
      const isGerman = detectGermanContext(`${from} ${to} ${query} ${location}`, country);

      const ai = getAiClient();
      const nowTime = new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Berlin',
      });
      const hasCoords =
        typeof coordinates?.lat === 'number' && typeof coordinates?.lng === 'number';
      const baseLoc =
        cleanFrom.trim() ||
        cleanLoc.trim() ||
        (hasCoords
          ? `GPS (${coordinates!.lat.toFixed(4)}, ${coordinates!.lng.toFixed(4)})`
          : 'Berlin');

      const cacheKey = `transit|${mode}|${language}|${(country || '').toLowerCase()}|${baseLoc.toLowerCase()}|${cleanTo.toLowerCase()}|${cleanQuery.toLowerCase()}`;
      const cached = getCachedPayload<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const mapsApiKey = getValidMapsApiKey();

      // Fast Google Routes API v2 primary path (~250ms) for car routes across any country
      if (mode === 'car' && mapsApiKey) {
        try {
          const fromMeta = resolveCountryMeta(cleanFrom || cleanLoc);
          const toMeta = resolveCountryMeta(cleanTo || cleanQuery, country);
          const originQuery = formatPlacesLocationQuery(cleanFrom || cleanLoc, fromMeta);
          const destRaw = cleanTo.trim() || cleanQuery.trim() || 'Berlin Zentrum';
          const destQuery = formatPlacesLocationQuery(destRaw, toMeta);

          const originPayload =
            hasCoords && !cleanFrom.trim() && !cleanLoc.trim()
              ? {
                  location: {
                    latLng: { latitude: coordinates!.lat, longitude: coordinates!.lng },
                  },
                }
              : { address: originQuery || baseLoc };

          const routesResp = await fetch(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': mapsApiKey,
                'X-Goog-FieldMask':
                  'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.localizedValues',
              },
              body: JSON.stringify({
                origin: originPayload,
                destination: { address: destQuery },
                travelMode: 'DRIVE',
                routingPreference: 'TRAFFIC_AWARE',
                computeAlternativeRoutes: true,
                languageCode: language === 'de' ? 'de' : 'pl',
              }),
            }
          );

          if (routesResp.ok) {
            const routesJson: any = await routesResp.json();
            const rawRoutes: any[] = Array.isArray(routesJson?.routes)
              ? routesJson.routes
              : [];
            if (rawRoutes.length > 0) {
              const originLabel = originQuery || baseLoc;
              const carRoutes = rawRoutes.slice(0, 3).map((r, idx) => {
                const distM = Number(r.distanceMeters || 0);
                const distText =
                  r.localizedValues?.distance?.text || `${Math.round(distM / 1000)} km`;
                const durSec = parseInt(String(r.duration || '0'), 10) || 0;
                const staticSec = parseInt(String(r.staticDuration || '0'), 10) || durSec;
                const delayMin = Math.max(0, Math.round((durSec - staticSec) / 60));
                const durText =
                  r.localizedValues?.duration?.text ||
                  `${Math.floor(durSec / 3600)} h ${Math.round((durSec % 3600) / 60)} min`;
                const highway = r.description || (language === 'de' ? 'Hauptroute' : 'Trasa główna');
                const estFuelEur = Math.max(2, Math.round((distM / 100000) * 7 * 1.75));
                const trafficNote =
                  delayMin > 3
                    ? language === 'de'
                      ? `+${delayMin} Min. Verzögerung`
                      : `+${delayMin} min opóźnienia w ruchu`
                    : language === 'de'
                      ? 'Fließender Verkehr'
                      : 'Ruch płynny';

                return {
                  id: `car_${idx + 1}`,
                  routeName:
                    language === 'de'
                      ? `Route ${idx + 1} (${highway})`
                      : `Trasa ${idx + 1} (${highway})`,
                  distanceKm: distText,
                  durationText: durText,
                  highways: highway,
                  trafficNote,
                  estimatedFuelCostEur: `~${estFuelEur} EUR`,
                  stepsSummary: `${originLabel} → ${destQuery}`,
                  directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                    originLabel
                  )}&destination=${encodeURIComponent(destQuery)}&travelmode=driving`,
                };
              });

              const primary = carRoutes[0];
              const summarySpeech =
                language === 'de'
                  ? `Autoroute von ${originLabel} nach ${destQuery}: ${primary.distanceKm}, Fahrzeit ${primary.durationText} über ${primary.highways}.`
                  : `Trasa samochodowa z ${originLabel} do ${destQuery}: ${primary.distanceKm}, czas jazdy ${primary.durationText} przez ${primary.highways}.`;

              const payload = {
                validGermany: true,
                resolvedQuery: `${originLabel} → ${destQuery}`,
                summarySpeech,
                connections: [],
                fuelStations: [],
                carRoutes,
                mode,
                groundingLinks: [
                  {
                    title: `Google Maps: ${originLabel} → ${destQuery}`,
                    url: primary.directionsUrl,
                    source: 'maps' as const,
                  },
                ],
              };
              setCachedPayload(cacheKey, payload, 120_000);
              return res.json(payload);
            }
          }
        } catch (routesErr) {
          console.warn('Google Routes API fallback to Gemini:', routesErr);
        }
      }

      let searchPrompt = '';
      if (mode === 'fuel') {
        searchPrompt = `Aktualna data i godzina: ${nowTime}.
Znajdź AKTUALNE ceny paliw (Diesel, E5 / Benzyna 95, E10 w lokalnej walucie lub EUR za litr) na stacjach paliw w pobliżu lokalizacji lub kodu pocztowego: "${
          cleanQuery.trim() || baseLoc
        }" ${country ? `(${country})` : ''}.
${isGerman ? 'Dla Niemiec niemiecki kod pocztowy zapisz bez myślników (np. 10115).' : ''}
Podaj 5-6 najbliższych realnych stacji benzynowych (np. Aral, Shell, Orlen, BP, Circle K, TotalEnergies, JET) z dokładnym adresem i cenami paliw.`;
      } else if (mode === 'car') {
        const dest = cleanTo.trim() || cleanQuery.trim() || 'Berlin Zentrum';
        searchPrompt = `Aktualna data i godzina: ${nowTime}.
Wyznacz najlepsze trasy JAZDY SAMOCHODEM z "${baseLoc}" do "${dest}" ${country ? `(${country})` : ''} (obsługujesz trasy krajowe i międzynarodowe między kodami pocztowymi i miastami).
Podaj realny dystans w km, szacowany czas jazdy samochodem, główne drogi/autostrady, informacje o natężeniu ruchu, szacowany koszt paliwa oraz krótki opis trasy.`;
      } else if (mode === 'sbahn') {
        searchPrompt = `Aktualna data i godzina: ${nowTime}.
Znajdź aktualny rozkład jazdy S-Bahn (kolej miejska / podmiejska S-Bahn, tzw. esbany, np. linie S1, S2, S3, S5, S7, S8, S41/S42 Ringbahn w Berlinie, S-Bahn München, Hamburg, Rhein-Main, Stuttgart, SKM itp.) dla zapytania: "${
          cleanQuery.trim() ||
          (cleanTo.trim()
            ? `z ${baseLoc} do ${cleanTo.trim()}`
            : `stacje i najbliższe odjazdy S-Bahn w ${baseLoc}`)
        }".
Podaj konkretne numery linii S-Bahn, stacje początkowe/docelowe, godziny odjazdów i przyjazdów, częstotliwość kursowania (Takt), ewentualne utrudnienia i przybliżone strefy biletowe.`;
      } else if (mode === 'buses') {
        searchPrompt = `Aktualna data i godzina: ${nowTime}.
Znajdź aktualny rozkład jazdy autobusów i połączeń autobusowych (FlixBus, komunikacja miejska i dalekobieżna w wybranym kraju) dla zapytania: "${
          cleanQuery.trim() ||
          (cleanTo.trim() ? `z ${baseLoc} do ${cleanTo.trim()}` : `przystanki i odjazdy autobusów w ${baseLoc}`)
        }".
Podaj konkretne najbliższe odjazdy, numery linii/przewoźnika, czasy odjazdu i przyjazdu, czas podróży, ewentualne opóźnienia i ceny.`;
      } else {
        searchPrompt = `Aktualna data i godzina: ${nowTime}.
Znajdź aktualny rozkład jazdy pociągów (Deutsche Bahn, PKP Intercity, ÖBB, SNCF, ČD lub lokalny przewoźnik dla podanego kodu pocztowego/miasta) dla zapytania: "${
          cleanQuery.trim() ||
          (cleanTo.trim() ? `z ${baseLoc} do ${cleanTo.trim()}` : `odjazdy pociągów ze stacji w pobliżu ${baseLoc}`)
        }".
Podaj konkretne najbliższe pociągi, numery połączeń, godziny odjazdu i przyjazdu, czas przejazdu, status punktualności i przybliżone ceny biletów.`;
      }

      const mapsConfig: any = {
        tools: [{ googleMaps: {} }],
      };
      if (hasCoords) {
        mapsConfig.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: coordinates!.lat,
              longitude: coordinates!.lng,
            },
          },
        };
      }

      const [searchRes, mapsRes] = await Promise.allSettled([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: searchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents:
            mode === 'fuel'
              ? `Find gas stations and current fuel prices near ${baseLoc}.`
              : mode === 'car'
                ? `Find driving route and highways from ${baseLoc} to ${cleanTo.trim() || cleanQuery.trim() || 'Berlin'}.`
                : mode === 'sbahn'
                  ? `Find S-Bahn stations and suburban rail lines near ${baseLoc}.`
                  : `Find main ${mode === 'buses' ? 'bus stations' : 'train stations'} near ${baseLoc}.`,
          config: mapsConfig,
        }),
      ]);

      let searchText =
        searchRes.status === 'fulfilled' ? searchRes.value.text ?? '' : '';
      const mapsText =
        mapsRes.status === 'fulfilled' ? mapsRes.value.text ?? '' : '';

      const groundingLinks: ExtractedGroundingLink[] = [
        ...(searchRes.status === 'fulfilled' ? extractGroundingLinks(searchRes.value) : []),
        ...(mapsRes.status === 'fulfilled' ? extractGroundingLinks(mapsRes.value) : []),
      ];

      // Retry with gemini-3.1-flash-lite if primary model hit 429 before open-source fallback
      if (!searchText && !mapsText) {
        const primaryReason =
          (searchRes.status === 'rejected' && searchRes.reason) ||
          (mapsRes.status === 'rejected' && mapsRes.reason);
        if (isQuotaOrRateError(primaryReason)) {
          try {
            const liteRes = await ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: searchPrompt,
              config: {
                tools: [{ googleSearch: {} }],
                thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              },
            });
            searchText = liteRes.text ?? '';
            groundingLinks.push(...extractGroundingLinks(liteRes));
          } catch {
            // Fall through to Google Places / OSRM / Nominatim
          }
        }
      }

      // If Gemini grounded search hit quota/failed for fuel/trains/sbahn/buses, fall back to Google Places REST
      if (!searchText && !mapsText && mapsApiKey) {
        try {
          const targetRaw =
            mode === 'fuel'
              ? cleanQuery.trim() || cleanLoc.trim() || baseLoc
              : cleanLoc.trim() || baseLoc;
          const tMeta = resolveCountryMeta(targetRaw, country);
          const placesLocText = formatPlacesLocationQuery(targetRaw, tMeta);
          const biasCoords = hasCoords
            ? coordinates!
            : await resolvePostalBiasCoords(placesLocText, tMeta.regionCode, mapsApiKey);

          const includedType =
            mode === 'fuel'
              ? 'gas_station'
              : mode === 'buses'
                ? 'bus_station'
                : mode === 'sbahn'
                  ? undefined
                  : 'train_station';

          const runPlacesSearch = async (useType?: string, useFuelMask = true) => {
            const pBody: any = {
              textQuery: `${
                mode === 'fuel'
                  ? 'Tankstelle gas station stacja paliw'
                  : mode === 'buses'
                    ? 'Bus station Dworzec autobusowy'
                    : mode === 'sbahn'
                      ? 'S-Bahn Bahnhof Station'
                      : 'Train station Bahnhof Dworzec kolejowy'
              } ${placesLocText ? `in ${placesLocText}` : ''}`.trim(),
              languageCode: language === 'de' ? 'de' : 'pl',
              maxResultCount: 6,
            };
            if (useType) pBody.includedType = useType;
            if (tMeta.regionCode) pBody.regionCode = tMeta.regionCode;
            if (biasCoords) {
              pBody.locationBias = {
                circle: {
                  center: { latitude: biasCoords.lat, longitude: biasCoords.lng },
                  radius: 12000,
                },
              };
            }
            const fieldMask = useFuelMask
              ? 'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.fuelOptions,places.regularOpeningHours'
              : 'places.id,places.displayName,places.formattedAddress,places.googleMapsUri';
            return fetch('https://places.googleapis.com/v1/places:searchText', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': mapsApiKey,
                'X-Goog-FieldMask': fieldMask,
              },
              body: JSON.stringify(pBody),
            });
          };

          let pResp = await runPlacesSearch(includedType, mode === 'fuel');
          let pJson: any = pResp.ok ? await pResp.json() : null;
          let rawPlaces: any[] = Array.isArray(pJson?.places) ? pJson.places : [];

          if (!pResp.ok || rawPlaces.length === 0) {
            pResp = await runPlacesSearch(undefined, false);
            if (pResp.ok) {
              pJson = await pResp.json();
              rawPlaces = Array.isArray(pJson?.places) ? pJson.places : [];
            }
          }

          if (rawPlaces.length > 0) {
            if (mode === 'fuel') {
              const fuelStations = rawPlaces.map((p, idx) => {
                const name = p?.displayName?.text || `Stacja paliw ${idx + 1}`;
                const formatted = p?.formattedAddress || '';
                const fuelPrices: any[] = Array.isArray(p?.fuelOptions?.fuelPrices)
                  ? p.fuelOptions.fuelPrices
                  : [];
                const findFuel = (typeKey: string) => {
                  const hit = fuelPrices.find((fp) => fp?.type === typeKey);
                  if (!hit?.price?.units) return null;
                  const val =
                    Number(hit.price.units || 0) + Number(hit.price.nanos || 0) / 1e9;
                  return `${val.toFixed(2)} ${hit.price.currencyCode || 'EUR'}`;
                };
                return {
                  id: p.id || `fuel_${idx + 1}`,
                  brand: name.split(' ')[0] || 'Stacja',
                  stationName: name,
                  address: formatted,
                  distanceInfo: 'W pobliżu',
                  dieselEur: findFuel('DIESEL'),
                  e5Eur: findFuel('REGULAR_UNLEADED') || findFuel('SP95'),
                  e10Eur: findFuel('E10') || findFuel('SP95_E10'),
                  updatedNote:
                    fuelPrices.length > 0
                      ? 'Dane Google Maps'
                      : language === 'de'
                        ? 'Aktuelle Preise in Google Maps prüfen'
                        : 'Sprawdź aktualną cenę na mapie',
                  mapsUrl:
                    p?.googleMapsUri ||
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${name} ${formatted}`
                    )}`,
                };
              });

              const payload = {
                validGermany: true,
                resolvedQuery: placesLocText || baseLoc,
                summarySpeech:
                  language === 'de'
                    ? `Ich habe ${fuelStations.length} Tankstellen in der Nähe von ${placesLocText || baseLoc} gefunden.`
                    : `Znalazłem ${fuelStations.length} stacji paliw w pobliżu ${placesLocText || baseLoc}.`,
                connections: [],
                fuelStations,
                carRoutes: [],
                mode,
                groundingLinks: fuelStations.map((s) => ({
                  title: s.stationName,
                  url: s.mapsUrl,
                  source: 'maps' as const,
                })),
              };
              setCachedPayload(cacheKey, payload, 120_000);
              return res.json(payload);
            }

            if (mode === 'trains' || mode === 'sbahn' || mode === 'buses') {
              const destText = cleanTo.trim()
                ? formatPlacesLocationQuery(cleanTo.trim(), resolveCountryMeta(cleanTo, country))
                : '';
              const connections = rawPlaces.slice(0, 4).map((p, idx) => {
                const stationName = p?.displayName?.text || `Stacja ${idx + 1}`;
                const formatted = p?.formattedAddress || '';
                const transitUrl = destText
                  ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                      stationName + (formatted ? ` ${formatted}` : '')
                    )}&destination=${encodeURIComponent(destText)}&travelmode=transit`
                  : p?.googleMapsUri ||
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${stationName} ${formatted}`
                    )}`;
                return {
                  id: p.id || `tr_${idx + 1}`,
                  operator:
                    mode === 'sbahn'
                      ? 'S-Bahn'
                      : mode === 'buses'
                        ? 'FlixBus / Komunikacja'
                        : tMeta.regionCode === 'PL'
                          ? 'PKP / Kolej'
                          : 'Deutsche Bahn / Kolej',
                  lineOrTrain: stationName,
                  departure: formatted,
                  arrival: destText || (language === 'de' ? 'Fahrplan öffnen' : 'Sprawdź rozkład'),
                  duration: language === 'de' ? 'Live in Google Maps' : 'Na żywo w Google Maps',
                  statusNote:
                    language === 'de'
                      ? 'Aktuelle Abfahrten im Fahrplan'
                      : 'Aktualne odjazdy w rozkładzie',
                  priceInfo: language === 'de' ? 'Siehe Portal' : 'Wg taryfy',
                  details: `${stationName} (${formatted})`,
                  bookingOrScheduleUrl: transitUrl,
                };
              });

              const payload = {
                validGermany: true,
                resolvedQuery: destText ? `${placesLocText} → ${destText}` : placesLocText,
                summarySpeech:
                  language === 'de'
                    ? `Ich habe ${connections.length} ${mode === 'sbahn' ? 'S-Bahn-Stationen' : 'Stationen'} und Verbindungen für ${placesLocText} gefunden.`
                    : `Znalazłem ${connections.length} ${mode === 'sbahn' ? 'stacji S-Bahn' : 'stacji'} i połączeń dla ${placesLocText}.`,
                connections,
                fuelStations: [],
                carRoutes: [],
                mode,
                groundingLinks: connections.map((c) => ({
                  title: c.lineOrTrain,
                  url: c.bookingOrScheduleUrl,
                  source: 'maps' as const,
                })),
              };
              setCachedPayload(cacheKey, payload, 120_000);
              return res.json(payload);
            }
          }
        } catch (placesErr) {
          console.warn('Transit Places REST fallback failed:', placesErr);
        }
      }

      if (!searchText && !mapsText) {
        const openPayload = await searchTransitViaOpenSources({
          mode,
          baseLoc,
          cleanTo,
          cleanQuery,
          country,
          coordinates: hasCoords ? coordinates : undefined,
          language,
        });
        setCachedPayload(cacheKey, openPayload, 120_000);
        return res.json(openPayload);
      }

      const langLabel = language === 'de' ? 'niemieckim (Deutsch)' : 'polskim';
      try {
        const structureResponse = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `Przekształć poniższe dane o ${
            mode === 'fuel'
              ? 'cenach paliw'
              : mode === 'car'
                ? 'trasie jazdy samochodem'
                : mode === 'sbahn'
                  ? 'rozkładzie S-Bahn'
                  : mode === 'buses'
                    ? 'rozkładzie autobusów'
                    : 'rozkładzie pociągów'
          } na JSON w języku ${langLabel}.

ZAPYTANIE UŻYTKOWNIKA: ${baseLoc}${cleanTo ? ` -> ${cleanTo}` : ''}${cleanQuery ? ` (${cleanQuery})` : ''}

ZASADY:
- Zawsze ustaw validGermany = true (obsługujemy wszystkie kraje i kody pocztowe).
- Jeśli trasa/stacja dotyczy Niemiec, niemieckie kody pocztowe podawaj bez myślników.
- W polu "summarySpeech" napisz 1-2 zwięzłe zdania w języku ${langLabel} podsumowujące najważniejsze ceny, najbliższe odjazdy lub trasę samochodową do odczytania na głos.
- Jeśli mode === "fuel", wypełnij tablicę "fuelStations" i zostaw "connections" oraz "carRoutes" puste [].
- Jeśli mode === "car", wypełnij tablicę "carRoutes" (1-3 warianty trasy samochodowej: routeName, distanceKm, durationText, highways, trafficNote, estimatedFuelCostEur, stepsSummary, directionsUrl w formacie Google Maps https://www.google.com/maps/dir/?api=1&origin=...&destination=...&travelmode=driving) i zostaw "connections" oraz "fuelStations" puste [].
- Jeśli mode === "trains", "sbahn" lub "buses", wypełnij "connections" i zostaw "fuelStations" oraz "carRoutes" puste [].
- Dla linków "bookingOrScheduleUrl" użyj pasującego linku ze źródeł (np. sbahn.berlin, bahn.de, intercity.pl, flixbus.com).

DANE Z WYSZUKIWARKI:
${searchText}

DANE Z MAP:
${mapsText}

LINKI:
${JSON.stringify(groundingLinks.slice(0, 10))}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                validGermany: { type: Type.BOOLEAN },
                message: { type: Type.STRING, nullable: true },
                resolvedQuery: { type: Type.STRING },
                summarySpeech: { type: Type.STRING },
                connections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      operator: { type: Type.STRING },
                      lineOrTrain: { type: Type.STRING },
                      departure: { type: Type.STRING },
                      arrival: { type: Type.STRING },
                      duration: { type: Type.STRING },
                      statusNote: { type: Type.STRING },
                      priceInfo: { type: Type.STRING },
                      details: { type: Type.STRING },
                      bookingOrScheduleUrl: { type: Type.STRING },
                    },
                  },
                },
                fuelStations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      brand: { type: Type.STRING },
                      stationName: { type: Type.STRING },
                      address: { type: Type.STRING },
                      distanceInfo: { type: Type.STRING },
                      dieselEur: { type: Type.STRING, nullable: true },
                      e5Eur: { type: Type.STRING, nullable: true },
                      e10Eur: { type: Type.STRING, nullable: true },
                      updatedNote: { type: Type.STRING },
                      mapsUrl: { type: Type.STRING },
                    },
                  },
                },
                carRoutes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      routeName: { type: Type.STRING },
                      distanceKm: { type: Type.STRING },
                      durationText: { type: Type.STRING },
                      highways: { type: Type.STRING },
                      trafficNote: { type: Type.STRING },
                      estimatedFuelCostEur: { type: Type.STRING },
                      stepsSummary: { type: Type.STRING },
                      directionsUrl: { type: Type.STRING },
                    },
                  },
                },
              },
              required: [
                'validGermany',
                'resolvedQuery',
                'summarySpeech',
                'connections',
                'fuelStations',
                'carRoutes',
              ],
            },
          },
        });

        const parsed = JSON.parse((structureResponse.text ?? '{}').trim());
        const normalizedCarRoutes = (Array.isArray(parsed.carRoutes) ? parsed.carRoutes : []).map(
          (r: any, idx: number) => ({
            ...r,
            id: r?.id || `car_${idx + 1}`,
            directionsUrl:
              r?.directionsUrl && /^https?:\/\//i.test(r.directionsUrl)
                ? r.directionsUrl
                : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                    baseLoc
                  )}&destination=${encodeURIComponent(cleanTo.trim() || cleanQuery.trim() || 'Berlin')}&travelmode=driving`,
          })
        );

        const payload = {
          ...parsed,
          validGermany: true,
          carRoutes: normalizedCarRoutes,
          mode,
          groundingLinks: groundingLinks.slice(0, 12),
        };
        setCachedPayload(cacheKey, payload, 120_000);
        res.json(payload);
      } catch (structureErr: any) {
        if (isQuotaOrRateError(structureErr)) {
          const openPayload = await searchTransitViaOpenSources({
            mode,
            baseLoc,
            cleanTo,
            cleanQuery,
            country,
            coordinates: hasCoords ? coordinates : undefined,
            language,
          });
          setCachedPayload(cacheKey, openPayload, 120_000);
          return res.json(openPayload);
        }
        throw structureErr;
      }
    } catch (error: any) {
      const friendly = formatFriendlyApiError(
        error,
        'Nie udało się pobrać rozkładu przejazdów lub cen paliw.'
      );
      if (friendly.status === 429) {
        console.warn('Transit search rate-limited (429): returning friendly error.');
      } else {
        console.error('Transit search error:', error);
      }
      res.status(friendly.status).json({ error: friendly.message });
    }
  });

  // ---------------------------------------------------------------------------
  // 3B. General Web & Places Search (googleSearch + googleMaps Grounding)
  // ---------------------------------------------------------------------------
  app.post('/api/search/web', async (req, res) => {
    try {
      const {
        query,
        location = '',
        coordinates,
        language = 'pl',
        codeOnly = false,
      } = req.body as {
        query: string;
        location?: string;
        coordinates?: { lat: number; lng: number };
        language?: 'pl' | 'de';
        codeOnly?: boolean;
      };

      const normalizedQuery = codeOnly
        ? stripHyphensForCodeOnly(query || '')
        : sanitizeCodeTokensInQuery(query || '');

      if (!normalizedQuery) {
        return res.status(400).json({ error: 'Brak zapytania lub kodu bez myślników do wyszukania.' });
      }

      const cleanLoc = sanitizeCodeTokensInQuery(location.trim());
      const cacheKey = `web|${language}|${codeOnly ? 'code' : 'std'}|${normalizedQuery.toLowerCase()}|${cleanLoc.toLowerCase()}`;
      const cached = getCachedPayload<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const ai = getAiClient();
      const isGerman = detectGermanContext(`${normalizedQuery} ${cleanLoc}`);
      const locationContext = cleanLoc
        ? `W kontekście lokalizacji: "${cleanLoc}"${isGerman ? ' (Niemcy — kod pocztowy bez myślników)' : ''}.`
        : coordinates
          ? `W kontekście aktualnych współrzędnych GPS użytkownika (${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}).`
          : 'Kontekst: zapytanie międzynarodowe / internetowe.';

      const groundingConfig: Record<string, any> = {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ googleSearch: {} }, { googleMaps: {} }],
      };

      if (coordinates?.lat && coordinates?.lng) {
        groundingConfig.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: coordinates.lat,
              longitude: coordinates.lng,
            },
          },
        };
      }

      const codePromptAddon = codeOnly
        ? `\nUWAGA — WYSZUKIWANIE KODU WYŁĄCZNIE BEZ MYŚLNIKÓW: "${normalizedQuery}". Sprawdź czy to kod pocztowy (np. niemiecki PLZ bez myślników lub polski/międzynarodowy), kod produktu/EAN, kod błędu, kod paczki lub identyfikator i podaj dokładne informacje, lokalizację oraz bezpośrednie linki.`
        : '';

      const groundedResponse = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Użytkownik szuka w przeglądarce / internecie / okolicy: "${normalizedQuery}".
${locationContext}${codePromptAddon}

Wyszukaj prawdziwe artykuły prasowe, poradniki, wiadomości, opracowania, strony www ORAZ (jeśli zapytanie dotyczy lokalizacji) miejsca stacjonarne dopasowane dokładnie do zapytania.
Podaj tytuły artykułów/stron, krótkie streszczenia merytoryczne, domeny, bezpośrednie adresy URL (https://...) oraz — dla miejsc — adresy, telefony i linki Google Maps. Odpowiedz konkretnie w języku ${language === 'de' ? 'niemieckim (Deutsch)' : 'polskim'}.`,
        config: groundingConfig,
      });

      const groundingLinks = extractGroundingLinks(groundedResponse);
      const rawText = groundedResponse.text || '';

      const langLabel = language === 'de' ? 'niemieckim (Deutsch)' : 'polsku';
      const structureResponse = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: `Na podstawie poniższych wyników wyszukiwania w Google i Google Maps przygotuj czysty JSON w języku ${langLabel}.
Zapytanie użytkownika: "${normalizedQuery}"

Tekst z wyszukiwarki:
${rawText}

Powiązane źródła (linki):
${JSON.stringify(groundingLinks)}

Zasady:
- Zwróć maksymalnie 6 najbardziej trafnych wyników w tablicy "results".
- Jeśli wynik to artykuł, wiadomość, wpis lub poradnik, ustaw kind: "article", wpisz tytuł artykułu w "title", krótkie streszczenie kluczowych faktów w "summary" (2-3 zdania) oraz prawdziwy klikalny "websiteUrl" (https://...).
- Jeśli zapytanie dotyczy miejsca (np. bawialnia, park, sklep stacjonarny), ustaw kind: "place", podaj address, mapsUrl oraz directionsUrl.
- Jeśli zapytanie dotyczy strony głównej lub sklepu online, ustaw kind: "website" lub "product" i podaj prawdziwy "websiteUrl".
- Ustaw "primaryRedirectUrl" na najlepszy bezpośredni adres strony/artykułu (https://...) z wyników lub źródeł (albo null jeśli brak).
- W polu "answerSummary" napisz krótkie, pomocne podsumowanie znalezionych artykułów lub miejsc w języku ${langLabel} (2 zdania), gotowe do przeczytania na głos.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING },
              answerSummary: { type: Type.STRING },
              primaryRedirectUrl: { type: Type.STRING, nullable: true },
              results: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    kind: { type: Type.STRING },
                    categoryLabel: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    address: { type: Type.STRING, nullable: true },
                    phone: { type: Type.STRING, nullable: true },
                    websiteUrl: { type: Type.STRING },
                    mapsUrl: { type: Type.STRING, nullable: true },
                    directionsUrl: { type: Type.STRING, nullable: true },
                  },
                },
              },
            },
            required: ['query', 'answerSummary', 'results'],
          },
        },
      });

      const parsed = JSON.parse((structureResponse.text ?? '{}').trim());
      const normalizedResults = (Array.isArray(parsed.results) ? parsed.results : []).map(
        (item: any, idx: number) => {
          const cleanAddress = item?.address || null;
          const fallbackMaps = cleanAddress
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${item.title || ''} ${cleanAddress}`.trim()
              )}`
            : null;
          const fallbackDirs = cleanAddress
            ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cleanAddress)}`
            : null;
          const fallbackWeb =
            item?.websiteUrl && /^https?:\/\//i.test(item.websiteUrl)
              ? item.websiteUrl
              : groundingLinks.find((l) => l.source === 'web')?.url ||
                `https://www.google.com/search?q=${encodeURIComponent(
                  item?.title || query.trim()
                )}`;

          return {
            id: item?.id || `web_${idx + 1}`,
            title: item?.title || 'Wynik wyszukiwania',
            kind:
              item?.kind === 'place' || item?.kind === 'product' || item?.kind === 'article'
                ? item.kind
                : 'website',
            categoryLabel: item?.categoryLabel || 'Wynik z internetu',
            summary: item?.summary || '',
            address: cleanAddress,
            phone: item?.phone || null,
            websiteUrl: fallbackWeb,
            mapsUrl: item?.mapsUrl || fallbackMaps,
            directionsUrl: item?.directionsUrl || fallbackDirs,
          };
        }
      );

      const primaryUrl =
        parsed.primaryRedirectUrl && /^https?:\/\//i.test(parsed.primaryRedirectUrl)
          ? parsed.primaryRedirectUrl
          : normalizedResults[0]?.websiteUrl || null;

      const webPayload = {
        query: parsed.query ? (codeOnly ? stripHyphensForCodeOnly(parsed.query) : sanitizeCodeTokensInQuery(parsed.query)) : normalizedQuery,
        answerSummary:
          parsed.answerSummary || 'Znalazłem pasujące wyniki w internecie.',
        primaryRedirectUrl: primaryUrl,
        results: normalizedResults,
        groundingLinks: groundingLinks.slice(0, 10),
      };
      setCachedPayload(cacheKey, webPayload, 180_000);
      res.json(webPayload);
    } catch (error: any) {
      const normalizedQuery =
        req.body?.codeOnly
          ? stripHyphensForCodeOnly(req.body?.query || '')
          : sanitizeCodeTokensInQuery(req.body?.query || '');
      const isQuota =
        String(error?.message || '').includes('429') ||
        String(error?.message || '').includes('RESOURCE_EXHAUSTED');
      if (isQuota && normalizedQuery) {
        const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(normalizedQuery)}`;
        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalizedQuery)}`;
        const isDe = req.body?.language === 'de';
        return res.json({
          query: normalizedQuery,
          answerSummary: isDe
            ? `Direktsuche für Code/Anfrage „${normalizedQuery}” (ohne Bindestriche) vorbereitet.`
            : `Przygotowano bezpośrednie wyszukiwanie dla kodu/zapytania „${normalizedQuery}” (bez myślników).`,
          primaryRedirectUrl: googleSearchUrl,
          results: [
            {
              id: 'fallback_web_1',
              title: `${normalizedQuery} — Google`,
              kind: 'website',
              categoryLabel: req.body?.codeOnly
                ? isDe
                  ? 'Code-Suche (ohne Bindestriche)'
                  : 'Kod bez myślników'
                : 'Google',
              summary: isDe
                ? 'Direktabfrage in Google und Google Maps öffnen.'
                : 'Otwórz bezpośrednie wyniki wyszukiwania w Google oraz Google Maps.',
              address: null,
              phone: null,
              websiteUrl: googleSearchUrl,
              mapsUrl: googleMapsUrl,
              directionsUrl: null,
            },
          ],
          groundingLinks: [
            { title: `Google: ${normalizedQuery}`, url: googleSearchUrl, source: 'web' },
            { title: `Google Maps: ${normalizedQuery}`, url: googleMapsUrl, source: 'maps' },
          ],
        });
      }
      console.error('Web search error:', error);
      res.status(500).json({
        error: isQuota
          ? 'Limit zapytań AI chwilowo przekroczony — spróbuj ponownie za kilka sekund.'
          : error?.message || 'Nie udało się przeszukać internetu.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 3C. In-App Voice Browser Article Reader (/api/browser/article)
  // ---------------------------------------------------------------------------
  app.post('/api/browser/article', async (req, res) => {
    try {
      const { url, title = '', summary = '', language = 'pl' } = req.body as {
        url: string;
        title?: string;
        summary?: string;
        language?: 'pl' | 'de';
      };

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Brak adresu URL artykułu.' });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        return res.status(400).json({ error: 'Nieprawidłowy adres URL artykułu.' });
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'Dozwolone są tylko adresy http i https.' });
      }

      const host = parsedUrl.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '::1' ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host.endsWith('.local') ||
        host.endsWith('.internal')
      ) {
        return res.status(400).json({ error: 'Niedozwolony adres wewnętrzny.' });
      }

      const decodeHtmlEntities = (str: string) =>
        str
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;|&apos;/gi, "'")
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

      const cacheKey = `article|${parsedUrl.href}`;
      const cached = getCachedPayload<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const domain = host.replace(/^www\./, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);

      let extractedTitle = title || domain;
      let extractedContent = '';

      try {
        const resp = await fetch(parsedUrl.href, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept-Language': language === 'de' ? 'de-DE,de;q=0.9,en;q=0.8' : 'pl-PL,pl;q=0.9,en;q=0.8',
          },
        });
        if (resp.ok) {
          const html = await resp.text();
          const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
          if (titleMatch?.[1]) {
            const tClean = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim();
            if (tClean && !title) extractedTitle = tClean;
          }

          const cleanedHtml = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
            .replace(/<(nav|footer|aside|header)[\s\S]*?<\/\1>/gi, ' ');

          const blocks: string[] = [];
          const pRegex = /<(?:p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/(?:p|h1|h2|h3|li)>/gi;
          let m: RegExpExecArray | null;
          while ((m = pRegex.exec(cleanedHtml)) !== null) {
            const txt = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' '))
              .replace(/\s+/g, ' ')
              .trim();
            if (txt.length >= 35 && !/^(cookies?|ciasteczka|akceptuj|accept|polityka prywatności|datenschutz)/i.test(txt)) {
              blocks.push(txt);
            }
            if (blocks.join('\n\n').length >= 5500) break;
          }

          extractedContent = blocks.join('\n\n').trim();
        }
      } catch {
        // fallback below
      } finally {
        clearTimeout(timeout);
      }

      if (!extractedContent) {
        extractedContent =
          summary ||
          (language === 'de'
            ? 'Diese Webseite blockiert die direkte Vorschau im eingebetteten Leser. Öffne den Artikel direkt über „Original öffnen“.'
            : 'Ta strona ogranicza podgląd tekstu w czytniku wewnętrznym. Użyj przycisku „Otwórz oryginał”, aby przeczytać pełny artykuł bezpośrednio na stronie.');
      }

      const payload = {
        url: parsedUrl.href,
        title: extractedTitle,
        domain,
        content: extractedContent.slice(0, 6000),
      };
      setCachedPayload(cacheKey, payload, 300_000);
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({
        error: error?.message || 'Nie udało się wczytać treści artykułu.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Bedtime / Short Story Generator (Polish or German, A-to-Z flowing)
  // ---------------------------------------------------------------------------
  app.post('/api/assistant/story', async (req, res) => {
    try {
      const { topic = '', language = 'pl' } = req.body as {
        topic?: string;
        language?: 'pl' | 'de';
      };
      const ai = getAiClient();
      const prompt =
        language === 'de'
          ? `Schreibe ein vollständiges, warmes, fesselndes deutsches Märchen von A bis Z mit klarem Anfang, Mittelteil und glücklichem Ende (ca. 190-240 Wörter). ${
              topic.trim()
                ? `Thema: ${topic.trim()}.`
                : 'Erfinde eine herzerwärmende Geschichte über einen mutigen kleinen Igel oder eine Reise durch den Zauberwald.'
            } WICHTIG: Schreibe in klaren, vollständigen Sätzen ohne Unterbrechungen, ohne Listen, ohne Markdown und ohne Sternchen — reiner, flüssiger Vorlesetext.`
          : `Napisz kompletną, piękną i płynną polską bajkę od A do Z — z wyraźnym wstępem, rozwinięciem przygody i spokojnym zakończeniem (około 190-240 słów). ${
              topic.trim()
                ? `Temat lub motyw bajki: ${topic.trim()}.`
                : 'Wymyśl urokliwą opowieść o małym podróżniku w zaczarowanym lesie albo mądrym ogórku-odkrywcy.'
            } WAŻNE: Pisz równymi, pełnymi zdaniami idealnymi do płynnego przeczytania jednym ciągiem na głos. Żadnego Markdowna, bez punktorów, bez gwiazdek i bez wtrąceń technicznych — sam czysty tekst bajki.`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
      } catch (primaryErr: any) {
        const msg = String(primaryErr?.message || '');
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          });
        } else {
          throw primaryErr;
        }
      }
      res.json({ storyText: (response.text ?? '').trim() });
    } catch (error: any) {
      console.error('Story generation error:', error);
      res.status(500).json({
        error: error?.message || 'Nie udało się ułożyć bajki.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 4b. Real YouTube Video Search (supports N-th track selection)
  // ---------------------------------------------------------------------------
  app.post('/api/youtube/search', async (req, res) => {
    try {
      const { query = '', language = 'pl' } = req.body as {
        query?: string;
        language?: 'pl' | 'de';
      };
      const effectiveQuery =
        (query || '').trim() ||
        (language === 'de' ? 'aktuelle musik hits' : 'najnowsze polskie hity muzyczne');

      const cacheKey = `yt:${language}:${effectiveQuery.toLowerCase()}`;
      const cached = getCachedPayload<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const ytRes = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(effectiveQuery)}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': language === 'de' ? 'de-DE,de;q=0.9' : 'pl-PL,pl;q=0.9',
          },
          signal: AbortSignal.timeout(7000),
        }
      );

      if (!ytRes.ok) {
        throw new Error(`YouTube HTTP ${ytRes.status}`);
      }

      const html = await ytRes.text();
      const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
      const results: Array<{
        videoId: string;
        title: string;
        channel: string;
        duration: string;
        thumbnailUrl: string;
        watchUrl: string;
      }> = [];

      if (match) {
        const data = JSON.parse(match[1]);
        const contents =
          data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
            ?.contents || [];
        for (const sec of contents) {
          const items = sec?.itemSectionRenderer?.contents || [];
          for (const item of items) {
            const vr = item.videoRenderer;
            if (vr && vr.videoId) {
              results.push({
                videoId: vr.videoId,
                title: vr.title?.runs?.map((r: any) => r.text).join('') || 'YouTube Video',
                channel: vr.ownerText?.runs?.map((r: any) => r.text).join('') || 'YouTube',
                duration: vr.lengthText?.simpleText || '',
                thumbnailUrl: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
                watchUrl: `https://www.youtube.com/watch?v=${vr.videoId}`,
              });
              if (results.length >= 8) break;
            }
          }
          if (results.length >= 8) break;
        }
      }

      const payload = { query: effectiveQuery, results };
      if (results.length > 0) {
        setCachedPayload(cacheKey, payload, 300_000);
      }
      res.json(payload);
    } catch (error: any) {
      console.error('YouTube search error:', error);
      res.status(500).json({
        error: error?.message || 'Nie udało się pobrać listy utworów z YouTube.',
      });
    }
  });

  const parseOrdinalTrackIndex = (txt: string): number | undefined => {
    const l = txt.toLowerCase();
    if (/(?:\b1\b|pierwsz|ersten?|#1|numer\s*1|nr\s*1)/.test(l)) return 1;
    if (/(?:\b2\b|drug|zweiten?|#2|numer\s*2|nr\s*2)/.test(l)) return 2;
    if (/(?:\b3\b|trzec|dritten?|#3|numer\s*3|nr\s*3)/.test(l)) return 3;
    if (/(?:\b4\b|czwart|vierten?|#4|numer\s*4|nr\s*4)/.test(l)) return 4;
    if (/(?:\b5\b|pi[ąa]t|f[üu]nften?|#5|numer\s*5|nr\s*5)/.test(l)) return 5;
    if (/(?:\b6\b|sz[óo]st|sechsten?|#6|numer\s*6|nr\s*6)/.test(l)) return 6;
    return undefined;
  };

  const parseYoutubeTrackRequest = (rawRest: string) => {
    const trackIdx = parseOrdinalTrackIndex(rawRest);
    const isRandomTrack =
      !trackIdx &&
      /(?<![\p{L}\p{N}])(kt[óo]ry[śs](?:\s+z)?|kt[óo]rykolwiek|jaki[śs]|jakikolwiek|losow\w*|dowoln\w*|inn[yąe]|nast[ęe]pn\w*|kolejn\w*|zufällig\w*|irgendein\w*|ander\w*|nächst\w*)(?![\p{L}\p{N}])/iu.test(
        rawRest
      );
    const cleanQuery = rawRest
      .replace(
        /(?:i\s+)?(?:wybierz|odtw[óo]rz|pu[śs][ćc]|zagraj|w[łl][ąa]cz|uruchom|odpal)?\s*(?:utw[óo]r|piosenk[ęe]|film|kawa[łl]ek|numer)?\s*(?:pierwsz\w*|drug\w*|trzec\w*|czwart\w*|pi[ąa]t\w*|sz[óo]st\w*|nr\s*\d+|numer\s*\d+)\s*(?:utw[óo]r|piosenk[ęe]|film|kawa[łl]ek)?(?:\s*(?:żeby|aby)?\s*odtworzy[łl])?/giu,
        ' '
      )
      .replace(
        /(?<![\p{L}\p{N}])(?:kt[óo]ry[śs]|kt[óo]rykolwiek|jaki[śs]|jakikolwiek|losow[\p{L}]*|dowoln[\p{L}]*|inn[yąe]|nast[ęe]pn[\p{L}]*|kolejn[\p{L}]*|dost[ęe]pnych|dost[ęe]pne|youtube(?:'?a|'ie)?|kawa[łl]k[óo]w|kawa[łl]ek|utwor[óo]w|utw[óo]r|piosenek|piosenk[ęe]|nagra[ńn]|film[óo]w|filmik|aktora|aktor|aktorki|aktorka|wykonawcy|wykonawca|piosenkarza|piosenkarki|artysty|artysta|poda[ćc]|podam|podaj[ęe]|podania|otworzy[ćc]|otw[óo]rz|uruchomi[ćc]|uruchom|w[łl][ąa]czy[ćc]|w[łl][ąa]cz|pu[śs]ci[ćc]|pu[śs][ćc]|zagraj|odtw[óo]rz|wybierz|wyszukaj|znajd[źz]|szukaj|dla|od|mi|prosz[ęe]|żeby|aby|na|z|i|schauspieler|künstler|irgendein[\p{L}]*|zufällig[\p{L}]*|titel|lied|song|auf|von|für)(?![\p{L}\p{N}])/giu,
        ' '
      )
      .replace(/[„”"':,;!?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { trackIdx, isRandomTrack, cleanQuery };
  };

  // ---------------------------------------------------------------------------
  // 5. Multi-step Voice / Text Command Orchestrator (PL & DE)
  // ---------------------------------------------------------------------------
  app.post('/api/assistant/command', async (req, res) => {
    try {
      const {
        transcript,
        currentTab = 'assistant',
        currentLocation = '',
        visibleItems = [],
        contacts = [],
        voiceGender = 'female_kore',
        language = 'pl',
        codeOnly = false,
      } = req.body as {
        transcript: string;
        currentTab?: string;
        currentLocation?: string;
        visibleItems?: Array<{ name: string; phone?: string | null }>;
        contacts?: Array<{ name: string; phone: string }>;
        voiceGender?: string;
        language?: 'pl' | 'de';
        codeOnly?: boolean;
      };

      const cleanTranscript = codeOnly
        ? stripHyphensForCodeOnly(transcript || '')
        : sanitizeCodeTokensInQuery(transcript || '');

      if (!cleanTranscript) {
        return res.status(400).json({ error: 'Brak treści polecenia lub kodu.' });
      }

      const isDeLang = language === 'de';

      const normalizeAlarmTime = (rawTime: string): string => {
        const cleaned = rawTime.replace(/\./g, ':').trim();
        const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(cleaned);
        if (!m) return '07:00';
        const hh = Math.min(23, Math.max(0, Number(m[1])));
        const mm = m[2] !== undefined ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      };

      // 0ms fast-path: Close browser (and optionally wait for further commands)
      if (
        /^(?:prosz[ęe]\s+)?(?:zamknij|wy[łl][ąa]cz|zatrzymaj|zako[ńn]cz|schlie[ßs]e|beende|stoppe)\s+(?:t[ęą]\s+|aplikacj[ęe]\s+|okno\s+)?(?:przegl[ąa]dark[ęei]|google\s+chrome|chrome|browser)(?:\s*(?:,|i|oraz|und)?\s*(?:poczekaj|czekaj|zaczekaj|warte)(?:\s+na\s+(?:inne|kolejne|dalsze|nowe)\s+(?:poleceni[ea]|komend[ey]|rozkazy))?)?[.!?]*$/i.test(
          cleanTranscript
        ) ||
        /^(?:przegl[ąa]darka|browser)\s+(?:aus|off|stop|wy[łl][ąa]cz|zamknij)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang
            ? 'Ich habe den Browser geschlossen und warte auf weitere Befehle.'
            : 'Wyłączyłem przeglądarkę. Czekam na kolejne polecenia.',
          actions: [{ type: 'close_browser' }],
        });
      }

      // 0ms fast-path: Close / back from article in browser
      if (
        /^(?:prosz[ęe]\s+)?(?:zamknij\s+artyku[łl]|wr[óo][ćc]\s+do\s+(?:listy\s+)?artyku[łl][óo]w|wr[óo][ćc]\s+do\s+przegl[ąa]darki|schlie[ßs]e\s+artikel|zurück\s+zum\s+browser)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang ? 'Ich kehre zu den Suchergebnissen zurück.' : 'Wracam do listy artykułów w przeglądarce.',
          actions: [{ type: 'close_article' }],
        });
      }

      // 0ms fast-path: Open or read N-th article in browser
      const selectArticleMatch =
        /^(?:prosz[ęe]\s+)?(?:otw[óo]rz|w[łl][ąa]cz|poka[żz]|przeczytaj|czytaj|wybierz|öffne|lies)\s+(?:mi\s+)?(?:artyku[łl]|tekst|wiadomo[śs][ćc]|stron[ęe]|artikel)?\s*(pierwsz\w*|drug\w*|trzec\w*|czwart\w*|pi[ąa]t\w*|sz[óo]st\w*|nr\s*\d+|numer\s*\d+|\d+)(?:\s+(?:artyku[łl]|tekst|wiadomo[śs][ćc]|artikel))?(?:\s+i\s+(?:go\s+)?(?:przeczytaj|czytaj))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (selectArticleMatch && /(artyku|tekst|wiadomo|stron|artikel|przeczytaj|czytaj|lies)/i.test(cleanTranscript)) {
        const idx = parseOrdinalTrackIndex(selectArticleMatch[1]);
        if (idx) {
          const readAloud = /(przeczytaj|czytaj|na\s+g[łl]os|lies|vorlesen)/i.test(cleanTranscript);
          return res.json({
            replyText: readAloud
              ? isDeLang
                ? `Ich öffne Artikel Nummer ${idx} und lese ihn vor.`
                : `Otwieram i czytam artykuł numer ${idx}.`
              : isDeLang
                ? `Ich öffne Artikel Nummer ${idx}.`
                : `Otwieram artykuł numer ${idx}.`,
            actions: [{ type: 'select_article', articleIndex: idx, readAloud }],
          });
        }
      }

      // 0ms fast-path: Open voice-controlled browser (with optional immediate search / article search)
      const openBrowserMatch =
        /^(?:prosz[ęe]\s+)?(?:(?:chc[ęe]|chcia[łl]bym|chcia[łl]abym|mam\s+ch[ęe][ćc]|mo[żz]esz)\s+)?(?:w[łl][ąa]czy[ćc]|w[łl][ąa]cz|otworzy[ćc]|otw[óo]rz|uruchomi[ćc]|uruchom|odpal(?:i[ćc])?|starte|öffne|open)\s+(?:mi\s+)?(?:t[ęą]\s+|aplikacj[ęe]\s+)?(?:przegl[ąa]dark[ęei]|browser)(?:\s+(?:i\s+)?(?:wyszukaj|poszukaj|szukaj|znajd[źz]|otw[óo]rz|wejd[źz]\s+na|suche|finde)?\s*(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (openBrowserMatch) {
        const rawRest = (openBrowserMatch[1] || '')
          .replace(/^(?:w\s+niej\s+|w\s+przegl[ąa]darce\s+)/i, '')
          .trim();
        return res.json({
          replyText: rawRest
            ? isDeLang
              ? `Ich öffne den Browser und suche nach „${rawRest}”.`
              : `Włączam przeglądarkę i wyszukuję „${rawRest}”.`
            : isDeLang
              ? 'Ich habe den Browser geöffnet. Sage mir, wonach ich suchen soll.'
              : 'Włączyłem przeglądarkę. Powiedz, jakich artykułów lub informacji szukać.',
          actions: [{ type: 'open_browser', ...(rawRest ? { query: rawRest } : {}) }],
        });
      }

      // 0ms fast-path: Search articles / search inside browser by voice
      const articleSearchMatch =
        /^(?:prosz[ęe]\s+)?(?:wyszukaj|poszukaj|szukaj|znajd[źz]|poka[żz]|suche|finde|zeige)(?:\s+mi)?(?:\s+w\s+przegl[ąa]darce|\s+w\s+internecie|\s+w\s+google|\s+im\s+browser)?\s+(?:artyku[łl][óo]w|artyku[łl]y|artyku[łl]|wiadomo[śs]ci|teksty|informacj[ei]|artikel|nachrichten)(?:\s+(?:o|na\s+temat|dotycz[ąa]c\w*|w\s+sprawie|z|über|zu))?\s+(.+)[.!?]*$/i.exec(
          cleanTranscript
        ) ||
        /^(?:prosz[ęe]\s+)?(?:wyszukaj|poszukaj|szukaj|znajd[źz]|suche)\s+w\s+(?:przegl[ąa]darce|internecie|browserze|chrome)(?:\s+(?:artyku[łl]\w*\s+)?(?:o|na\s+temat)?)?\s+(.+)[.!?]*$/i.exec(
          cleanTranscript
        );
      if (articleSearchMatch && articleSearchMatch[1]?.trim()) {
        const cleanQuery = articleSearchMatch[1].trim();
        return res.json({
          replyText: isDeLang
            ? `Ich suche im Browser Artikel zu „${cleanQuery}”.`
            : `Szukam w przeglądarce artykułów na temat „${cleanQuery}”.`,
          actions: [{ type: 'open_browser', query: cleanQuery }],
        });
      }

      // 0ms fast-path: Story continue / pause
      if (
        /^(?:prosz[ęe]\s+)?(?:kontynuuj|czytaj\s+dalej|opowiadaj\s+dalej|m[óo]w\s+dalej|doko[ńn]cz(?:\s+bajk[ęe])?|wr[óo][ćc]\s+do\s+bajki|weiterlesen|erzähl\s+weiter|märchen\s+weiter)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang
            ? 'Ich erzähle das Märchen genau ab der unterbrochenen Stelle weiter.'
            : 'Kontynuuję bajkę dokładnie od przerwanego miejsca.',
          actions: [{ type: 'continue_story' }],
        });
      }
      if (
        /^(?:prosz[ęe]\s+)?(?:wstrzymaj|zatrzymaj|przerwij|pauza)\s+(?:t[ęą]\s+)?(?:bajk[ęe]|opowie[śs][ćc]|märchen)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang
            ? 'Ich habe das Märchen pausiert.'
            : 'Wstrzymałem bajkę — powiedz „kontynuuj”, kiedy będziesz gotowy.',
          actions: [{ type: 'pause_story' }],
        });
      }

      // 0ms fast-path: Calculator open / evaluate / close
      if (
        /^(?:prosz[ęe]\s+)?(?:zamknij|wy[łl][ąa]cz|schlie[ßs]e)\s+(?:kalkulator|taschenrechner)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang ? 'Ich schließe den Rechner.' : 'Zamykam kalkulator.',
          actions: [{ type: 'close_calculator' }],
        });
      }
      const calcExprMatch =
        /^(?:prosz[ęe]\s+)?(?:uruchom|otw[óo]rz|w[łl][ąa]cz|odpal|oblicz|policz|wylicz|ile\s+(?:to|wynosi)|starte|öffne|rechne)\s+(?:kalkulator|taschenrechner|rechner)?(?:\s*(?:i\s+(?:oblicz|policz)|ile\s+to)?\s*([0-9+\-*/().,%×÷\s]+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (
        calcExprMatch &&
        (/(kalkulator|taschenrechner|rechner)/i.test(cleanTranscript) ||
          Boolean(calcExprMatch[1] && /\d/.test(calcExprMatch[1])))
      ) {
        const expr = calcExprMatch[1]?.trim();
        return res.json({
          replyText: expr
            ? isDeLang
              ? `Ich öffne den Rechner und berechne ${expr}.`
              : `Uruchamiam kalkulator i obliczam ${expr}.`
            : isDeLang
              ? 'Ich öffne den Taschenrechner.'
              : 'Uruchamiam kalkulator.',
          actions: [{ type: 'open_calculator', ...(expr ? { expression: expr } : {}) }],
        });
      }

      // 0ms fast-path: Notepad open / write / delete / close
      if (
        /^(?:prosz[ęe]\s+)?(?:zamknij|wy[łl][ąa]cz|schlie[ßs]e)\s+(?:notatnik|notizblock)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang ? 'Ich schließe den Notizblock.' : 'Zamykam notatnik.',
          actions: [{ type: 'close_notepad' }],
        });
      }
      const writeNoteMatch =
        /^(?:prosz[ęe]\s+)?(?:(?:uruchom|otw[óo]rz|w[łl][ąa]cz)\s+notatnik\s+(?:i\s+)?)?(?:wpisz|zapisz|dopisz|zanotuj|dodaj|notiere|schreibe)\s+(?:do\s+notatnika|w\s+notatniku|notatk[ęe]|in\s+notizen|eine\s+notiz)\s*[:,-]?\s*(.+)[.!?]*$/i.exec(
          cleanTranscript
        );
      if (writeNoteMatch && writeNoteMatch[1]?.trim()) {
        const noteText = writeNoteMatch[1].trim();
        return res.json({
          replyText: isDeLang
            ? `Ich habe notiert: ${noteText}`
            : `Wpisałem do notatnika: ${noteText}`,
          actions: [{ type: 'write_note', text: noteText }],
        });
      }
      if (
        /^(?:prosz[ęe]\s+)?(?:uruchom|otw[óo]rz|w[łl][ąa]cz|poka[żz]|starte|öffne)\s+(?:notatnik|notatki|notizblock)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang ? 'Ich öffne den Notizblock.' : 'Uruchamiam notatnik.',
          actions: [{ type: 'open_notepad' }],
        });
      }
      const deleteNoteMatch =
        /^(?:prosz[ęe]\s+)?(?:usu[ńn]|skasuj|wyczy[śs][ćc]|lösche)\s+(?:(wszystkie)\s+)?(?:notatk[ęei]|notatnik|notizen)(?:\s+(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (deleteNoteMatch) {
        const allNotes =
          Boolean(deleteNoteMatch[1]) ||
          /wyczy[śs][ćc]\s+notatnik|wszystkie/i.test(cleanTranscript);
        const targetText = deleteNoteMatch[2]?.trim();
        return res.json({
          replyText: allNotes
            ? isDeLang
              ? 'Ich habe alle Notizen gelöscht.'
              : 'Usunąłem wszystkie notatki.'
            : isDeLang
              ? 'Ich habe die Notiz gelöscht.'
              : 'Usunąłem notatkę.',
          actions: [
            {
              type: 'delete_note',
              all: allNotes,
              ...(targetText ? { text: targetText } : {}),
            },
          ],
        });
      }

      // 0ms fast-path: Set & Delete Alarm / Reminder
      const deleteAlarmMatch =
        /^(?:prosz[ęe]\s+)?(?:usu[ńn]|skasuj|wy[łl][ąa]cz|odwo[łl]aj|lösche|entferne)\s+(?:(wszystkie)\s+)?budzik(?:i|a)?(?:\s+(?:na\s+(?:godzin[ęe]\s+)?)?(\d{1,2}(?:[:.]\d{2})?))?(?:\s+(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (deleteAlarmMatch) {
        const all = Boolean(deleteAlarmMatch[1]) || /wszystkie|alle/i.test(cleanTranscript);
        const time = deleteAlarmMatch[2] ? normalizeAlarmTime(deleteAlarmMatch[2]) : undefined;
        const label = deleteAlarmMatch[3]?.trim();
        return res.json({
          replyText: all
            ? isDeLang
              ? 'Ich habe alle Wecker gelöscht.'
              : 'Usunąłem wszystkie budziki.'
            : time
              ? isDeLang
                ? `Ich lösche den Wecker für ${time}.`
                : `Usuwam budzik na ${time}.`
              : isDeLang
                ? 'Ich lösche den Wecker.'
                : 'Usuwam budzik.',
          actions: [
            {
              type: 'delete_alarm',
              all,
              ...(time ? { time } : {}),
              ...(label ? { label } : {}),
            },
          ],
        });
      }

      const setAlarmMatch =
        /^(?:prosz[ęe]\s+)?(?:ustaw|nastaw|w[łl][ąa]cz|dodaj|stelle)\s+budzik(?:\s+na(?:\s+godzin[ęe])?)?\s+(\d{1,2}(?:[:.]\d{1,2})?)(?:\s+(?:o\s+nazwie|opis|z\s+etykiet[ąa]\s+)?(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (setAlarmMatch) {
        const time = normalizeAlarmTime(setAlarmMatch[1]);
        const label = setAlarmMatch[2]?.trim() || 'Budzik';
        return res.json({
          replyText: isDeLang
            ? `Wecker für ${time} Uhr gestellt.`
            : `Ustawiłem budzik na godzinę ${time}.`,
          actions: [{ type: 'set_alarm', time, label }],
        });
      }

      const deleteReminderMatch =
        /^(?:prosz[ęe]\s+)?(?:usu[ńn]|skasuj|wy[łl][ąa]cz|odwo[łl]aj|lösche|entferne)\s+(?:(wszystkie)\s+)?(?:powiadomieni[ea]|przypomnieni[ea]|erinnerung(?:en)?)(?:\s+(?:o\s+)?(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (deleteReminderMatch) {
        const all = Boolean(deleteReminderMatch[1]) || /wszystkie|alle/i.test(cleanTranscript);
        const text = deleteReminderMatch[2]?.trim();
        return res.json({
          replyText: all
            ? isDeLang
              ? 'Ich habe alle Erinnerungen gelöscht.'
              : 'Usunąłem wszystkie powiadomienia.'
            : isDeLang
              ? 'Ich habe die Erinnerung gelöscht.'
              : 'Usunąłem powiadomienie.',
          actions: [{ type: 'delete_reminder', all, ...(text ? { text } : {}) }],
        });
      }

      const setReminderDelayMatch =
        /^(?:prosz[ęe]\s+)?(?:ustaw\s+powiadomienie|przypomnij(?:\s+mi)?)\s+za\s+(\d+)\s*(?:min(?:ut[ęey]?)?|sek\w*)\s*(.+)[.!?]*$/i.exec(
          cleanTranscript
        );
      if (setReminderDelayMatch) {
        const delayMinutes = Math.max(1, Number(setReminderDelayMatch[1]) || 5);
        const text = setReminderDelayMatch[2].trim();
        return res.json({
          replyText: isDeLang
            ? `Erinnerung in ${delayMinutes} Minuten eingestellt: ${text}`
            : `Ustawiłem powiadomienie za ${delayMinutes} min: ${text}`,
          actions: [{ type: 'set_reminder', delayMinutes, text }],
        });
      }

      const setReminderTimeMatch =
        /^(?:prosz[ęe]\s+)?(?:ustaw\s+powiadomienie|przypomnij(?:\s+mi)?)\s+(?:o|na)(?:\s+godzin[ęe])?\s+(\d{1,2}(?:[:.]\d{1,2})?)\s+(.+)[.!?]*$/i.exec(
          cleanTranscript
        );
      if (setReminderTimeMatch) {
        const time = normalizeAlarmTime(setReminderTimeMatch[1]);
        const text = setReminderTimeMatch[2].trim();
        return res.json({
          replyText: isDeLang
            ? `Erinnerung für ${time} Uhr eingestellt: ${text}`
            : `Ustawiłem powiadomienie na ${time}: ${text}`,
          actions: [{ type: 'set_reminder', time, text }],
        });
      }

      // 0ms fast-path: Close YouTube (and wait for further commands)
      if (
        /^(?:prosz[ęe]\s+)?(?:zamknij|wy[łl][ąa]cz|zatrzymaj|zako[ńn]cz|schlie[ßs]e|beende|stoppe)\s+(?:aplikacj[ęe]\s+|odtwarzacz\s+)?youtube(?:\s+music)?(?:\s*(?:,|i|oraz|und)?\s*(?:poczekaj|czekaj|zaczekaj|warte)(?:\s+na\s+(?:inne|kolejne|dalsze|nowe)\s+(?:poleceni[ea]|komend[ey]|rozkazy))?)?[.!?]*$/i.test(
          cleanTranscript
        ) ||
        /^youtube\s+(?:aus|off|stop|wy[łl][ąa]cz|zamknij)[.!?]*$/i.test(cleanTranscript)
      ) {
        return res.json({
          replyText: isDeLang
            ? 'Ich habe YouTube ausgeschaltet und warte auf deine nächsten Befehle.'
            : 'Wyłączyłem YouTube. Czekam na kolejne polecenia.',
          actions: [{ type: 'close_youtube' }],
        });
      }

      // 0ms fast-path: Switch to another / random / N-th track on open YouTube list
      if (
        /^(?:prosz[ęe]\s+)?(?:wybierz|odtw[óo]rz|pu[śs][ćc]|w[łl][ąa]cz|uruchom|zagraj|zmie[ńn]\s+na|prze[łl][ąa]cz\s+na|spiele|wähle)\s+(?:kt[óo]ry[śs](?:\s+z\s+dost[ęe]pnych)?|jaki[śs]|losow\w*|inn[yąe]|nast[ęe]pn\w*|kolejn\w*|ander\w*|nächst\w*)\s+(?:utw[óo]r|piosenk[ęe]|film|kawa[łl]ek|kawa[łl]k[óo]w|utwor[óo]w|titel|lied|song)[.!?]*$/i.test(
          cleanTranscript
        )
      ) {
        return res.json({
          replyText: isDeLang
            ? 'Ich spiele einen anderen verfügbaren Titel auf YouTube ab.'
            : 'Odtwarzam inny dostępny kawałek na YouTube.',
          actions: [{ type: 'select_youtube_track', randomTrack: true, nextTrack: true }],
        });
      }

      const selectTrackOnlyMatch =
        /^(?:prosz[ęe]\s+)?(?:wybierz|odtw[óo]rz|pu[śs][ćc]|w[łl][ąa]cz|zagraj|spiele|wähle)\s+(?:utw[óo]r|piosenk[ęe]|film|kawa[łl]ek|numer|nr|titel|lied)?\s*(pierwsz\w*|drug\w*|trzec\w*|czwart\w*|pi[ąa]t\w*|sz[óo]st\w*|\d+|nr\s*\d+|numer\s*\d+)(?:\s+(?:utw[óo]r|piosenk[ęe]|film|kawa[łl]ek|titel|lied))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (selectTrackOnlyMatch) {
        const idx = parseOrdinalTrackIndex(selectTrackOnlyMatch[1]);
        if (idx) {
          return res.json({
            replyText: isDeLang
              ? `Ich spiele Titel Nummer ${idx} ab.`
              : `Wybieram i odtwarzam utwór numer ${idx}.`,
            actions: [{ type: 'select_youtube_track', trackIndex: idx }],
          });
        }
      }

      // 0ms deterministic fast-path for Chrome, YouTube Music, YouTube (with optional actor/artist, N-th or random track selection)
      const chromeMatch =
        /^(?:prosz[ęe]\s+)?(?:otw[óo]rz|uruchom|w[łl][ąa]cz|odpal|starte|öffne|open)\s+(?:aplikacj[ęe]\s+|przegl[ąa]dark[ęe]\s+)?(?:google\s+)?chrome(?:\s+(?:i\s+(?:wyszukaj|poszukaj|otw[óo]rz|wejd[źz]\s+na)\s+)?(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (chromeMatch) {
        const extraQuery = chromeMatch[1]?.trim();
        return res.json({
          replyText: extraQuery
            ? isDeLang
              ? `Ich öffne Google Chrome und suche nach „${extraQuery}”.`
              : `Uruchamiam przeglądarkę Chrome i wyszukuję „${extraQuery}”.`
            : isDeLang
              ? 'Ich öffne Google Chrome auf deinem Gerät.'
              : 'Uruchamiam przeglądarkę Google Chrome.',
          actions: [
            {
              type: 'open_browser',
              openExternalChrome: true,
              ...(extraQuery ? { query: extraQuery } : {}),
            },
          ],
        });
      }

      const ytMusicMatch =
        /^(?:prosz[ęe]\s+)?(?:(?:chc[ęe]|chcia[łl]bym|chcia[łl]abym|mam\s+ch[ęe][ćc]|mo[żz]esz)\s+)?(?:otworzy[ćc]|otw[óo]rz|uruchomi[ćc]|uruchom|w[łl][ąa]czy[ćc]|w[łl][ąa]cz|odpal(?:i[ćc])?|zagraj|pu[śs][ćc]|starte|öffne|open|spiele)\s+(?:aplikacj[ęe]\s+)?youtube\s+music(?:\s+(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (ytMusicMatch) {
        const rawRest = ytMusicMatch[1]?.trim() || '';
        const { trackIdx, isRandomTrack, cleanQuery } = rawRest
          ? parseYoutubeTrackRequest(rawRest)
          : { trackIdx: undefined, isRandomTrack: false, cleanQuery: '' };
        return res.json({
          replyText: trackIdx
            ? isDeLang
              ? `Ich öffne YouTube Music und spiele Titel Nummer ${trackIdx}.`
              : `Uruchamiam YouTube Music i odtwarzam utwór numer ${trackIdx}.`
            : isRandomTrack && cleanQuery
              ? isDeLang
                ? `Ich öffne YouTube Music für ${cleanQuery} und spiele einen verfügbaren Titel ab.`
                : `Uruchamiam YouTube Music dla ${cleanQuery} i puszczam dostępny kawałek.`
              : isDeLang
                ? 'Ich starte YouTube Music.'
                : 'Uruchamiam YouTube Music.',
          actions: [
            {
              type: 'open_youtube',
              service: 'youtube_music',
              ...(cleanQuery ? { query: cleanQuery } : {}),
              ...(trackIdx ? { trackIndex: trackIdx } : {}),
              ...(isRandomTrack ? { randomTrack: true } : {}),
            },
          ],
        });
      }

      const ytMatch =
        /^(?:prosz[ęe]\s+)?(?:(?:chc[ęe]|chcia[łl]bym|chcia[łl]abym|mam\s+ch[ęe][ćc]|ch[ęe][ćc]\s+otwarcia|mo[żz]esz)\s+)?(?:otworzy[ćc]|otw[óo]rz|otwarcia|uruchomi[ćc]|uruchom|w[łl][ąa]czy[ćc]|w[łl][ąa]cz|odpal(?:i[ćc])?|starte|öffne|open)?\s*(?:aplikacj[ęe]\s+)?youtube(?:'?a|'ie)?(?:\s+(.+))?[.!?]*$/i.exec(
          cleanTranscript
        );
      if (ytMatch && /(?:otw|uruch|w[łl][ąa]cz|odpal|pu[śs][ćc]|zagraj|öffne|starte|open|youtube\s+(?:dla|od|aktor|wykonaw|kawa[łl]|utw[óo]r|piosen))/i.test(cleanTranscript)) {
        const rawRest = ytMatch[1]?.trim() || '';
        const { trackIdx, isRandomTrack, cleanQuery } = rawRest
          ? parseYoutubeTrackRequest(rawRest)
          : { trackIdx: undefined, isRandomTrack: false, cleanQuery: '' };
        return res.json({
          replyText: trackIdx
            ? isDeLang
              ? `Ich öffne YouTube und spiele Titel Nummer ${trackIdx}.`
              : `Włączam YouTube i odtwarzam utwór numer ${trackIdx}.`
            : isRandomTrack && cleanQuery
              ? isDeLang
                ? `Ich öffne YouTube für ${cleanQuery} und spiele einen der verfügbaren Titel ab.`
                : `Włączam YouTube dla ${cleanQuery} i odtwarzam jeden z dostępnych kawałków.`
              : cleanQuery
                ? isDeLang
                  ? `Ich öffne YouTube für ${cleanQuery}.`
                  : `Włączam YouTube dla ${cleanQuery}.`
                : isDeLang
                  ? 'Ich öffne YouTube.'
                  : 'Włączam YouTube.',
          actions: [
            {
              type: 'open_youtube',
              service: 'youtube',
              ...(cleanQuery ? { query: cleanQuery } : {}),
              ...(trackIdx ? { trackIndex: trackIdx } : {}),
              ...(isRandomTrack ? { randomTrack: true } : {}),
            },
          ],
        });
      }

      const mapTabWord = (word: string): 'assistant' | 'food' | 'stays' | 'transit' | undefined => {
        const w = word.toLowerCase().trim();
        if (/(jedzeni|essen|food)/.test(w)) return 'food';
        if (/(nocleg|unterkünfte|hotel|stays)/.test(w)) return 'stays';
        if (/(przejazd|verkehr|tras|transit|pociąg|esban|s-bahn)/.test(w)) return 'transit';
        if (/(asystent|czat|rozmow|assistent|assistant|poprzedni)/.test(w)) return 'assistant';
        return undefined;
      };

      // 0ms fast-path for closing / returning from a tab (e.g. "zamknij jedzenie i przejdź do noclegów", "wróć do asystenta")
      const tabNamesPattern =
        'jedzeni[ea]|nocleg(?:i|ów)|przejazd(?:y|ów)|asystent(?:a)?|essen|unterkünfte|verkehr|assistent';
      const closeTabMatch = new RegExp(
        `^(?:prosz[ęe]\\s+)?(?:zamknij|wyjd[źz]\\s+z|opu[śs][ćc]|wr[óo][ćc](?:\\s+z)?|cofnij|schlie[ßs]e|zurück)(?:\\s+(?:t[ęą]|t[ąa])?\\s*(?:zak[łl]adk[ęei]|okno|kart[ęe]|tab))?(?:\\s+(?:${tabNamesPattern}|poprzedniej|poprzedniego|poprzedni))?(?:(?:\\s+i|\\s*,)?\\s+(?:wr[óo][ćc]\\s+do|przejd[źz]\\s+do|otw[óo]rz|poka[żz]|w[łl][ąa]cz|geh\\s+zu|öffne)\\s+(?:zak[łl]adk[ęei]\\s+)?(${tabNamesPattern}))?[.!?]*$`,
        'i'
      ).exec(cleanTranscript);
      if (closeTabMatch) {
        const targetWord = closeTabMatch[1];
        const explicitTarget = targetWord ? mapTabWord(targetWord) : undefined;
        const backToAssistant = /\b(do\s+asystent\w*|do\s+czat\w*|zum\s+assistent\w*)\b/i.test(
          cleanTranscript
        );
        const targetTab = explicitTarget || (backToAssistant ? 'assistant' : undefined);
        return res.json({
          replyText: isDeLang
            ? 'Ich schließe den Tab und wechsle zur gewünschten Ansicht.'
            : targetTab
              ? 'Zamykam i przechodzę do wybranej zakładki.'
              : 'Zamykam zakładkę i wracam do poprzedniego widoku.',
          actions: [{ type: 'close_tab', ...(targetTab ? { targetTab } : {}) }],
        });
      }

      const tabMatch = new RegExp(
        `^(?:prosz[ęe]\\s+)?(?:przejd[źz]\\s+do|wr[óo][ćc]\\s+do|otw[óo]rz|poka[żz]|w[łl][ąa]cz|öffne|geh\\s+zu)\\s+(?:zak[łl]adk[ęei]\\s+)?(${tabNamesPattern})[.!?]*$`,
        'i'
      ).exec(cleanTranscript);
      if (tabMatch) {
        const mappedTab = mapTabWord(tabMatch[1]) || 'assistant';
        return res.json({
          replyText: isDeLang
            ? `Ich öffne den Bereich ${mappedTab}.`
            : `Otwieram zakładkę ${tabMatch[1]}.`,
          actions: [{ type: 'navigate', tab: mappedTab, explicit: true }],
        });
      }

      const ai = getAiClient();
      const voiceCfg = resolveVoiceConfig(voiceGender);
      const targetLangName = language === 'de' ? 'niemieckim (Deutsch)' : 'polskim';
      const personaDesc = language === 'de' ? voiceCfg.personaDe : voiceCfg.personaPl;

      const commandPrompt = `Polecenie użytkownika (po polsku lub niemiecku): "${cleanTranscript}"
${codeOnly ? 'TRYB KODU BEZ MYŚLNIKÓW AKTYWNY: Traktuj wpis jako kod bez myślników i użyj web_search z codeOnly=true lub dopasuj lokalizację/kod.' : ''}

Stan UI:
- aktywna zakładka: ${currentTab}
- język asystenta: ${language}
- aktywny głos: ${voiceCfg.voiceName} (${voiceCfg.gender})
- aktualna lokalizacja: ${currentLocation || 'GPS'}
- widoczne wyniki: ${JSON.stringify(visibleItems.slice(0, 8))}
- kontakty: ${JSON.stringify(contacts.slice(0, 12))}

ZASADY KLUCZOWE:
1. OBSŁUGUJESZ WYSZUKIWANIE JEDZENIA, NOCLEGÓW I PRZEJAZDÓW W DOWOLNYM KRAJU NA ŚWIECIE po kodzie pocztowym lub mieście (Polska 00-001, Niemcy 10115, Francja 75001, Czechy, Austria, UK itd.).
2. KOD POCZTOWY W NIEMCZECH: Jeśli użytkownik mówi, że kod pocztowy jest w Niemczech (np. "w Niemczech", "Deutschland", "DE", "PLZ"), ZAWSZE usuń z niego wszystkie myślniki (np. 10-115 -> 10115) w polu "location"/"from"/"to"/"query" i ustaw country: "DE". Dla innych krajów zachowaj naturalny format kodu (np. "00-001" i country: "PL").
3. PEŁNE UPRAWNIENIA DO APLIKACJI TELEFONU I PRZEGLĄDARKI: Masz pełną zgodę i uprawnienia na włączanie przeglądarki (open_browser), wyszukiwanie danych artykułów i stron (open_browser z query lub web_search), otwieranie i czytanie wybranego artykułu (select_article / close_article), wyłączanie przeglądarki podczas rozmowy głosowej (close_browser), uruchamianie Google Chrome (open_browser z openExternalChrome=true lub app="chrome"), YouTube / YouTube Music, kalkulatora oraz notatnika.
4. ZAMYKANIE I POWRÓT Z ZAKŁADKI (np. z Jedzenia): Jeśli użytkownik chce wrócić, zamknąć zakładkę (np. jedzenie) lub przejść do innej zakładki podanej przez niego, użyj "close_tab" (z opcjonalnym "targetTab": "assistant" | "food" | "stays" | "transit") lub "navigate" z explicit=true.
5. WYNIKI W AKTYWNYM OKNIE: Jeśli "aktywna zakładka" to "food", "stays" lub "transit" i szukasz czegoś przez "web_search" lub "open_browser", NIGDY nie zwracaj akcji navigate(tab: "assistant") — przeglądarka i wyniki zostaną wyświetlone bezpośrednio w aktualnie otwartym oknie!
6. YOUTUBE, AKTOR / WYKONAWCA I WYŁĄCZANIE: Gdy użytkownik prosi o otwarcie YouTube dla podanego aktora/wykonawcy lub uruchomienie któregoś z dostępnych kawałków, wyekstrahuj samo imię i nazwisko / nazwę do pola "query" w open_youtube i ustaw randomTrack: true (lub trackIndex dla konkretnego numeru, np. "wybierz drugi utwór" -> trackIndex: 2). Gdy mówi "wyłącz YouTube" / "wyłącz YouTube i czekaj na inne polecenia", użyj akcji close_youtube i napisz krótką gotowość na dalsze polecenia.
7. BAJKI, BUDZIKI I POWIADOMIENIA: Dla bajek użyj read_story / continue_story / pause_story. Dla budzików użyj set_alarm lub delete_alarm. Dla powiadomień użyj set_reminder lub delete_reminder.

Akcje UI ("actions"):
1. navigate (tab: "assistant" | "food" | "stays" | "transit", explicit: true)
2. close_tab (targetTab: opcjonalnie "assistant" | "food" | "stays" | "transit")
3. set_language (language: "pl" | "de")
4. search_food (category: "all" | "doner" | "pizza" | "chinese" | "near_post", location, country)
5. search_stays (stayType: "all" | "hotel" | "apartment" | "budget", location, country)
6. auto_book_stay (location, country, stayName, checkIn, checkOut, guests)
7. search_transit (mode: "trains" | "sbahn" | "buses" | "car" | "fuel", from, to, country, query)
8. web_search (query, autoRedirect, codeOnly)
9. dial (target: nazwa lokalu/kontaktu lub "first")
10. prepare_whatsapp (message, recipientFilter)
11. read_story (topic) / continue_story / pause_story
12. set_alarm (time "HH:MM", label) / delete_alarm (time, label, all)
13. set_reminder (delayMinutes, time, text) / delete_reminder (text, all)
14. open_youtube (query, service: "youtube" | "youtube_music", trackIndex, randomTrack) / select_youtube_track (trackIndex, randomTrack, nextTrack) / close_youtube
15. open_browser (query, openExternalChrome) / select_article (articleIndex, readAloud) / close_article / close_browser
16. open_calculator (expression) / close_calculator
17. open_notepad / write_note (text) / delete_note (text, all) / close_notepad
18. open_app (app: "chrome" | "youtube_music" | "youtube" | "whatsapp" | "browser" | "maps" | "spotify" | "booking" | "calendar" | "clock" | "phone", query, contactName)

WAŻNE: Dla akcji search_food, search_stays i auto_book_stay ZAWSZE umieszczaj kod pocztowy lub nazwę miasta w polu "location" (nie w "target"), a kraj (np. "PL", "DE", "FR") w polu "country".
W polu "replyText" ZAWSZE napisz krótką, konkretną i naturalną odpowiedź w języku ${targetLangName} jako ${personaDesc} (1-2 zwięzłe zdania). Pole "replyText" nie może być puste.`;

      const commandSchema = {
        type: Type.OBJECT,
        properties: {
          replyText: { type: Type.STRING },
          actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description:
                    'One of: navigate, close_tab, set_language, search_food, search_stays, auto_book_stay, search_transit, web_search, dial, prepare_whatsapp, read_story, continue_story, pause_story, set_alarm, delete_alarm, set_reminder, delete_reminder, open_youtube, select_youtube_track, close_youtube, open_browser, select_article, close_article, close_browser, open_calculator, close_calculator, open_notepad, write_note, delete_note, close_notepad, open_app',
                },
                tab: { type: Type.STRING, nullable: true },
                targetTab: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Target tab for close_tab: assistant, food, stays, transit',
                },
                explicit: { type: Type.BOOLEAN, nullable: true },
                language: { type: Type.STRING, nullable: true },
                location: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Postal code or city for search_food, search_stays, auto_book_stay',
                },
                country: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Country code or name (e.g. DE, PL, FR)',
                },
                category: { type: Type.STRING, nullable: true },
                stayType: { type: Type.STRING, nullable: true },
                stayName: { type: Type.STRING, nullable: true },
                checkIn: { type: Type.STRING, nullable: true },
                checkOut: { type: Type.STRING, nullable: true },
                guests: { type: Type.INTEGER, nullable: true },
                mode: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'One of: trains, sbahn, buses, car, fuel',
                },
                from: { type: Type.STRING, nullable: true },
                to: { type: Type.STRING, nullable: true },
                target: { type: Type.STRING, nullable: true },
                message: { type: Type.STRING, nullable: true },
                recipientFilter: { type: Type.STRING, nullable: true },
                topic: { type: Type.STRING, nullable: true },
                time: { type: Type.STRING, nullable: true },
                label: { type: Type.STRING, nullable: true },
                all: { type: Type.BOOLEAN, nullable: true },
                delayMinutes: { type: Type.INTEGER, nullable: true },
                text: { type: Type.STRING, nullable: true },
                expression: { type: Type.STRING, nullable: true },
                trackIndex: { type: Type.INTEGER, nullable: true },
                randomTrack: { type: Type.BOOLEAN, nullable: true },
                nextTrack: { type: Type.BOOLEAN, nullable: true },
                articleIndex: { type: Type.INTEGER, nullable: true },
                readAloud: { type: Type.BOOLEAN, nullable: true },
                openExternalChrome: { type: Type.BOOLEAN, nullable: true },
                query: { type: Type.STRING, nullable: true },
                service: { type: Type.STRING, nullable: true },
                autoRedirect: { type: Type.BOOLEAN, nullable: true },
                codeOnly: { type: Type.BOOLEAN, nullable: true },
                app: { type: Type.STRING, nullable: true },
                contactName: { type: Type.STRING, nullable: true },
              },
              required: ['type'],
            },
          },
        },
        required: ['replyText', 'actions'],
      };

      const runCommandModel = async (
        model: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen',
        thinkingLevel: ThinkingLevel
      ) => {
        return ai.models.generateContent({
          model,
          contents: commandPrompt,
          config: {
            thinkingConfig: { thinkingLevel },
            responseMimeType: 'application/json',
            responseSchema: commandSchema,
          },
        });
      };

      let response;
      try {
        response = await runCommandModel('gemini-3.1-flash-lite', ThinkingLevel.MINIMAL);
      } catch (primaryErr: any) {
        console.warn(
          'Command primary model (gemini-3.1-flash-lite) failed, retrying with gemini-4-hydrogen:',
          primaryErr?.message
        );
        response = await runCommandModel('gemini-4-hydrogen', ThinkingLevel.LOW);
      }

      let parsed = parseModelJsonObject<{ replyText?: string; actions?: any[] }>(response.text);
      if (!parsed || (!parsed.replyText?.trim() && (!Array.isArray(parsed.actions) || parsed.actions.length === 0))) {
        try {
          const fallbackResp = await runCommandModel('gemini-4-hydrogen', ThinkingLevel.LOW);
          parsed = parseModelJsonObject<{ replyText?: string; actions?: any[] }>(fallbackResp.text);
        } catch (fallbackErr: any) {
          console.warn('Command fallback model failed:', fallbackErr?.message);
        }
      }

      const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
      let replyText = typeof parsed?.replyText === 'string' ? parsed.replyText.trim() : '';
      if (!replyText && actions.length > 0) {
        replyText = isDeLang ? 'Ich führe deinen Befehl aus.' : 'Już wykonuję polecenie.';
      }
      if (!replyText) {
        return res.status(502).json({
          error: isDeLang
            ? 'Das KI-Modell hat eine leere Antwort zurückgegeben. Bitte versuche es erneut.'
            : 'Model AI zwrócił pustą odpowiedź. Spróbuj ponownie.',
        });
      }

      res.json({ replyText, actions });
    } catch (error: any) {
      const msgStr = String(error?.message || '');
      const isQuota = msgStr.includes('429') || msgStr.includes('RESOURCE_EXHAUSTED');
      const rawT = String(req.body?.transcript || '');
      const cleanT = req.body?.codeOnly
        ? stripHyphensForCodeOnly(rawT)
        : sanitizeCodeTokensInQuery(rawT);
      const lower = cleanT.toLowerCase();
      const isDe = req.body?.language === 'de';

      if (isQuota && cleanT) {
        if (/(bajk|story|märchen)/.test(lower)) {
          return res.json({
            replyText: isDe ? 'Ich erzähle dir ein Märchen.' : 'Już opowiadam bajkę od A do Z.',
            actions: [{ type: 'read_story', topic: cleanT }],
          });
        }
        if (/(zamknij|wróć|wroc|cofnij|schließe|zurück)/.test(lower)) {
          const targetTab = /(nocleg|hotel|unterkünf)/.test(lower)
            ? 'stays'
            : /(przejazd|tras|verkehr|esban|s-bahn)/.test(lower)
              ? 'transit'
              : /(asystent|assistent)/.test(lower)
                ? 'assistant'
                : undefined;
          return res.json({
            replyText: isDe
              ? 'Ich schließe den Tab.'
              : 'Zamykam zakładkę i przechodzę dalej.',
            actions: [{ type: 'close_tab', ...(targetTab ? { targetTab } : {}) }],
          });
        }
        if (/(chrome|przegl[ąa]dark|browser)/.test(lower)) {
          if (/(wy[łl][ąa]cz|zamknij|zatrzymaj|schlie[ßs]e|aus)/.test(lower)) {
            return res.json({
              replyText: isDe
                ? 'Ich habe den Browser geschlossen und warte auf weitere Befehle.'
                : 'Wyłączyłem przeglądarkę. Czekam na kolejne polecenia.',
              actions: [{ type: 'close_browser' }],
            });
          }
          return res.json({
            replyText: isDe ? 'Ich öffne den Browser.' : 'Włączam przeglądarkę.',
            actions: [{ type: 'open_browser', openExternalChrome: /chrome/.test(lower) }],
          });
        }
        if (/youtube/.test(lower)) {
          if (/(wy[łl][ąa]cz|zamknij|zatrzymaj|schlie[ßs]e|aus|stop)/.test(lower)) {
            return res.json({
              replyText: isDe
                ? 'Ich habe YouTube ausgeschaltet und warte auf weitere Befehle.'
                : 'Wyłączyłem YouTube. Czekam na kolejne polecenia.',
              actions: [{ type: 'close_youtube' }],
            });
          }
          const isMusic = /youtube\s*music/.test(lower);
          const parsedYt = parseYoutubeTrackRequest(cleanT);
          return res.json({
            replyText: isDe
              ? `Ich öffne ${isMusic ? 'YouTube Music' : 'YouTube'}.`
              : `Uruchamiam ${isMusic ? 'YouTube Music' : 'YouTube'}${parsedYt.cleanQuery ? ` dla ${parsedYt.cleanQuery}` : ''}.`,
            actions: [
              {
                type: 'open_youtube',
                service: isMusic ? 'youtube_music' : 'youtube',
                ...(parsedYt.cleanQuery ? { query: parsedYt.cleanQuery } : {}),
                ...(parsedYt.trackIdx ? { trackIndex: parsedYt.trackIdx } : {}),
                ...(parsedYt.isRandomTrack ? { randomTrack: true } : {}),
              },
            ],
          });
        }
        if (/(pizza|döner|doner|kebab|jedzen|restaurac|essen)/.test(lower)) {
          const cat = lower.includes('pizza')
            ? 'pizza'
            : /kebab|döner|doner/.test(lower)
              ? 'doner'
              : 'all';
          return res.json({
            replyText: isDe
              ? 'Ich suche passende Restaurants für dich.'
              : 'Wyszukuję restauracje w zakładce Jedzenie.',
            actions: [{ type: 'search_food', category: cat }],
          });
        }
        if (/(nocleg|hotel|pokój|pokoj|zimmer|unterkunft)/.test(lower)) {
          return res.json({
            replyText: isDe
              ? 'Ich öffne die Unterkunftssuche.'
              : 'Otwieram wyszukiwanie noclegów i pokoi.',
            actions: [{ type: 'search_stays', stayType: 'all' }],
          });
        }
        if (/(esban|s-bahn|sbahn|paliw|stacj|sprit|benzin|diesel|trasa|autem|samochod|auto|pociąg|zug|bus)/.test(lower)) {
          const mode = /(esban|s-bahn|sbahn)/.test(lower)
            ? 'sbahn'
            : /(paliw|sprit|benzin|diesel)/.test(lower)
              ? 'fuel'
              : /(autem|samochod|auto|route)/.test(lower)
                ? 'car'
                : /bus/.test(lower)
                  ? 'buses'
                  : 'trains';
          return res.json({
            replyText: isDe
              ? 'Ich öffne das Verkehrs- und Kraftstofffenster.'
              : 'Otwieram okno Przejazdy i sprawdzam dane.',
            actions: [{ type: 'search_transit', mode, query: cleanT }],
          });
        }
        return res.json({
          replyText: isDe
            ? `Ich suche im Web nach „${cleanT}”.`
            : `Przeszukuję internet dla „${cleanT}”.`,
          actions: [
            {
              type: 'web_search',
              query: cleanT,
              codeOnly: Boolean(req.body?.codeOnly),
            },
          ],
        });
      }

      console.error('Command error:', error);
      const friendly = formatFriendlyApiError(
        error,
        'Nie udało się przetworzyć polecenia głosowego.'
      );
      res.status(friendly.status).json({ error: friendly.message });
    }
  });

  // ---------------------------------------------------------------------------
  // 6. TTS (Female: Kore ~30yo subtle | Male: Charon ~30yo calm, PL & DE)
  // ---------------------------------------------------------------------------
  app.post('/api/assistant/tts', async (req, res) => {
    try {
      const { text, voiceGender = 'female_kore', language = 'pl' } = req.body as {
        text: string;
        voiceGender?: string;
        language?: 'pl' | 'de';
      };
      const cleanText = String(text || '').trim();
      if (!cleanText) {
        return res.status(400).json({ error: 'Brak tekstu do syntezy mowy.' });
      }

      const ai = getAiClient();
      const voiceCfg = resolveVoiceConfig(voiceGender);
      const style = language === 'de' ? voiceCfg.ttsStyleDe : voiceCfg.ttsStylePl;

      const synthesizeWithVoice = async (
        prebuiltVoice: string,
        includeStyle = true
      ): Promise<{ audioBase64: string; mimeType: string }> => {
        const part: any = includeStyle
          ? { text: cleanText, speechMetadata: { style } }
          : { text: cleanText };
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [part],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: prebuiltVoice },
              },
            },
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const audioPart = parts.find((p: any) => p?.inlineData?.data);
        const base64Audio = audioPart?.inlineData?.data;
        if (!base64Audio) {
          throw new Error('Model TTS zwrócił pustą odpowiedź audio.');
        }
        return {
          audioBase64: base64Audio,
          mimeType: audioPart?.inlineData?.mimeType || 'audio/wav',
        };
      };

      let usedVoice = voiceCfg.voiceName;
      let result: { audioBase64: string; mimeType: string };
      try {
        result = await synthesizeWithVoice(usedVoice, true);
      } catch (voiceErr: any) {
        console.warn(`TTS primary attempt failed (${usedVoice}):`, voiceErr?.message);
        if (usedVoice === 'Orus') {
          usedVoice = 'Charon';
          result = await synthesizeWithVoice(usedVoice, true);
        } else {
          // Retry once without speechMetadata in case style directive caused empty audio
          result = await synthesizeWithVoice(usedVoice, false);
        }
      }

      res.json({
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
        voiceName: usedVoice,
      });
    } catch (error: any) {
      console.error('TTS error:', error);
      const friendly = formatFriendlyApiError(
        error,
        'Błąd syntezy głosu Miękiszona.'
      );
      res.status(friendly.status).json({ error: friendly.message });
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Audio Transcription (gemini-3.5-transcribe with gemini-4-hydrogen fallback)
  // ---------------------------------------------------------------------------
  app.post('/api/assistant/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/wav', language = 'pl' } = req.body as {
        audioBase64: string;
        mimeType?: string;
        language?: 'pl' | 'de';
      };
      if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length < 32) {
        return res.status(400).json({ error: 'Brak lub zbyt krótkie nagranie audio.' });
      }

      const ai = getAiClient();
      const cleanMimeType = normalizeAudioMimeType(mimeType);
      const transcribePrompt =
        language === 'de'
          ? 'Transkribiere diese Sprachaufnahme exakt (Deutsch oder Polnisch, je nach gesprochener Sprache). Gib nur den reinen gesprochenen Text ohne Kommentare zurück. Wenn nur Stille oder Rauschen zu hören ist, gib einen leeren Text zurück.'
          : 'Transkrybuj dokładnie tę wypowiedź (po polsku lub po niemiecku, zależnie od mowy). Zwróć sam wypowiedziany tekst bez komentarzy. Jeśli słychać wyłącznie ciszę lub szum, zwróć pusty tekst.';

      const runTranscribe = (model: 'gemini-3.5-transcribe' | 'gemini-4-hydrogen') =>
        ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: cleanMimeType,
                  data: audioBase64,
                },
              },
              {
                text: transcribePrompt,
              },
            ],
          },
          ...(model === 'gemini-4-hydrogen'
            ? { config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } }
            : {}),
        });

      let response;
      try {
        response = await runTranscribe('gemini-3.5-transcribe');
      } catch (primaryErr: any) {
        console.warn(
          'Transcribe primary model (gemini-3.5-transcribe) failed, retrying with gemini-4-hydrogen:',
          primaryErr?.message
        );
        response = await runTranscribe('gemini-4-hydrogen');
      }

      const rawText = (response.text ?? '').trim();
      const cleanedText = /^(\[?\s*(cisza|szum|brak mowy|silence|no speech|stille)\s*\]?|\.{2,})$/i.test(
        rawText
      )
        ? ''
        : rawText;

      res.json({
        text: cleanedText,
        empty: !cleanedText,
      });
    } catch (error: any) {
      console.error('Transcribe error:', error);
      const friendly = formatFriendlyApiError(
        error,
        'Błąd transkrypcji nagrania głosowego.'
      );
      res.status(friendly.status).json({ error: friendly.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Vite Middleware (Dev) or Static Assets (Prod) + WebSocket Live API
  // ---------------------------------------------------------------------------
  const server = http.createServer(app);

  if (!useStaticDist) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        watch: null,
        ws: {
          server,
          path: '/__vite_ws',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (!fs.existsSync(distIndexPath)) {
      console.warn(
        `[Miekiszon] Brak katalogu dist/ (${distIndexPath}). Uruchom najpierw "npm run build", aby serwować produkcyjny frontend.`
      );
    }
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      if (/\.[a-z0-9]{1,8}$/i.test(req.path)) {
        return res.status(404).end();
      }
      if (!fs.existsSync(distIndexPath)) {
        return res
          .status(503)
          .send('Frontend build not found. Run "npm run build" before starting the server.');
      }
      res.sendFile(distIndexPath);
    });
  }

  // Gemini Live API WebSocket Bridge on /api/live
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = (request.url || '').split('?')[0];
    if (urlPath === '/api/live' || urlPath === '/api/live/') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  const liveTools: FunctionDeclaration[] = [
    {
      name: 'navigateToTab',
      description:
        'Przełącza widok gdy użytkownik poprosi o otwarcie konkretnej zakładki (assistant = Asystent, food = Jedzenie, stays = Noclegi, transit = Przejazdy). Podczas zwykłej rozmowy o jedzeniu pozostań w zakładce Jedzenie; przełączaj z niej tylko wtedy, gdy użytkownik wyraźnie poprosi o powrót lub przejście do innej zakładki.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          tab: {
            type: Type.STRING,
            description: 'Jedna z zakładek: assistant, food, stays, transit',
          },
        },
        required: ['tab'],
      },
    },
    {
      name: 'closeOrReturnTab',
      description:
        'Zamyka bieżącą zakładkę lub okno (np. Jedzenie, Noclegi, Przejazdy) i wraca do poprzedniego widoku albo od razu przechodzi do wskazanej przez użytkownika zakładki (targetTab).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetTab: {
            type: Type.STRING,
            description: 'Opcjonalna docelowa zakładka: assistant, food, stays, transit',
          },
        },
      },
    },
    {
      name: 'setAssistantLanguage',
      description: 'Zmienia język rozmowy asystenta między polskim (pl) a niemieckim (de).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          language: { type: Type.STRING, description: 'pl | de' },
        },
        required: ['language'],
      },
    },
    {
      name: 'searchFoodGermany',
      description:
        'Wyszukuje restauracje po kodzie pocztowym, mieście lub GPS w Niemczech oraz innych krajach (np. Polska, Austria, Francja) i utrzymuje widok w zakładce Jedzenie (food). Dla Niemiec usuń myślniki z kodu pocztowego.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: { type: Type.STRING, description: 'Kod pocztowy lub miasto (niemieckie kody bez myślników).' },
          country: { type: Type.STRING, description: 'Opcjonalny kraj (np. DE, PL, FR, AT).' },
          category: { type: Type.STRING, description: 'all, doner, pizza, chinese, near_post' },
        },
        required: ['category'],
      },
    },
    {
      name: 'searchStaysGermany',
      description:
        'Wyszukuje noclegi (hotele, apartamenty, pokoje, Booking/Airbnb) po kodzie pocztowym lub mieście w Niemczech i innych krajach oraz otwiera zakładkę Noclegi.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: { type: Type.STRING, description: 'Kod pocztowy lub miasto (niemieckie kody bez myślników).' },
          country: { type: Type.STRING, description: 'Opcjonalny kraj (np. DE, PL, AT, FR).' },
          stayType: { type: Type.STRING, description: 'all, hotel, apartment, budget' },
        },
        required: ['stayType'],
      },
    },
    {
      name: 'autoBookStay',
      description:
        'Automatycznie wyszukuje i przygotowuje rezerwację najlepszego dostępnego noclegu w wybranym kraju lub po kodzie pocztowym.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: { type: Type.STRING, description: 'Miasto lub kod pocztowy (niemieckie kody bez myślników)' },
          country: { type: Type.STRING, description: 'Opcjonalny kraj (np. DE, PL)' },
          stayName: { type: Type.STRING, description: 'Opcjonalna nazwa hotelu' },
          guests: { type: Type.INTEGER, description: 'Liczba gości' },
        },
      },
    },
    {
      name: 'checkTransitOrFuel',
      description:
        'Sprawdza rozkład jazdy pociągów (trains), S-Bahn / esbanów (sbahn), autobusów (buses), trasę jazdy samochodem (car) lub aktualne ceny paliw (fuel) w Niemczech oraz innych krajach po kodzie pocztowym lub mieście i otwiera zakładkę Przejazdy.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          mode: { type: Type.STRING, description: 'trains | sbahn | buses | car | fuel' },
          from: { type: Type.STRING, description: 'Punkt początkowy lub kod pocztowy (niemieckie bez myślników)' },
          to: { type: Type.STRING, description: 'Cel podróży lub kod pocztowy' },
          country: { type: Type.STRING, description: 'Opcjonalny kraj (np. DE, PL)' },
          query: { type: Type.STRING, description: 'Pełne zapytanie' },
        },
        required: ['mode'],
      },
    },
    {
      name: 'searchWebAndPlaces',
      description:
        'Przeszukuje internet, miejsca w Google oraz kody bez myślników i może przekierować użytkownika na stronę internetową.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: 'Fraza lub kod do wyszukania' },
          autoRedirect: {
            type: Type.BOOLEAN,
            description: 'Ustaw true jeśli użytkownik chce zostać bezpośrednio przekierowany na stronę internetową.',
          },
          codeOnly: {
            type: Type.BOOLEAN,
            description: 'Ustaw true jeśli użytkownik szuka kodu lub niemieckiego PLZ bez myślników.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'dialPhoneNumber',
      description:
        'Dzwoni do wskazanego kontaktu z listy kontaktów lub lokalu z wyników wyszukiwania.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          target: { type: Type.STRING, description: 'Imię kontaktu, nazwa lokalu lub "first".' },
        },
        required: ['target'],
      },
    },
    {
      name: 'prepareWhatsappMessage',
      description:
        'Przygotowuje i uruchamia wysłanie wiadomości WhatsApp do wybranej osoby lub grupy bez potrzeby osobnej zakładki.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          message: { type: Type.STRING, description: 'Treść wiadomości po polsku.' },
          recipientFilter: { type: Type.STRING, description: 'Nazwa odbiorcy lub "all".' },
        },
        required: ['message'],
      },
    },
    {
      name: 'setAlarm',
      description: 'Ustawia budzik na określoną godzinę (HH:MM) oraz uruchamia zegar.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          time: { type: Type.STRING, description: 'Godzina w formacie HH:MM' },
          label: { type: Type.STRING, description: 'Opcjonalna nazwa budzika' },
        },
        required: ['time'],
      },
    },
    {
      name: 'deleteAlarm',
      description: 'Usuwa ustawiony budzik po godzinie/nazwie albo wszystkie budziki.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          time: { type: Type.STRING, description: 'Godzina HH:MM budzika do usunięcia' },
          label: { type: Type.STRING, description: 'Nazwa budzika do usunięcia' },
          all: { type: Type.BOOLEAN, description: 'true aby usunąć wszystkie budziki' },
        },
      },
    },
    {
      name: 'setReminder',
      description: 'Ustawia powiadomienie za określoną liczbę minut lub o danej godzinie.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          delayMinutes: { type: Type.INTEGER, description: 'Liczba minut do powiadomienia' },
          time: { type: Type.STRING, description: 'Godzina HH:MM' },
          text: { type: Type.STRING, description: 'Treść powiadomienia' },
        },
        required: ['text'],
      },
    },
    {
      name: 'deleteReminder',
      description: 'Usuwa ustawione powiadomienie po treści albo wszystkie powiadomienia.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: 'Fragment tekstu powiadomienia do usunięcia' },
          all: { type: Type.BOOLEAN, description: 'true aby usunąć wszystkie powiadomienia' },
        },
      },
    },
    {
      name: 'tellOrContinueStory',
      description:
        'Opowiada kompletną bajkę od A do Z płynnym głosem bez zacinania, wstrzymuje ją na przerwanie lub kontynuuje dokładnie od przerwanego miejsca.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: {
            type: Type.STRING,
            description: 'start (nowa bajka od A do Z) | continue (kontynuuj przerwaną) | pause',
          },
          topic: { type: Type.STRING, description: 'Opcjonalny temat bajki przy action="start"' },
        },
        required: ['action'],
      },
    },
    {
      name: 'openYouTubeMusic',
      description:
        'Masz pełne uprawnienia: uruchamia YouTube lub YouTube Music dla podanego aktora, wykonawcy lub zapytania, wyszukuje kawałki i odtwarza wybrany numer utworu (np. drugi utwór = trackIndex: 2) albo losowy/dostępny utwór (randomTrack: true).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          service: {
            type: Type.STRING,
            description: 'youtube_music (YouTube Music) lub youtube (YouTube)',
          },
          query: {
            type: Type.STRING,
            description: 'Czysta nazwa aktora, wykonawcy lub utworu (np. "Michele Morrone")',
          },
          trackIndex: {
            type: Type.INTEGER,
            description: 'Numer utworu do odtworzenia (1-based, np. 2 dla drugiego utworu)',
          },
          randomTrack: {
            type: Type.BOOLEAN,
            description: 'true aby wybrać i uruchomić jeden z dostępnych kawałków tego aktora/wykonawcy',
          },
        },
      },
    },
    {
      name: 'selectYouTubeTrack',
      description:
        'Wybiera i odtwarza N-ty utwór (np. 2 dla drugiego) albo inny dostępny kawałek (randomTrack/nextTrack) z otwartej listy YouTube.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          trackIndex: { type: Type.INTEGER, description: 'Numer utworu od 1 (np. 2 = drugi utwór)' },
          randomTrack: { type: Type.BOOLEAN, description: 'true aby wybrać losowy dostępny utwór' },
          nextTrack: { type: Type.BOOLEAN, description: 'true aby przełączyć na inny kawałek' },
        },
      },
    },
    {
      name: 'closeYouTube',
      description:
        'Wyłącza / zamyka odtwarzacz YouTube w aplikacji, pozostawiając asystenta aktywnego i gotowego na dalsze polecenia użytkownika.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: 'openBrowser',
      description:
        'Włącza głosowo przeglądarkę w aplikacji i opcjonalnie od razu wyszukuje w niej artykuły, wiadomości lub strony na podany temat.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'Opcjonalny temat artykułów lub zapytanie do wyszukania w przeglądarce',
          },
          openExternalChrome: {
            type: Type.BOOLEAN,
            description: 'Ustaw true jeśli użytkownik wyraźnie prosi też o aplikację Google Chrome na telefonie',
          },
        },
      },
    },
    {
      name: 'selectBrowserArticle',
      description:
        'Otwiera N-ty artykuł z wyników w przeglądarce (1-based, np. 1 = pierwszy artykuł) i opcjonalnie czyta go na głos.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          articleIndex: { type: Type.INTEGER, description: 'Numer artykułu na liście od 1' },
          readAloud: { type: Type.BOOLEAN, description: 'true aby przeczytać artykuł na głos' },
        },
        required: ['articleIndex'],
      },
    },
    {
      name: 'closeArticle',
      description: 'Zamyka aktualnie czytany artykuł i wraca do listy wyników w przeglądarce.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: 'closeBrowser',
      description:
        'Wyłącza / zamyka przeglądarkę (oraz okna zewnętrzne) poprzez połączenie głosowe, pozostawiając asystenta aktywnego i gotowego na dalsze polecenia.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    {
      name: 'manageCalculator',
      description: 'Uruchamia lub zamyka kalkulator oraz opcjonalnie oblicza podane wyrażenie.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: 'open | close' },
          expression: { type: Type.STRING, description: 'Opcjonalne działanie matematyczne np. 25*4' },
        },
        required: ['action'],
      },
    },
    {
      name: 'manageNotepad',
      description:
        'Uruchamia lub zamyka notatnik, wpisuje tekst do notatnika albo usuwa notatki.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: 'open | write | delete | close' },
          text: { type: Type.STRING, description: 'Treść do wpisania do notatnika lub usunięcia' },
          all: { type: Type.BOOLEAN, description: 'true aby usunąć wszystkie notatki' },
        },
        required: ['action'],
      },
    },
    {
      name: 'openPhoneApp',
      description:
        'Masz pełne uprawnienia do uruchamiania aplikacji w telefonie: chrome (Google Chrome), youtube_music (YouTube Music), youtube (YouTube), whatsapp, browser, maps, phone, clock, booking, spotify, calendar.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          app: {
            type: Type.STRING,
            description:
              'chrome | youtube_music | youtube | whatsapp | browser | maps | phone | clock | booking | spotify | calendar',
          },
          query: { type: Type.STRING, description: 'Opcjonalne zapytanie lub adres URL' },
          contactName: { type: Type.STRING, description: 'Opcjonalne imię kontaktu dla WhatsApp' },
        },
        required: ['app'],
      },
    },
  ];

  wss.on('connection', async (clientWs: WebSocket, req) => {
    let liveSession: any = null;
    let isSessionReady = false;
    let clientClosed = false;
    const pendingMessages: Array<{
      type?: string;
      audio?: string;
      video?: string;
      text?: string;
    }> = [];

    const reqUrl = new URL(req.url || '/api/live', 'http://localhost');
    const voiceCfg = resolveVoiceConfig(reqUrl.searchParams.get('voice'));
    const langParam = reqUrl.searchParams.get('lang') === 'de' ? 'de' : 'pl';
    const voiceName = voiceCfg.voiceName;
    const personaInstruction = langParam === 'de' ? voiceCfg.personaDe : voiceCfg.personaPl;

    const sendToClient = (payload: Record<string, any>) => {
      if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(JSON.stringify(payload));
        } catch {
          // ignore send on closing socket
        }
      }
    };

    // WebSocket keepalive ping to keep long-lived mobile/browser voice sessions stable over proxies
    const pingTimer = setInterval(() => {
      if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.ping();
        } catch {
          // ignore
        }
      }
    }, 15000);

    const dispatchInputToLive = (msg: {
      type?: string;
      audio?: string;
      video?: string;
      text?: string;
    }) => {
      if (!liveSession || !isSessionReady) return;
      try {
        if (msg.type === 'audio_end') {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        } else if (msg.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.video) {
          liveSession.sendRealtimeInput({
            video: { data: msg.video, mimeType: 'image/jpeg' },
          });
        } else if (msg.text) {
          liveSession.sendRealtimeInput({ text: msg.text });
        }
      } catch (sendErr: any) {
        console.warn('Live sendRealtimeInput error:', sendErr?.message);
        const friendly = formatFriendlyApiError(
          sendErr,
          'Błąd przesyłania głosu do sesji Gemini Live.'
        );
        sendToClient({ type: 'error', status: friendly.status, message: friendly.message });
      }
    };

    const flushPending = () => {
      if (!liveSession || !isSessionReady) return;
      while (pendingMessages.length > 0) {
        const msg = pendingMessages.shift()!;
        dispatchInputToLive(msg);
      }
    };

    clientWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') {
          sendToClient({ type: 'pong', ts: Date.now() });
          return;
        }
        if (!liveSession || !isSessionReady) {
          if (pendingMessages.length < 40) {
            pendingMessages.push(msg);
          }
          return;
        }
        dispatchInputToLive(msg);
      } catch (err) {
        console.error('Client WS message parse error:', err);
      }
    });

    const connectLiveUpstream = async (
      targetVoiceName: string,
      targetModel = 'gemini-3.8-live'
    ) => {
      const ai = getAiClient();
      return ai.live.connect({
        model: targetModel,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: targetVoiceName },
            },
          },
          tools: [{ functionDeclarations: liveTools }],
          systemInstruction:
            langParam === 'de'
              ? `${personaInstruction} Antworte blitzschnell, direkt und maximal in einem kurzen Satz und rufe sofort das passende Tool auf! Du suchst Essen (searchFoodGermany), Unterkünfte & Zimmer (searchStaysGermany, autoBookStay), allgemeine Websuche/Artikel (openBrowser, searchWebAndPlaces, selectBrowserArticle, closeArticle) sowie Verkehr (Züge, S-Bahn mode="sbahn", Busse, Autoroute, Kraftstoffpreise) per checkTransitOrFuel weltweit nach Postleitzahl oder Stadt. WICHTIG: Bei deutschen Postleitzahlen ("w Niemczech", "Deutschland", "DE", "PLZ") IMMER alle Bindestriche entfernen (z. B. 10-115 -> 10115) und country="DE" setzen. Du steuerst YouTube inkl. Schauspieler-/Künstlersuche (openYouTubeMusic mit sauberem Namen in query und randomTrack=true oder trackIndex=2), Titelwechsel (selectYouTubeTrack) und Ausschalten von YouTube (closeYouTube), sowie den Sprachbrowser: Browser öffnen (openBrowser), Artikel suchen (openBrowser/searchWebAndPlaces), Artikel öffnen/vorlesen (selectBrowserArticle) und Browser per Sprachverbindung ausschalten (closeBrowser, während du aktiv bleibst und auf weitere Befehle wartest). Außerdem öffnest/schließt du den Rechner (manageCalculator), schreibst/löschst im Notizblock (manageNotepad), und stellst/löschst Wecker & Erinnerungen (setAlarm, deleteAlarm, setReminder, deleteReminder). MÄRCHEN-REGEL: Wenn der Nutzer ein Märchen möchte, rufe sofort tellOrContinueStory(action="start") auf; wenn er währenddessen unterbricht und später "weiter"/"kontynuuj" sagt, rufe tellOrContinueStory(action="continue") auf — so läuft das Märchen von A bis Z absolut flüssig ohne lange Pausen! Bleibe beim Suchen im aktuellen Tab.`
              : `${personaInstruction} Reaguj błyskawicznie w czasie rzeczywym: odpowiadaj maksymalnie 1 krótkim zdaniem i natychmiast wywołuj odpowiednie narzędzie! Wyszukujesz jedzenie (searchFoodGermany), noclegi i pokoje (searchStaysGermany, autoBookStay), artykuły i informacje w przeglądarce (openBrowser, searchWebAndPlaces, selectBrowserArticle, closeArticle) oraz przejazdy — pociągi, S-Bahn / esbany (mode="sbahn"), autobusy, trasę autem i ceny paliw (checkTransitOrFuel) po kodzie pocztowym lub mieście w Niemczech ORAZ innych krajach. WAŻNE: Dla niemieckiego kodu pocztowego ZAWSZE usuń myślniki (10-115 -> 10115) i podaj country="DE". Sterujesz głosowo przeglądarką: włączasz ją narzędziem openBrowser, wyszukujesz wskazane artykuły (openBrowser z query lub searchWebAndPlaces), otwierasz/czytasz wybrany artykuł (selectBrowserArticle), oraz wyłączasz przeglądarkę w trakcie połączenia głosowego narzędziem closeBrowser — pozostając gotowym na kolejne polecenia! Obsługujesz też YouTube z wyszukiwaniem po podanym aktorze/wykonawcy (openYouTubeMusic z czystym nazwiskiem aktora w query oraz randomTrack=true lub trackIndex), przełączasz utwór (selectYouTubeTrack), wyłączasz YouTube (closeYouTube), uruchamiasz/zamykasz kalkulator (manageCalculator), otwierasz notatnik i wpisujesz do niego tekst (manageNotepad), a także ustawiasz i usuwasz budziki oraz powiadomienia (setAlarm, deleteAlarm, setReminder, deleteReminder). ZASADA DLA BAJKI: Gdy użytkownik poprosi o bajkę, ZAWSZE wywołaj tellOrContinueStory(action="start") — wtedy bajka zostanie płynnie opowiedziana od A do Z! Gdy przerwie i powie "kontynuuj", wywołaj tellOrContinueStory(action="continue"). Podczas rozmowy w zakładce "food", "stays" lub "transit" POZOSTAŃ w niej.`,
        },
        callbacks: {
          onopen: () => {
            // Do NOT send { type: 'ready' } here: @google/genai still waits for setupComplete.
            // Sending ready before setupComplete hides auth/model setup errors from the client.
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientClosed || clientWs.readyState !== WebSocket.OPEN) return;

            if ((message as any).goAway) {
              isSessionReady = false;
              sendToClient({ type: 'reconnect_needed' });
              try {
                clientWs.close(4001, 'live_go_away');
              } catch {
                // ignore
              }
              return;
            }

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              sendToClient({
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }
            if (content?.outputTranscription?.text) {
              sendToClient({
                type: 'output_transcript',
                text: content.outputTranscription.text,
              });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                const mime = part.inlineData.mimeType || 'audio/pcm;rate=24000';
                const rateMatch = /rate=(\d+)/i.exec(mime);
                const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
                sendToClient({
                  type: 'audio',
                  audio: part.inlineData.data,
                  mimeType: mime,
                  sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000,
                });
              } else if (part.text && !(part as any).thought) {
                sendToClient({
                  type: 'output_text',
                  text: part.text,
                });
              }
            }

            if (content?.interrupted) {
              sendToClient({ type: 'interrupted' });
            }

            if (content?.turnComplete || (content as any)?.generationComplete) {
              sendToClient({ type: 'turn_complete' });
            }

            for (const call of message.toolCall?.functionCalls ?? []) {
              sendToClient({
                type: 'tool_action',
                name: call.name,
                args: call.args || {},
              });

              if (liveSession && isSessionReady) {
                try {
                  liveSession.sendToolResponse({
                    functionResponses: [
                      {
                        id: call.id,
                        name: call.name,
                        response: {
                          status: 'executed_in_ui',
                          message: `Wykonano akcję ${call.name} w aplikacji Miekiszon.`,
                        },
                      },
                    ],
                  });
                } catch (toolErr) {
                  console.warn('sendToolResponse failed:', toolErr);
                }
              }
            }
          },
          onerror: (err: any) => {
            console.error('Gemini Live error:', err);
            // If setup has not completed yet, let connectLiveUpstream catch/fallback handle it cleanly.
            if (!isSessionReady) return;
            isSessionReady = false;
            liveSession = null;
            const friendly = formatFriendlyApiError(
              err,
              'Błąd połączenia głosowego Gemini Live.'
            );
            sendToClient({
              type: 'error',
              status: friendly.status,
              message: friendly.message,
            });
            try {
              clientWs.close(4002, 'live_upstream_error');
            } catch {
              // ignore
            }
          },
          onclose: (ev: any) => {
            // During initial connect before setupComplete, let connectLiveUpstream reject & report real cause.
            if (!isSessionReady) return;
            isSessionReady = false;
            liveSession = null;
            if (clientClosed || clientWs.readyState !== WebSocket.OPEN) return;

            const closeCode = Number(ev?.code || 1000);
            const closeReason = String(ev?.reason || '').trim();
            if (closeCode !== 1000 && closeCode !== 1001) {
              const friendly = formatFriendlyApiError(
                { message: closeReason || `Upstream close code ${closeCode}` },
                `Połączenie z Gemini Live zostało przerwane (kod ${closeCode}).`
              );
              sendToClient({
                type: 'error',
                status: friendly.status,
                code: closeCode,
                message: friendly.message,
              });
            } else {
              sendToClient({ type: 'closed', code: closeCode });
            }
            try {
              clientWs.close(4002, 'live_upstream_closed');
            } catch {
              // ignore
            }
          },
        },
      });
    };

    try {
      const candidateModels = ['gemini-3.8-live'];
      const candidateVoices = voiceName === 'Orus' ? ['Orus', 'Charon'] : [voiceName];
      let lastConnectErr: any = null;
      let connectedModel = 'gemini-3.8-live';

      outer: for (const candidateModel of candidateModels) {
        for (const candidateVoice of candidateVoices) {
          try {
            liveSession = await connectLiveUpstream(candidateVoice, candidateModel);
            connectedModel = candidateModel;
            lastConnectErr = null;
            break outer;
          } catch (connectErr: any) {
            lastConnectErr = connectErr;
            console.warn(
              `Live connect attempt failed (${candidateModel}, ${candidateVoice}):`,
              connectErr?.message
            );
          }
        }
      }

      if (!liveSession) {
        throw lastConnectErr || new Error('Nie udało się uruchomić sesji głosowej Gemini Live.');
      }

      if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
        return;
      }

      isSessionReady = true;
      sendToClient({ type: 'ready', voice: voiceCfg.id, model: connectedModel });
      flushPending();
    } catch (error: any) {
      console.error('Live connect error:', error);
      isSessionReady = false;
      liveSession = null;
      const friendly = formatFriendlyApiError(
        error,
        'Nie udało się uruchomić sesji głosowej Miękiszona.'
      );
      sendToClient({
        type: 'error',
        status: friendly.status,
        fatal: friendly.status === 400 || friendly.status === 401 || friendly.status === 403 || friendly.status === 404,
        message: friendly.message,
      });
      if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.close(4002, 'live_connect_failed');
        } catch {
          // ignore
        }
      }
    }

    clientWs.on('close', () => {
      clientClosed = true;
      clearInterval(pingTimer);
      pendingMessages.length = 0;
      isSessionReady = false;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `Miekiszon server running on http://${HOST}:${PORT} (${useStaticDist ? 'production static' : 'vite dev'})`
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[Miekiszon] Received ${signal}, shutting down gracefully...`);
    wss.clients.forEach((client) => {
      try {
        client.close(1001, 'server_shutdown');
      } catch {
        // ignore
      }
    });
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
