export type TabId = 'assistant' | 'food' | 'stays' | 'transit' | 'tools';

export type DetachedWindowTab = 'stays' | 'transit' | null;

export type AssistantLanguage = 'pl' | 'de';

export type FoodCategory = 'all' | 'doner' | 'pizza' | 'chinese' | 'near_post';

export type StayType = 'all' | 'rooms' | 'hotel' | 'apartment' | 'budget';

export type StayPriceFilter = 'all' | 'under_60' | '60_120' | 'over_120' | 'custom';

export type TransitMode = 'trains' | 'sbahn' | 'buses' | 'fuel' | 'car';

export type VoiceGender =
  | 'female_kore'
  | 'female_aoede'
  | 'female_zephyr'
  | 'male_charon'
  | 'male_fenrir'
  | 'male_puck'
  | 'male_massimo';

export interface VoiceProfile {
  id: VoiceGender;
  gender: 'female' | 'male';
  voiceName: 'Kore' | 'Aoede' | 'Zephyr' | 'Charon' | 'Fenrir' | 'Puck' | 'Orus';
  labelPl: string;
  labelDe: string;
  styleNotePl: string;
  styleNoteDe: string;
}

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: 'female_kore',
    gender: 'female',
    voiceName: 'Kore',
    labelPl: 'Kore',
    labelDe: 'Kore',
    styleNotePl: 'ciepły, spokojny',
    styleNoteDe: 'warm, ruhig',
  },
  {
    id: 'female_aoede',
    gender: 'female',
    voiceName: 'Aoede',
    labelPl: 'Aoede',
    labelDe: 'Aoede',
    styleNotePl: 'delikatny, melodyjny',
    styleNoteDe: 'sanft, melodisch',
  },
  {
    id: 'female_zephyr',
    gender: 'female',
    voiceName: 'Zephyr',
    labelPl: 'Zephyr',
    labelDe: 'Zephyr',
    styleNotePl: 'pogodny, wyraźny',
    styleNoteDe: 'klar, freundlich',
  },
  {
    id: 'male_charon',
    gender: 'male',
    voiceName: 'Charon',
    labelPl: 'Charon',
    labelDe: 'Charon',
    styleNotePl: 'głęboki, opanowany',
    styleNoteDe: 'tief, ruhig',
  },
  {
    id: 'male_fenrir',
    gender: 'male',
    voiceName: 'Fenrir',
    labelPl: 'Fenrir',
    labelDe: 'Fenrir',
    styleNotePl: 'wyrazisty, pewny',
    styleNoteDe: 'markant, klar',
  },
  {
    id: 'male_puck',
    gender: 'male',
    voiceName: 'Puck',
    labelPl: 'Puck',
    labelDe: 'Puck',
    styleNotePl: 'żywy, przyjazny',
    styleNoteDe: 'lebendig, freundlich',
  },
  {
    id: 'male_massimo',
    gender: 'male',
    voiceName: 'Orus',
    labelPl: 'Massimo (PL)',
    labelDe: 'Massimo (PL)',
    styleNotePl: 'głęboki, zmysłowy, pewny',
    styleNoteDe: 'tief, charmant, ruhig',
  },
];

export function normalizeVoiceId(raw?: string | null): VoiceGender {
  if (raw === 'male' || raw === 'male_charon') return 'male_charon';
  if (raw === 'male_fenrir') return 'male_fenrir';
  if (raw === 'male_puck') return 'male_puck';
  if (raw === 'male_massimo' || raw === 'massimo' || raw === 'orus') return 'male_massimo';
  if (raw === 'female_aoede') return 'female_aoede';
  if (raw === 'female_zephyr') return 'female_zephyr';
  return 'female_kore';
}

export type CameraFacingMode = 'environment' | 'user';

export type LiveVideoMode = 'none' | 'camera' | 'screen';

export type PhoneAppTarget =
  | 'chrome'
  | 'youtube_music'
  | 'youtube'
  | 'maps'
  | 'whatsapp'
  | 'browser'
  | 'phone'
  | 'clock'
  | 'booking'
  | 'spotify'
  | 'calendar'
  | 'calculator'
  | 'notepad';

export interface YoutubeVideoItem {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnailUrl: string;
  watchUrl: string;
}

export interface NotepadNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  language: AssistantLanguage;
}

export interface GroundingLink {
  title: string;
  url: string;
  source: 'maps' | 'web';
  snippet?: string;
}

export interface PostOfficeInfo {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  distanceNote: string;
}

export interface FoodResult {
  id: string;
  name: string;
  category: 'doner' | 'pizza' | 'chinese' | 'other';
  categoryLabel: string;
  address: string;
  postalCode: string;
  city: string;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: string;
  openingHours: string;
  nearPostNote: string | null;
  highlight: string;
  mapsUrl: string;
}

export interface FoodSearchResponse {
  validGermany: boolean;
  message?: string;
  resolvedLocation: string;
  postOffice?: PostOfficeInfo | null;
  results: FoodResult[];
  groundingLinks: GroundingLink[];
}

export interface StayResult {
  id: string;
  name: string;
  stayType: 'hotel' | 'apartment' | 'budget' | 'rooms' | 'other';
  stayTypeLabel: string;
  address: string;
  postalCode: string;
  city: string;
  phone: string | null;
  rating: number | null;
  approxPriceEur: string;
  priceNumericEur?: number | null;
  distanceInfo: string;
  highlight: string;
  bookingUrl: string;
  airbnbUrl: string;
  hrsUrl: string;
  fewoUrl?: string;
  expediaUrl?: string;
  mapsUrl: string;
}

export interface StaysSearchResponse {
  validGermany: boolean;
  message?: string;
  resolvedLocation: string;
  results: StayResult[];
  groundingLinks: GroundingLink[];
}

export interface StayBookingRecord {
  id: string;
  confirmationCode: string;
  stayName: string;
  address: string;
  city: string;
  phone: string | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  guestName: string;
  guestEmail: string;
  approxPriceEur: string;
  status: 'confirmed' | 'pending_portal';
  bookingUrl: string;
  createdAt: string;
}

export interface TransitConnectionResult {
  id: string;
  operator: string;
  lineOrTrain: string;
  departure: string;
  arrival: string;
  duration: string;
  statusNote: string;
  priceInfo: string;
  details: string;
  bookingOrScheduleUrl: string;
}

export interface FuelStationResult {
  id: string;
  brand: string;
  stationName: string;
  address: string;
  distanceInfo: string;
  dieselEur: string | null;
  e5Eur: string | null;
  e10Eur: string | null;
  updatedNote: string;
  mapsUrl: string;
}

export interface CarRouteResult {
  id: string;
  routeName: string;
  distanceKm: string;
  durationText: string;
  highways: string;
  trafficNote: string;
  estimatedFuelCostEur: string;
  stepsSummary: string;
  directionsUrl: string;
}

export interface TransitSearchResponse {
  validGermany: boolean;
  mode: TransitMode;
  message?: string;
  resolvedQuery: string;
  summarySpeech: string;
  connections: TransitConnectionResult[];
  fuelStations: FuelStationResult[];
  carRoutes?: CarRouteResult[];
  groundingLinks: GroundingLink[];
}

export interface WebSearchResultItem {
  id: string;
  title: string;
  kind: 'place' | 'website' | 'product' | 'article';
  categoryLabel: string;
  summary: string;
  address: string | null;
  phone: string | null;
  websiteUrl: string;
  mapsUrl: string | null;
  directionsUrl: string | null;
}

export interface BrowserArticleData {
  url: string;
  title: string;
  domain: string;
  content: string;
  excerpt?: string;
}

export interface WebSearchResponse {
  query: string;
  answerSummary: string;
  primaryRedirectUrl: string | null;
  results: WebSearchResultItem[];
  groundingLinks: GroundingLink[];
}

export interface WhatsappContact {
  id: string;
  name: string;
  phone: string;
  role: string;
  selected: boolean;
  sent: boolean;
}

export interface AlarmItem {
  id: string;
  time: string;
  label: string;
  active: boolean;
  triggered?: boolean;
}

export interface ReminderItem {
  id: string;
  text: string;
  triggerAt: number;
  displayTime: string;
  triggered?: boolean;
}

export interface ExternalAppLaunch {
  title: string;
  url: string;
  fallbackUrl?: string;
  appLabel: string;
}

export type AssistantAction =
  | { type: 'navigate'; tab: TabId; detached?: boolean; explicit?: boolean }
  | { type: 'close_tab'; targetTab?: TabId }
  | { type: 'go_back'; steps?: number }
  | { type: 'set_language'; language: AssistantLanguage }
  | { type: 'search_food'; location?: string; country?: string; category: FoodCategory }
  | {
      type: 'search_stays';
      location?: string;
      country?: string;
      stayType: StayType;
      minPriceEur?: number;
      maxPriceEur?: number;
    }
  | {
      type: 'auto_book_stay';
      location?: string;
      country?: string;
      stayName?: string;
      checkIn?: string;
      checkOut?: string;
      guests?: number;
    }
  | {
      type: 'search_transit';
      mode: TransitMode;
      from?: string;
      to?: string;
      country?: string;
      query?: string;
    }
  | { type: 'web_search'; query: string; autoRedirect?: boolean; codeOnly?: boolean }
  | { type: 'dial'; target?: string }
  | {
      type: 'prepare_whatsapp';
      message?: string;
      recipientFilter?: string;
      phone?: string;
      sendNow?: boolean;
      autoClose?: boolean;
      action?: 'open' | 'send' | 'close' | 'select_all' | 'reset';
    }
  | { type: 'close_whatsapp' }
  | { type: 'read_story'; topic?: string }
  | { type: 'continue_story' }
  | { type: 'pause_story' }
  | { type: 'set_alarm'; time: string; label?: string }
  | { type: 'delete_alarm'; time?: string; label?: string; all?: boolean }
  | { type: 'set_reminder'; delayMinutes?: number; time?: string; text: string }
  | { type: 'delete_reminder'; text?: string; all?: boolean }
  | {
      type: 'open_youtube';
      query?: string;
      service?: 'youtube' | 'youtube_music';
      trackIndex?: number;
      randomTrack?: boolean;
    }
  | {
      type: 'select_youtube_track';
      trackIndex?: number;
      randomTrack?: boolean;
      nextTrack?: boolean;
    }
  | { type: 'close_youtube' }
  | {
      type: 'open_browser';
      query?: string;
      url?: string;
      openExternalChrome?: boolean;
      codeOnly?: boolean;
    }
  | {
      type: 'select_article';
      articleIndex?: number;
      titleQuery?: string;
      readAloud?: boolean;
    }
  | { type: 'close_article' }
  | { type: 'close_browser' }
  | { type: 'open_calculator'; expression?: string }
  | { type: 'close_calculator' }
  | { type: 'open_notepad' }
  | { type: 'write_note'; text: string }
  | { type: 'delete_note'; text?: string; all?: boolean }
  | { type: 'close_notepad' }
  | { type: 'open_app'; app: PhoneAppTarget; query?: string; contactName?: string }
  | { type: 'close_app'; app?: PhoneAppTarget | 'all' };

export interface CommandResponse {
  replyText: string;
  actions: AssistantAction[];
}

export interface DialTarget {
  name: string;
  phone: string;
  address?: string;
  subtitle?: string;
}
