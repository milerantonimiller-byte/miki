import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  AlarmItem,
  AssistantAction,
  AssistantLanguage,
  BrowserArticleData,
  CameraFacingMode,
  CommandResponse,
  DetachedWindowTab,
  DialTarget,
  ExternalAppLaunch,
  FoodCategory,
  FoodSearchResponse,
  LiveVideoMode,
  NotepadNote,
  ReminderItem,
  StayBookingRecord,
  StayResult,
  StayType,
  StaysSearchResponse,
  TabId,
  TransitMode,
  TransitSearchResponse,
  VOICE_PROFILES,
  VoiceGender,
  WebSearchResponse,
  WebSearchResultItem,
  WhatsappContact,
  YoutubeVideoItem,
  normalizeVoiceId,
} from './types';
import { Header } from './components/Header';
import { VoiceDock } from './components/VoiceDock';
import { FoodTab } from './components/FoodTab';
import { StaysTab } from './components/StaysTab';
import { TransitTab } from './components/TransitTab';
import { DetachedWindowModal } from './components/DetachedWindowModal';
import { AutoBookingModal } from './components/AutoBookingModal';
import { WebSearchResultsPanel } from './components/WebSearchResultsPanel';
import { WhatsappModal } from './components/WhatsappModal';
import { DialerModal } from './components/DialerModal';
import { CalculatorModal, evaluateMathExpression } from './components/CalculatorModal';
import { NotepadModal } from './components/NotepadModal';
import { YouTubePlayerPanel } from './components/YouTubePlayerPanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  GoogleFoodSearchFn,
  GooglePlacesFoodBridge,
} from './components/GooglePlacesFoodBridge';
import {
  addDaysToIso,
  buildAndroidAlarmIntentUrl,
  buildWhatsappUrl,
  clampStayDate,
  getAppLaunchInfo,
  getCurrentStayDates,
  sanitizeCodeTokensInQuery,
  sanitizePhoneForTel,
  stripHyphensForCodeOnly,
} from './utils/location';
import {
  computeRmsLevel,
  createCompatAudioContext,
  encodePcm16ChunksToWavBase64,
  float32ToPcm16Base64,
  LivePcmPlayer,
  PlayableAudioHandle,
  playBase64Wav,
  playGentleChime,
  resampleFloat32,
  StoryPlaybackStatus,
  StoryTtsPlayer,
  unlockMobileAudio,
} from './utils/audio';

async function parseApiJson<T>(res: Response, fallbackError: string): Promise<T> {
  const rawText = await res.text();
  let parsed: any = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const serverMsg =
      (parsed && typeof parsed.error === 'string' && parsed.error.trim()) ||
      (parsed && typeof parsed.message === 'string' && parsed.message.trim()) ||
      '';
    throw new Error(
      serverMsg || `${fallbackError} (HTTP ${res.status})`
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${fallbackError} (pusta lub nieprawidłowa odpowiedź serwera).`);
  }
  return parsed as T;
}

const DEFAULT_WHATSAPP_CONTACTS: WhatsappContact[] = [
  { id: 'c1', name: 'Marek Kowalski', phone: '+49 176 23456781', role: 'Kierowca', selected: true, sent: false },
  { id: 'c2', name: 'Anna Nowak', phone: '+49 151 98765432', role: 'Koordynator', selected: true, sent: false },
  { id: 'c3', name: 'Tomasz Zieliński', phone: '+49 172 55543210', role: 'Ekipa', selected: true, sent: false },
  { id: 'c4', name: 'Katarzyna Wiśniewska', phone: '+48 601 234 567', role: 'Rodzina', selected: true, sent: false },
  { id: 'c5', name: 'Piotr Wójcik', phone: '+49 160 77889900', role: 'Biuro', selected: true, sent: false },
];

const CONTACTS_STORAGE_KEY = 'miekiszon_whatsapp_contacts_v1';
const VOICE_GENDER_STORAGE_KEY = 'miekiszon_voice_gender_v1';
const LANGUAGE_STORAGE_KEY = 'miekiszon_language_v1';
const STAY_BOOKINGS_STORAGE_KEY = 'miekiszon_stay_bookings_v1';
const ALARMS_STORAGE_KEY = 'miekiszon_alarms_v1';
const REMINDERS_STORAGE_KEY = 'miekiszon_reminders_v1';
const NOTEPAD_STORAGE_KEY = 'miekiszon_notepad_notes_v1';

function getInitialGreeting(lang: AssistantLanguage): string {
  return lang === 'de'
    ? 'Bereit. Live-Gespräch starten oder Befehl eingeben.'
    : 'Gotowy. Uruchom rozmowę na żywo lub wpisz polecenie.';
}

function isValidMapsKey(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed.length < 20) return '';
  if (/MY_GOOGLE_MAPS_API_KEY|YOUR_API_KEY|REPLACE_ME|PLACEHOLDER/i.test(trimmed)) return '';
  return trimmed;
}

function parseFriendlyErrorMessage(raw: unknown, fallback: string): string {
  const msg = String(raw || '').trim();
  if (!msg) return fallback;
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return 'Przekroczono limit zapytań Gemini API (429). Spróbuj ponownie za chwilę lub sprawdź klucz/plan w Settings > Secrets.';
  }
  if (/^\s*\{.*"error"\s*:/.test(msg)) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error?.message) return String(parsed.error.message);
    } catch {
      // ignore
    }
  }
  return msg;
}

export default function App() {
  const defaultDates = getCurrentStayDates(0, 2);

  // Navigation with previousTab history for returning from detached windows
  const [activeTab, setActiveTab] = useState<TabId>('assistant');
  const [previousTab, setPreviousTab] = useState<TabId | null>(null);

  const [locationInput, setLocationInput] = useState('');
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | undefined>(
    undefined
  );
  const [isLocating, setIsLocating] = useState(false);

  // Bilingual language (pl / de) & voice gender (female / male)
  const [language, setLanguage] = useState<AssistantLanguage>(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === 'de' || saved === 'pl') return saved;
    } catch {
      // ignore
    }
    return 'pl';
  });

  const [voiceGender, setVoiceGender] = useState<VoiceGender>(() => {
    try {
      const saved = localStorage.getItem(VOICE_GENDER_STORAGE_KEY);
      if (saved) return normalizeVoiceId(saved);
    } catch {
      // ignore
    }
    return 'female_kore';
  });

  // Food state
  const [foodCategory, setFoodCategory] = useState<FoodCategory>('all');
  const [foodData, setFoodData] = useState<FoodSearchResponse | null>(null);
  const [isFoodLoading, setIsFoodLoading] = useState(false);
  const [foodError, setFoodError] = useState<string | null>(null);

  // Stays & Auto-booking state
  const [stayType, setStayType] = useState<StayType>('all');
  const [checkIn, setCheckIn] = useState(defaultDates.checkIn);
  const [checkOut, setCheckOut] = useState(defaultDates.checkOut);
  const [guests, setGuests] = useState(2);
  const [staysData, setStaysData] = useState<StaysSearchResponse | null>(null);
  const [isStaysLoading, setIsStaysLoading] = useState(false);
  const [staysError, setStaysError] = useState<string | null>(null);

  const [stayBookings, setStayBookings] = useState<StayBookingRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STAY_BOOKINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [autoBookingTarget, setAutoBookingTarget] = useState<StayResult | null>(null);
  const [isAutoBooking, setIsAutoBooking] = useState(false);

  // Transit, Car Route & Fuel state
  const [transitMode, setTransitMode] = useState<TransitMode>('trains');
  const [transitFrom, setTransitFrom] = useState('');
  const [transitTo, setTransitTo] = useState('');
  const [transitData, setTransitData] = useState<TransitSearchResponse | null>(null);
  const [isTransitLoading, setIsTransitLoading] = useState(false);
  const [transitError, setTransitError] = useState<string | null>(null);

  // WhatsApp contacts state (kept for voice-triggered messaging)
  const [whatsappContacts, setWhatsappContacts] = useState<WhatsappContact[]>(() => {
    try {
      const saved = localStorage.getItem(CONTACTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 5) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_WHATSAPP_CONTACTS;
  });
  const [whatsappMessage, setWhatsappMessage] = useState(
    'Cześć! Przesyłam aktualne informacje z trasy po Niemczech.'
  );

  // Detached separate window (Stays / Transit) & WhatsApp modal
  const [detachedWindow, setDetachedWindow] = useState<DetachedWindowTab>(null);
  const [isWhatsappModalOpen, setIsWhatsappModalOpen] = useState(false);

  // Voice-controlled Browser, Web & Article Search state
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [webSearchData, setWebSearchData] = useState<WebSearchResponse | null>(null);
  const webSearchDataRef = useRef<WebSearchResponse | null>(null);
  webSearchDataRef.current = webSearchData;
  const [isWebSearchLoading, setIsWebSearchLoading] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<BrowserArticleData | null>(null);
  const [isArticleLoading, setIsArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState<string | null>(null);

  // Dialer, alarms, reminders, notepad, calculator, YouTube & external app launch
  const [dialTarget, setDialTarget] = useState<DialTarget | null>(null);
  const [alarms, setAlarms] = useState<AlarmItem[]>(() => {
    try {
      const saved = localStorage.getItem(ALARMS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [reminders, setReminders] = useState<ReminderItem[]>(() => {
    try {
      const saved = localStorage.getItem(REMINDERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [notepadNotes, setNotepadNotes] = useState<NotepadNote[]>(() => {
    try {
      const saved = localStorage.getItem(NOTEPAD_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [isNotepadOpen, setIsNotepadOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [calculatorExpr, setCalculatorExpr] = useState('');

  const [youtubeQuery, setYoutubeQuery] = useState('');
  const [youtubeResults, setYoutubeResults] = useState<YoutubeVideoItem[]>([]);
  const [activeYoutubeVideo, setActiveYoutubeVideo] = useState<YoutubeVideoItem | null>(null);
  const [isYoutubeLoading, setIsYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  const [storyStatus, setStoryStatus] = useState<StoryPlaybackStatus>('idle');
  const [storyProgress, setStoryProgress] = useState({ currentIndex: 0, total: 0 });
  const storyPlayerRef = useRef<StoryTtsPlayer | null>(null);

  const [lastLaunchedApp, setLastLaunchedApp] = useState<ExternalAppLaunch | null>(null);

  // Google Maps Platform key & quota state
  const [mapsApiKey, setMapsApiKey] = useState<string>(() =>
    isValidMapsKey(import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)
  );
  const [isGmpQuotaExceeded, setIsGmpQuotaExceeded] = useState(false);

  // Google Places JS SDK food search bridge ref
  const googlePlacesFoodSearchRef = useRef<GoogleFoodSearchFn | null>(null);
  const handleRegisterGoogleFoodSearch = useCallback(
    (fn: GoogleFoodSearchFn | null) => {
      googlePlacesFoodSearchRef.current = fn;
    },
    []
  );

  // Assistant chat history & voice state (all conversation UI lives inside Asystent tab)
  const [isMuted, setIsMuted] = useState(false);
  const [assistantReply, setAssistantReply] = useState<string>(() =>
    getInitialGreeting(language)
  );
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [hasBufferedSpeech, setHasBufferedSpeech] = useState(false);
  const [isSpeakingTts, setIsSpeakingTts] = useState(false);
  const [isCommandLoading, setIsCommandLoading] = useState(false);

  // Live API + Camera / Screen Share state
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>(
    'idle'
  );
  const [micLevel, setMicLevel] = useState(0);
  const [videoMode, setVideoMode] = useState<LiveVideoMode>('none');
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>('environment');
  const [videoError, setVideoError] = useState<string | null>(null);

  const liveWsRef = useRef<WebSocket | null>(null);
  const liveMicStreamRef = useRef<MediaStream | null>(null);
  const liveInputCtxRef = useRef<AudioContext | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveGainRef = useRef<GainNode | null>(null);
  const livePlayerRef = useRef<LivePcmPlayer | null>(null);
  const liveInputBufRef = useRef('');
  const liveOutputBufRef = useRef('');
  const shouldStayLiveRef = useRef(false);
  const voiceTransportModeRef = useRef<'live' | 'http'>('live');
  const liveReconnectTimerRef = useRef<number | null>(null);
  const livePingTimerRef = useRef<number | null>(null);
  const wsStartupTimerRef = useRef<number | null>(null);
  const liveResponseWatchdogRef = useRef<number | null>(null);
  const liveTurnGotResponseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const wsReadyReceivedRef = useRef(false);
  const wsStartupFailuresRef = useRef(0);
  const lastMicUiUpdateRef = useRef(0);

  // Shared 16kHz PCM VAD & utterance buffer (drives end-of-speech signaling & HTTP fallback)
  const vadPreRollRef = useRef<Float32Array[]>([]);
  const vadSpeechChunksRef = useRef<Float32Array[]>([]);
  const liveLastUtteranceRef = useRef<Float32Array[]>([]);
  const vadSpeakingRef = useRef(false);
  const vadSpeechStartMsRef = useRef(0);
  const vadLastLoudMsRef = useRef(0);
  const isSpeakingTtsRef = useRef(false);
  const isProcessingHttpVoiceRef = useRef(false);

  const liveVideoStreamRef = useRef<MediaStream | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCaptureVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoFrameIntervalRef = useRef<number | null>(null);

  const activeAudioElRef = useRef<PlayableAudioHandle | null>(null);

  // Refs to avoid stale closures
  const locationRef = useRef(locationInput);
  locationRef.current = locationInput;
  const coordinatesRef = useRef(coordinates);
  coordinatesRef.current = coordinates;
  const foodDataRef = useRef(foodData);
  foodDataRef.current = foodData;
  const staysDataRef = useRef(staysData);
  staysDataRef.current = staysData;
  const contactsRef = useRef(whatsappContacts);
  contactsRef.current = whatsappContacts;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const previousTabRef = useRef(previousTab);
  previousTabRef.current = previousTab;
  const detachedWindowRef = useRef(detachedWindow);
  detachedWindowRef.current = detachedWindow;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const isLiveActiveRef = useRef(isLiveActive);
  isLiveActiveRef.current = isLiveActive;
  const liveStatusRef = useRef(liveStatus);
  liveStatusRef.current = liveStatus;
  const voiceGenderRef = useRef(voiceGender);
  voiceGenderRef.current = voiceGender;
  const languageRef = useRef(language);
  languageRef.current = language;
  const videoModeRef = useRef<LiveVideoMode>(videoMode);
  videoModeRef.current = videoMode;
  const cameraFacingRef = useRef<CameraFacingMode>(cameraFacingMode);
  cameraFacingRef.current = cameraFacingMode;
  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const notepadNotesRef = useRef(notepadNotes);
  notepadNotesRef.current = notepadNotes;
  const youtubeResultsRef = useRef(youtubeResults);
  youtubeResultsRef.current = youtubeResults;
  const youtubeQueryRef = useRef(youtubeQuery);
  youtubeQueryRef.current = youtubeQuery;
  const activeYoutubeVideoRef = useRef(activeYoutubeVideo);
  activeYoutubeVideoRef.current = activeYoutubeVideo;

  useEffect(() => {
    try {
      localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(whatsappContacts));
    } catch {
      // ignore
    }
  }, [whatsappContacts]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_GENDER_STORAGE_KEY, voiceGender);
    } catch {
      // ignore
    }
  }, [voiceGender]);

  useEffect(() => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(STAY_BOOKINGS_STORAGE_KEY, JSON.stringify(stayBookings.slice(-30)));
    } catch {
      // ignore
    }
  }, [stayBookings]);

  useEffect(() => {
    try {
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(alarms));
    } catch {
      // ignore
    }
  }, [alarms]);

  useEffect(() => {
    try {
      localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
    } catch {
      // ignore
    }
  }, [reminders]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTEPAD_STORAGE_KEY, JSON.stringify(notepadNotes));
    } catch {
      // ignore
    }
  }, [notepadNotes]);

  useEffect(() => {
    const player = new StoryTtsPlayer((st) => {
      setStoryStatus(st.status);
      setStoryProgress({ currentIndex: st.currentIndex, total: st.total });
    });
    storyPlayerRef.current = player;
    return () => {
      player.stop();
      storyPlayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    storyPlayerRef.current?.updateVoiceOrLang(voiceGender, language);
  }, [voiceGender, language]);

  useEffect(() => {
    const handleQuotaExceeded = () => setIsGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  useEffect(() => {
    if (mapsApiKey) return;
    let cancelled = false;
    fetch('/api/config/maps')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const validKey = isValidMapsKey(json?.apiKey ? String(json.apiKey) : '');
        if (!cancelled && validKey) {
          setMapsApiKey(validKey);
        }
      })
      .catch(() => {
        // ignore if unavailable
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  // Helper to switch active tab while recording previousTab
  const switchTab = useCallback((nextTab: TabId) => {
    if (activeTabRef.current !== nextTab) {
      setPreviousTab(activeTabRef.current);
      previousTabRef.current = activeTabRef.current;
      setActiveTab(nextTab);
      activeTabRef.current = nextTab;
    }
  }, []);

  // No-op helper kept for compatibility with assistant status callbacks
  const appendChatMessage = useCallback(
    (_role: 'user' | 'assistant', _text: string, _langOverride?: AssistantLanguage) => {},
    []
  );

  // Unlock Web Audio & HTML5 <audio> on the very first user tap/click on mobile devices
  useEffect(() => {
    const handleFirstGesture = () => {
      unlockMobileAudio();
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true });
    window.addEventListener('touchstart', handleFirstGesture, { passive: true });
    window.addEventListener('keydown', handleFirstGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // TTS Playback (Polish or German, Female Kore or Male Charon)
  // ---------------------------------------------------------------------------
  const speakWithMiekiszon = useCallback(
    async (
      text: string,
      langOverride?: AssistantLanguage,
      forceWhenHttpVoice = false
    ) => {
      const cleanText = text.trim();
      if (!cleanText || isMutedRef.current) return;
      if (
        isLiveActiveRef.current &&
        voiceTransportModeRef.current === 'live' &&
        !forceWhenHttpVoice
      ) {
        return;
      }

      try {
        if (activeAudioElRef.current) {
          activeAudioElRef.current.stop();
          activeAudioElRef.current = null;
        }
        setIsSpeakingTts(true);
        isSpeakingTtsRef.current = true;
        const res = await fetch('/api/assistant/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voiceGender: voiceGenderRef.current,
            language: langOverride || languageRef.current,
          }),
        });
        const json = await parseApiJson<{
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        }>(
          res,
          (langOverride || languageRef.current) === 'de'
            ? 'Sprachausgabe (TTS) fehlgeschlagen'
            : 'Błąd syntezy mowy (TTS)'
        );

        if (!json.audioBase64) {
          throw new Error(
            (langOverride || languageRef.current) === 'de'
              ? 'Der TTS-Server hat keine Audiodaten zurückgegeben.'
              : 'Serwer TTS nie zwrócił danych audio.'
          );
        }

        if (isMutedRef.current) {
          setIsSpeakingTts(false);
          isSpeakingTtsRef.current = false;
          return;
        }

        const handle = await playBase64Wav(json.audioBase64, json.mimeType || 'audio/wav');
        activeAudioElRef.current = handle;
        await handle.finished;
        if (activeAudioElRef.current === handle) {
          activeAudioElRef.current = null;
        }
        setIsSpeakingTts(false);
        isSpeakingTtsRef.current = false;
      } catch (err: any) {
        setIsSpeakingTts(false);
        isSpeakingTtsRef.current = false;
        const activeLang = langOverride || languageRef.current;
        const rawErr = String(err?.message || err || '');
        const isAutoplayBlocked =
          err?.name === 'NotAllowedError' || /autoplay|notallowed|gesture|interact/i.test(rawErr);
        setVoiceError(
          isAutoplayBlocked
            ? activeLang === 'de'
              ? 'Der Browser hat die Audiowiedergabe blockiert. Tippe auf „Erneut abspielen“.'
              : 'Przeglądarka zablokowała automatyczne odtwarzanie dźwięku. Kliknij „Odtwórz głos”.'
            : rawErr ||
                (activeLang === 'de'
                  ? 'Antwort konnte nicht vorgelesen werden.'
                  : 'Nie udało się odtworzyć odpowiedzi głosowej.')
        );
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Alarm & Reminder Ticker
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (alarms.length === 0 && reminders.length === 0) return;

    const timer = window.setInterval(() => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}`;
      const nowMs = now.getTime();

      setAlarms((prev) => {
        let changed = false;
        const next = prev.map((a) => {
          if (a.active && !a.triggered && a.time === hhmm) {
            changed = true;
            playGentleChime();
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('Budzik Miękiszon', { body: `${a.time} — ${a.label}` });
            }
            const spoken =
              languageRef.current === 'de'
                ? `Wecker klingelt für ${a.time}. ${a.label}.`
                : `Dzwoni budzik na godzinę ${a.time}. ${a.label}.`;
            void speakWithMiekiszon(spoken);
            return { ...a, triggered: true };
          }
          return a;
        });
        return changed ? next : prev;
      });

      setReminders((prev) => {
        let changed = false;
        const next = prev.map((r) => {
          if (!r.triggered && nowMs >= r.triggerAt) {
            changed = true;
            playGentleChime();
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('Powiadomienie Miękiszon', { body: r.text });
            }
            const spoken =
              languageRef.current === 'de'
                ? `Erinnerung: ${r.text}`
                : `Przypomnienie: ${r.text}`;
            void speakWithMiekiszon(spoken);
            return { ...r, triggered: true };
          }
          return r;
        });
        return changed ? next : prev;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [alarms.length, reminders.length, speakWithMiekiszon]);

  // ---------------------------------------------------------------------------
  // Search & Booking API Calls (Food, Stays, Auto-Book, Transit/Car/Fuel, Web)
  // ---------------------------------------------------------------------------
  const performFoodSearch = useCallback(
    async (
      locOverride?: string,
      catOverride?: FoodCategory,
      coordsOverride?: { lat: number; lng: number },
      countryOverride?: string
    ): Promise<FoodSearchResponse | null> => {
      const rawLoc = locOverride ?? locationRef.current;
      const loc = sanitizeCodeTokensInQuery(rawLoc, countryOverride);
      const locWithCountry =
        countryOverride && loc && !loc.toLowerCase().includes(countryOverride.toLowerCase())
          ? `${loc} ${countryOverride}`.trim()
          : loc;
      const cat = catOverride ?? foodCategory;
      const coords = coordsOverride ?? coordinatesRef.current;
      if (!loc && !coords) return null;

      setIsFoodLoading(true);
      setFoodError(null);
      try {
        // 1. Direct Google Places API (New) via Maps JS SDK (fastest, bypasses Gemini quota)
        if (googlePlacesFoodSearchRef.current) {
          const googleRes = await googlePlacesFoodSearchRef.current({
            location: locWithCountry,
            category: cat,
            coordinates: coords,
            language: languageRef.current,
          });
          if (googleRes && googleRes.results.length > 0) {
            setFoodData(googleRes);
            foodDataRef.current = googleRes;
            return googleRes;
          }
        }

        // 2. Server-side Google Places REST + Gemini Search/Maps grounding fallback
        const res = await fetch('/api/search/food', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: loc,
            country: countryOverride,
            category: cat,
            coordinates: coords,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Błąd wyszukiwania jedzenia.');
        }
        setFoodData(data);
        foodDataRef.current = data;
        return data;
      } catch (err: any) {
        setFoodError(
          parseFriendlyErrorMessage(err?.message, 'Nie udało się wyszukać restauracji.')
        );
        return null;
      } finally {
        setIsFoodLoading(false);
      }
    },
    [foodCategory]
  );

  const performStaysSearch = useCallback(
    async (
      locOverride?: string,
      typeOverride?: StayType,
      coordsOverride?: { lat: number; lng: number },
      checkInOverride?: string,
      checkOutOverride?: string,
      countryOverride?: string
    ): Promise<StaysSearchResponse | null> => {
      const loc = sanitizeCodeTokensInQuery(locOverride ?? locationRef.current, countryOverride);
      const st = typeOverride ?? stayType;
      const coords = coordsOverride ?? coordinatesRef.current;
      const validIn = clampStayDate(checkInOverride ?? checkIn);
      const rawOut = clampStayDate(checkOutOverride ?? checkOut, addDaysToIso(validIn, 2));
      const validOut = rawOut <= validIn ? addDaysToIso(validIn, 1) : rawOut;
      if (!loc && !coords) return null;

      setIsStaysLoading(true);
      setStaysError(null);
      try {
        const res = await fetch('/api/search/stays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: loc,
            country: countryOverride,
            stayType: st,
            checkIn: validIn,
            checkOut: validOut,
            guests,
            coordinates: coords,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Błąd wyszukiwania noclegów.');
        }
        setStaysData(data);
        staysDataRef.current = data;
        return data;
      } catch (err: any) {
        setStaysError(
          parseFriendlyErrorMessage(err?.message, 'Nie udało się wyszukać noclegów.')
        );
        return null;
      } finally {
        setIsStaysLoading(false);
      }
    },
    [stayType, checkIn, checkOut, guests]
  );

  const performAutoBookStay = useCallback(
    async (params: {
      stay?: StayResult;
      location?: string;
      country?: string;
      checkIn?: string;
      checkOut?: string;
      guests?: number;
      guestName?: string;
      guestEmail?: string;
    }) => {
      setIsAutoBooking(true);
      try {
        const res = await fetch('/api/stays/auto-book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stay: params.stay,
            location: sanitizeCodeTokensInQuery(params.location || locationRef.current, params.country),
            country: params.country,
            checkIn: params.checkIn || checkIn,
            checkOut: params.checkOut || checkOut,
            guests: params.guests || guests,
            guestName: params.guestName || 'Gość Miękiszon',
            guestEmail: params.guestEmail || 'Morfi28@gmx.de',
            coordinates: coordinatesRef.current,
            language: languageRef.current,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Błąd automatycznej rezerwacji noclegu.');
        }

        if (json.booking) {
          setStayBookings((prev) => [json.booking, ...prev]);
        }
        setAutoBookingTarget(null);
        switchTab('stays');
        setDetachedWindow('stays');

        if (json.summarySpeech) {
          setAssistantReply(json.summarySpeech);
          appendChatMessage('assistant', json.summarySpeech);
          void speakWithMiekiszon(json.summarySpeech);
        }
        return json;
      } catch (err: any) {
        const errMsg =
          err?.message || 'Nie udało się wykonać automatycznej rezerwacji noclegu.';
        setStaysError(errMsg);
        setAssistantReply(errMsg);
        appendChatMessage('assistant', errMsg);
        return null;
      } finally {
        setIsAutoBooking(false);
      }
    },
    [checkIn, checkOut, guests, switchTab, appendChatMessage, speakWithMiekiszon]
  );

  const performTransitSearch = useCallback(
    async (
      modeOverride?: TransitMode,
      fromOverride?: string,
      toOverride?: string,
      queryOverride?: string,
      countryOverride?: string
    ): Promise<TransitSearchResponse | null> => {
      const m = modeOverride ?? transitMode;
      const fromVal = sanitizeCodeTokensInQuery(
        (fromOverride ?? transitFrom) || locationRef.current,
        countryOverride
      );
      const toVal = sanitizeCodeTokensInQuery(toOverride ?? transitTo, countryOverride);
      const cleanQuery = sanitizeCodeTokensInQuery(queryOverride || '', countryOverride);
      const coords = coordinatesRef.current;

      setIsTransitLoading(true);
      setTransitError(null);
      try {
        const res = await fetch('/api/search/transit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: m,
            from: fromVal,
            to: toVal,
            country: countryOverride,
            query: cleanQuery,
            location: sanitizeCodeTokensInQuery(locationRef.current, countryOverride),
            coordinates: coords,
            language: languageRef.current,
          }),
        });
        const data: TransitSearchResponse = await res.json();
        if (!res.ok) {
          throw new Error((data as any).error || 'Błąd pobierania rozkładu/trasy/cen paliw.');
        }
        setTransitData(data);
        return data;
      } catch (err: any) {
        setTransitError(
          parseFriendlyErrorMessage(err?.message, 'Nie udało się pobrać danych przejazdów.')
        );
        return null;
      } finally {
        setIsTransitLoading(false);
      }
    },
    [transitMode, transitFrom, transitTo]
  );

  const performWebSearch = useCallback(
    async (query: string, codeOnly = false): Promise<WebSearchResponse | null> => {
      const normalizedQuery = codeOnly
        ? stripHyphensForCodeOnly(query)
        : sanitizeCodeTokensInQuery(query);
      if (!normalizedQuery) return null;
      setIsBrowserOpen(true);
      setActiveArticle(null);
      setArticleError(null);
      setIsWebSearchLoading(true);
      setWebSearchError(null);
      try {
        const res = await fetch('/api/search/web', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: normalizedQuery,
            location: sanitizeCodeTokensInQuery(locationRef.current),
            coordinates: coordinatesRef.current,
            language: languageRef.current,
            codeOnly,
          }),
        });
        const data: WebSearchResponse = await res.json();
        if (!res.ok) {
          throw new Error((data as any).error || 'Nie udało się przeszukać internetu.');
        }
        setWebSearchData(data);
        webSearchDataRef.current = data;
        return data;
      } catch (err: any) {
        setWebSearchError(err?.message || 'Błąd przeszukiwania internetu.');
        return null;
      } finally {
        setIsWebSearchLoading(false);
      }
    },
    []
  );

  const openBrowserArticle = useCallback(
    async (
      item: WebSearchResultItem,
      readAloud = false,
      onReadText?: (speechText: string) => void
    ): Promise<BrowserArticleData | null> => {
      if (!item?.websiteUrl) return null;
      setIsBrowserOpen(true);
      setIsArticleLoading(true);
      setArticleError(null);
      try {
        const res = await fetch('/api/browser/article', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: item.websiteUrl,
            title: item.title,
            summary: item.summary,
            language: languageRef.current,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Nie udało się otworzyć artykułu.');
        }
        const article: BrowserArticleData = data;
        setActiveArticle(article);
        if (readAloud && onReadText) {
          const shortBody = article.content.slice(0, 750);
          onReadText(`${article.title}. ${shortBody}`);
        }
        return article;
      } catch (err: any) {
        setArticleError(err?.message || 'Błąd wczytywania artykułu.');
        return null;
      } finally {
        setIsArticleLoading(false);
      }
    },
    []
  );

  // Fast GPS Location Detection
  const detectFastLocation = useCallback(
    (autoSearch = false, manualTrigger = false, transitModeOverride?: TransitMode) => {
      if (!navigator.geolocation) return;
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          setCoordinates(coords);
          coordinatesRef.current = coords;
          const activeTransitMode = transitModeOverride || transitMode;

          try {
            const resp = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lng}`
            );
            const geo = await resp.json();
            const addr = geo?.address || {};
            const postcode =
              addr.country_code === 'de'
                ? stripHyphensForCodeOnly(addr.postcode || '')
                : addr.postcode || '';
            const resolved = `${addr.road ? `${addr.road}, ` : ''}${postcode} ${
              addr.city || addr.town || addr.village || ''
            }`.trim();

            if (resolved) {
              setLocationInput(resolved);
              locationRef.current = resolved;
              setTransitFrom((prev) => prev || resolved);
            }
            if (autoSearch || manualTrigger) {
              const targetLoc = resolved || '';
              if (activeTabRef.current === 'stays') {
                await performStaysSearch(targetLoc, stayType, coords);
              } else if (activeTabRef.current === 'transit') {
                await performTransitSearch(
                  activeTransitMode,
                  targetLoc,
                  activeTransitMode === 'fuel' ? '' : transitTo
                );
              } else if (manualTrigger || activeTabRef.current === 'food') {
                await performFoodSearch(targetLoc, foodCategory, coords);
              }
            }
          } catch {
            if (autoSearch && (manualTrigger || activeTabRef.current === 'food')) {
              if (activeTabRef.current === 'stays') {
                await performStaysSearch('', stayType, coords);
              } else if (activeTabRef.current === 'transit') {
                await performTransitSearch(
                  activeTransitMode,
                  '',
                  activeTransitMode === 'fuel' ? '' : transitTo
                );
              } else if (activeTabRef.current === 'food') {
                await performFoodSearch('', foodCategory, coords);
              }
            }
          } finally {
            setIsLocating(false);
          }
        },
        () => {
          setIsLocating(false);
        },
        { enableHighAccuracy: false, maximumAge: 300000, timeout: 6000 }
      );
    },
    [foodCategory, stayType, transitMode, transitTo, performFoodSearch, performStaysSearch, performTransitSearch]
  );

  useEffect(() => {
    detectFastLocation(true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Android Dialer & App Launcher
  // ---------------------------------------------------------------------------
  const findContactByName = useCallback((nameHint?: string): WhatsappContact | undefined => {
    if (!nameHint) return undefined;
    const lower = nameHint.toLowerCase().trim();
    return contactsRef.current.find(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        lower.includes(c.name.toLowerCase().split(' ')[0])
    );
  }, []);

  const triggerAndroidDial = useCallback(
    (
      targetHint?: string,
      latestFood?: FoodSearchResponse | null,
      latestStays?: StaysSearchResponse | null
    ) => {
      if (targetHint && targetHint !== 'first') {
        const matchedContact = findContactByName(targetHint);
        if (matchedContact) {
          const telNumber = sanitizePhoneForTel(matchedContact.phone);
          if (telNumber) {
            setDialTarget({
              name: matchedContact.name,
              phone: telNumber,
              address: matchedContact.role,
            });
            try {
              const a = document.createElement('a');
              a.href = `tel:${telNumber}`;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            } catch {
              // DialerModal fallback
            }
            return true;
          }
        }

        const digitsOnly = targetHint.replace(/[^\d+]/g, '');
        if (digitsOnly.length >= 7) {
          const telNumber = sanitizePhoneForTel(digitsOnly);
          setDialTarget({ name: 'Połączenie telefoniczne', phone: telNumber });
          try {
            const a = document.createElement('a');
            a.href = `tel:${telNumber}`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch {
            // fallback modal
          }
          return true;
        }
      }

      const foodList = (latestFood ?? foodDataRef.current)?.results ?? [];
      const stayList = (latestStays ?? staysDataRef.current)?.results ?? [];
      const pool =
        activeTabRef.current === 'stays'
          ? [...stayList, ...foodList]
          : [...foodList, ...stayList];

      const withPhones = pool.filter((item) => sanitizePhoneForTel(item.phone).length > 4);
      if (withPhones.length === 0) return false;

      let chosen = withPhones[0];
      if (targetHint && targetHint !== 'first') {
        const lower = targetHint.toLowerCase();
        const found = withPhones.find((item) =>
          item.name.toLowerCase().includes(lower)
        );
        if (found) chosen = found;
      }

      const telNumber = sanitizePhoneForTel(chosen.phone);
      if (!telNumber) return false;

      setDialTarget({
        name: chosen.name,
        phone: telNumber,
        address: `${chosen.address}, ${chosen.postalCode} ${chosen.city}`,
      });

      try {
        const a = document.createElement('a');
        a.href = `tel:${telNumber}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch {
        // DialerModal remains visible
      }
      return true;
    },
    [findContactByName]
  );

  const launchExternalApp = useCallback((launch: ExternalAppLaunch) => {
    setLastLaunchedApp(launch);
    try {
      const a = document.createElement('a');
      a.href = launch.url;
      if (!launch.url.startsWith('intent:') && !launch.url.startsWith('tel:')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      // Fallback link in VoiceDock
    }
  }, []);

  // Forward declarations via refs so language switching can restart Live cleanly
  const stopLiveSessionRef = useRef<() => void>(() => {});
  const startLiveSessionRef = useRef<
    (gender: VoiceGender, lang: AssistantLanguage) => Promise<void>
  >(async () => {});

  const handleSelectLanguage = useCallback(
    async (nextLang: AssistantLanguage) => {
      setLanguage(nextLang);
      languageRef.current = nextLang;
      const notice =
        nextLang === 'de'
          ? 'Sprache auf Deutsch umgestellt. Wie kann ich dir helfen?'
          : 'Przełączono język asystenta na polski. W czym mogę pomóc?';
      setAssistantReply(notice);
      appendChatMessage('assistant', notice, nextLang);

      if (isLiveActiveRef.current) {
        stopLiveSessionRef.current();
        await startLiveSessionRef.current(voiceGenderRef.current, nextLang);
      }
    },
    [appendChatMessage]
  );

  // ---------------------------------------------------------------------------
  // Multi-Step Action Executor
  // ---------------------------------------------------------------------------
  const executeActions = useCallback(
    async (actions: AssistantAction[]): Promise<boolean> => {
      let latestFood = foodDataRef.current;
      let latestStays = staysDataRef.current;
      let handledOwnSpeech = false;

      for (const action of actions) {
        if (action.type === 'close_tab') {
          const validTabs: TabId[] = ['assistant', 'food', 'stays', 'transit'];
          if (action.targetTab && validTabs.includes(action.targetTab)) {
            setDetachedWindow(null);
            switchTab(action.targetTab);
          } else if (detachedWindowRef.current) {
            const target: TabId =
              previousTabRef.current && previousTabRef.current !== detachedWindowRef.current
                ? previousTabRef.current
                : 'assistant';
            setDetachedWindow(null);
            switchTab(target);
          } else {
            const fallbackTab: TabId =
              previousTabRef.current && previousTabRef.current !== activeTabRef.current
                ? previousTabRef.current
                : 'assistant';
            setDetachedWindow(null);
            switchTab(fallbackTab);
          }
        } else if (action.type === 'navigate' && action.tab) {
          const validTabs: TabId[] = ['assistant', 'food', 'stays', 'transit'];
          const targetTab: TabId = validTabs.includes(action.tab)
            ? action.tab
            : 'assistant';
          // Stay in the user's current window (Jedzenie/Noclegi/Przejazdy) unless user explicitly asked to switch back
          if (
            targetTab === 'assistant' &&
            activeTabRef.current !== 'assistant' &&
            action.explicit !== true
          ) {
            continue;
          }
          switchTab(targetTab);
          if (targetTab === 'stays' || targetTab === 'transit') {
            setDetachedWindow(targetTab);
          } else {
            setDetachedWindow(null);
          }
        } else if (action.type === 'set_language') {
          handledOwnSpeech = true;
          await handleSelectLanguage(action.language);
        } else if (action.type === 'search_food') {
          setDetachedWindow(null);
          switchTab('food');
          const actionLoc =
            action.location?.trim() ||
            (action as { target?: string; to?: string; query?: string }).target?.trim() ||
            (action as { to?: string }).to?.trim() ||
            (action as { query?: string }).query?.trim();
          const rawNextLoc = actionLoc || locationRef.current;
          const nextLoc = sanitizeCodeTokensInQuery(rawNextLoc, action.country);
          if (actionLoc) {
            setLocationInput(nextLoc);
            locationRef.current = nextLoc;
          }
          const cat: FoodCategory = action.category || 'all';
          setFoodCategory(cat);
          latestFood = await performFoodSearch(
            nextLoc,
            cat,
            coordinatesRef.current,
            action.country
          );
        } else if (action.type === 'search_stays') {
          switchTab('stays');
          setDetachedWindow('stays');
          const actionLoc =
            action.location?.trim() ||
            (action as { target?: string; to?: string; query?: string }).target?.trim() ||
            (action as { to?: string }).to?.trim() ||
            (action as { query?: string }).query?.trim();
          const rawNextLoc = actionLoc || locationRef.current;
          const nextLoc = sanitizeCodeTokensInQuery(rawNextLoc, action.country);
          if (actionLoc) {
            setLocationInput(nextLoc);
            locationRef.current = nextLoc;
          }
          const st: StayType = action.stayType || 'all';
          setStayType(st);
          latestStays = await performStaysSearch(
            nextLoc,
            st,
            coordinatesRef.current,
            undefined,
            undefined,
            action.country
          );
        } else if (action.type === 'auto_book_stay') {
          handledOwnSpeech = true;
          if (action.checkIn) setCheckIn(action.checkIn);
          if (action.checkOut) setCheckOut(action.checkOut);
          if (action.guests) setGuests(action.guests);

          const stayCandidate = action.stayName
            ? staysDataRef.current?.results.find((s) =>
                s.name.toLowerCase().includes(action.stayName!.toLowerCase())
              )
            : undefined;
          const actionLoc =
            action.location?.trim() ||
            (action as { target?: string; to?: string; query?: string }).target?.trim() ||
            (action as { to?: string }).to?.trim() ||
            (action as { query?: string }).query?.trim();

          await performAutoBookStay({
            stay: stayCandidate,
            location: actionLoc || locationRef.current,
            country: action.country,
            checkIn: action.checkIn || checkIn,
            checkOut: action.checkOut || checkOut,
            guests: action.guests || guests,
          });
        } else if (action.type === 'search_transit') {
          switchTab('transit');
          setDetachedWindow('transit');
          const m = action.mode || 'trains';
          setTransitMode(m);
          const nextFrom = action.from
            ? sanitizeCodeTokensInQuery(action.from, action.country)
            : action.from;
          const nextTo = action.to
            ? sanitizeCodeTokensInQuery(action.to, action.country)
            : action.to;
          if (nextFrom) setTransitFrom(nextFrom);
          if (nextTo) setTransitTo(nextTo);
          const transitRes = await performTransitSearch(
            m,
            nextFrom,
            nextTo,
            action.query,
            action.country
          );
          if (transitRes?.summarySpeech) {
            handledOwnSpeech = true;
            setAssistantReply(transitRes.summarySpeech);
            appendChatMessage('assistant', transitRes.summarySpeech);
            void speakWithMiekiszon(transitRes.summarySpeech);
          }
        } else if (action.type === 'web_search') {
          // Keep results right inside whichever window/tab the user is currently talking in (e.g. food, stays, transit, or assistant)
          const webRes = await performWebSearch(action.query, Boolean(action.codeOnly));
          if (webRes) {
            if (webRes.answerSummary) {
              handledOwnSpeech = true;
              setAssistantReply(webRes.answerSummary);
              appendChatMessage('assistant', webRes.answerSummary);
              void speakWithMiekiszon(webRes.answerSummary);
            }
            if (action.autoRedirect && webRes.primaryRedirectUrl) {
              launchExternalApp({
                title: webRes.query,
                url: webRes.primaryRedirectUrl,
                appLabel: 'Strona internetowa',
              });
            }
          }
        } else if (action.type === 'dial') {
          triggerAndroidDial(action.target, latestFood, latestStays);
        } else if (action.type === 'prepare_whatsapp') {
          const msgToSend = action.message || whatsappMessage;
          if (action.message) {
            setWhatsappMessage(action.message);
          }
          if (action.recipientFilter && action.recipientFilter !== 'all') {
            const matched = findContactByName(action.recipientFilter);
            if (matched) {
              launchExternalApp({
                title: `WhatsApp: ${matched.name}`,
                url: buildWhatsappUrl(matched.phone, msgToSend),
                appLabel: 'WhatsApp',
              });
            }
          }
          setIsWhatsappModalOpen(true);
        } else if (action.type === 'read_story') {
          handledOwnSpeech = true;
          if (activeAudioElRef.current) {
            activeAudioElRef.current.stop();
            activeAudioElRef.current = null;
            isSpeakingTtsRef.current = false;
            setIsSpeakingTts(false);
          }
          livePlayerRef.current?.interrupt();
          try {
            const storyRes = await fetch('/api/assistant/story', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                topic: action.topic || '',
                language: languageRef.current,
              }),
            });
            const storyJson = await storyRes.json();
            if (storyJson.storyText) {
              setAssistantReply(storyJson.storyText);
              appendChatMessage('assistant', storyJson.storyText);
              if (!isMutedRef.current && storyPlayerRef.current) {
                void storyPlayerRef.current.startStory(
                  storyJson.storyText,
                  voiceGenderRef.current,
                  languageRef.current
                );
              }
            }
          } catch {
            // keep initial reply
          }
        } else if (action.type === 'continue_story') {
          handledOwnSpeech = true;
          livePlayerRef.current?.interrupt();
          const resumed = await storyPlayerRef.current?.resume();
          if (!resumed) {
            const noStoryMsg =
              languageRef.current === 'de'
                ? 'Es gibt kein pausiertes Märchen — ich erzähle ein neues.'
                : 'Nie mam wstrzymanej bajki — opowiem nową od początku.';
            setAssistantReply(noStoryMsg);
            appendChatMessage('assistant', noStoryMsg);
            void executeActions([{ type: 'read_story' }]);
          }
        } else if (action.type === 'pause_story') {
          handledOwnSpeech = true;
          storyPlayerRef.current?.pause();
        } else if (action.type === 'set_alarm') {
          const cleanTime = action.time || '07:00';
          const cleanLabel = action.label || 'Budzik';
          if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission();
          }
          setAlarms((prev) => [
            ...prev,
            {
              id: `alarm_${Date.now()}`,
              time: cleanTime,
              label: cleanLabel,
              active: true,
            },
          ]);
          if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')) {
            const alarmUrl = buildAndroidAlarmIntentUrl(cleanTime, cleanLabel);
            launchExternalApp({
              title: `Budzik ${cleanTime} (${cleanLabel})`,
              url: alarmUrl,
              appLabel: 'Zegar Android',
            });
          }
        } else if (action.type === 'delete_alarm') {
          const curAlarms = alarmsRef.current;
          if (action.all) {
            setAlarms([]);
          } else if (action.time || action.label) {
            setAlarms((prev) =>
              prev.filter((a) => {
                const matchTime = action.time ? a.time === action.time : false;
                const matchLabel = action.label
                  ? a.label.toLowerCase().includes(action.label.toLowerCase())
                  : false;
                return !(matchTime || matchLabel);
              })
            );
          } else if (curAlarms.length > 0) {
            setAlarms((prev) => prev.slice(0, -1));
          }
        } else if (action.type === 'set_reminder') {
          if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission();
          }
          let triggerMs = Date.now() + (action.delayMinutes || 5) * 60000;
          if (action.time && /^\d{1,2}:\d{2}$/.test(action.time)) {
            const [h, m] = action.time.split(':').map(Number);
            const target = new Date();
            target.setHours(h, m, 0, 0);
            if (target.getTime() <= Date.now()) {
              target.setDate(target.getDate() + 1);
            }
            triggerMs = target.getTime();
          }
          const d = new Date(triggerMs);
          const displayTime = `${String(d.getHours()).padStart(2, '0')}:${String(
            d.getMinutes()
          ).padStart(2, '0')}`;
          setReminders((prev) => [
            ...prev,
            {
              id: `rem_${Date.now()}`,
              text: action.text || 'Powiadomienie Miękiszon',
              triggerAt: triggerMs,
              displayTime,
            },
          ]);
        } else if (action.type === 'delete_reminder') {
          const curReminders = remindersRef.current;
          if (action.all) {
            setReminders([]);
          } else if (action.text) {
            const needle = action.text.toLowerCase();
            setReminders((prev) => prev.filter((r) => !r.text.toLowerCase().includes(needle)));
          } else if (curReminders.length > 0) {
            setReminders((prev) => prev.slice(0, -1));
          }
        } else if (action.type === 'open_youtube') {
          handledOwnSpeech = true;
          const q = (action.query || '').trim();
          setIsYoutubeLoading(true);
          setYoutubeError(null);
          setYoutubeQuery(q || (languageRef.current === 'de' ? 'Musik Hits' : 'Polskie hity'));
          try {
            const ytRes = await fetch('/api/youtube/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: q, language: languageRef.current }),
            });
            const ytJson = await ytRes.json();
            if (!ytRes.ok) {
              throw new Error(ytJson.error || 'Nie udało się pobrać wyników YouTube.');
            }
            const vids: YoutubeVideoItem[] = Array.isArray(ytJson.results) ? ytJson.results : [];
            setYoutubeResults(vids);
            youtubeResultsRef.current = vids;

            if (vids.length > 0) {
              let pickedIdx = 0;
              if (action.trackIndex) {
                pickedIdx = Math.min(Math.max(1, action.trackIndex) - 1, vids.length - 1);
              } else if (action.randomTrack && vids.length > 1) {
                pickedIdx = Math.floor(Math.random() * vids.length);
              }
              const picked = vids[pickedIdx];
              setActiveYoutubeVideo(picked);
              activeYoutubeVideoRef.current = picked;
              const msg = action.trackIndex
                ? languageRef.current === 'de'
                  ? `Ich spiele Titel Nr. ${pickedIdx + 1} auf YouTube: ${picked.title}`
                  : `Odtwarzam utwór nr ${pickedIdx + 1} na YouTube: ${picked.title}`
                : action.randomTrack
                  ? languageRef.current === 'de'
                    ? `YouTube für ${q || 'dich'} geöffnet — spiele verfügbaren Titel Nr. ${pickedIdx + 1}: ${picked.title}`
                    : `Włączyłem YouTube${q ? ` dla ${q}` : ''}. Puszczam dostępny kawałek nr ${pickedIdx + 1}: ${picked.title}`
                  : languageRef.current === 'de'
                    ? `YouTube geöffnet: ${picked.title}`
                    : `Włączyłem YouTube. Wybrano utwór nr 1: ${picked.title}`;
              setAssistantReply(msg);
              appendChatMessage('assistant', msg);
              void speakWithMiekiszon(msg);
            } else {
              const targetApp = action.service === 'youtube_music' ? 'youtube_music' : 'youtube';
              launchExternalApp(getAppLaunchInfo(targetApp, action.query));
            }
          } catch (ytErr: any) {
            setYoutubeError(ytErr?.message || 'Błąd wyszukiwania YouTube.');
            const targetApp = action.service === 'youtube_music' ? 'youtube_music' : 'youtube';
            launchExternalApp(getAppLaunchInfo(targetApp, action.query));
          } finally {
            setIsYoutubeLoading(false);
          }
        } else if (action.type === 'select_youtube_track') {
          handledOwnSpeech = true;
          let vids = youtubeResultsRef.current;
          if (vids.length === 0) {
            setIsYoutubeLoading(true);
            try {
              const ytRes = await fetch('/api/youtube/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  query: youtubeQueryRef.current || '',
                  language: languageRef.current,
                }),
              });
              const ytJson = await ytRes.json();
              if (ytRes.ok && Array.isArray(ytJson.results)) {
                vids = ytJson.results;
                setYoutubeResults(vids);
                youtubeResultsRef.current = vids;
              }
            } catch {
              // ignore
            } finally {
              setIsYoutubeLoading(false);
            }
          }
          if (vids.length > 0) {
            let pickedIdx = 0;
            if (action.randomTrack || action.nextTrack) {
              const curId = activeYoutubeVideoRef.current?.videoId;
              const otherIndices = vids
                .map((v, i) => (v.videoId !== curId ? i : -1))
                .filter((i) => i >= 0);
              if (otherIndices.length > 0) {
                pickedIdx = otherIndices[Math.floor(Math.random() * otherIndices.length)];
              } else {
                pickedIdx = 0;
              }
            } else {
              const requestedIdx = Math.max(1, action.trackIndex || 1);
              pickedIdx = Math.min(requestedIdx - 1, vids.length - 1);
            }
            const picked = vids[pickedIdx];
            setActiveYoutubeVideo(picked);
            activeYoutubeVideoRef.current = picked;
            const msg =
              languageRef.current === 'de'
                ? `Ich spiele Titel Nummer ${pickedIdx + 1}: ${picked.title}`
                : `Odtwarzam utwór numer ${pickedIdx + 1}: ${picked.title}`;
            setAssistantReply(msg);
            appendChatMessage('assistant', msg);
            void speakWithMiekiszon(msg);
          }
        } else if (action.type === 'close_youtube') {
          setActiveYoutubeVideo(null);
          activeYoutubeVideoRef.current = null;
          setYoutubeResults([]);
          youtubeResultsRef.current = [];
          setYoutubeError(null);
        } else if (action.type === 'open_browser') {
          setIsBrowserOpen(true);
          setActiveArticle(null);
          setArticleError(null);
          if (action.openExternalChrome) {
            launchExternalApp(getAppLaunchInfo('chrome', action.query));
          }
          if (action.query) {
            const webRes = await performWebSearch(action.query, false);
            if (webRes?.answerSummary) {
              handledOwnSpeech = true;
              setAssistantReply(webRes.answerSummary);
              appendChatMessage('assistant', webRes.answerSummary);
              void speakWithMiekiszon(webRes.answerSummary);
            }
          }
        } else if (action.type === 'select_article') {
          const items = webSearchDataRef.current?.results || [];
          if (items.length > 0) {
            const requestedIdx = Math.max(1, action.articleIndex || 1);
            const picked = items[Math.min(requestedIdx - 1, items.length - 1)];
            handledOwnSpeech = Boolean(action.readAloud);
            await openBrowserArticle(picked, Boolean(action.readAloud), (speechText) => {
              setAssistantReply(speechText);
              appendChatMessage('assistant', speechText);
              void speakWithMiekiszon(speechText);
            });
          }
        } else if (action.type === 'close_article') {
          setActiveArticle(null);
          setArticleError(null);
        } else if (action.type === 'close_browser') {
          setIsBrowserOpen(false);
          setActiveArticle(null);
          setIsArticleLoading(false);
          setArticleError(null);
          setLastLaunchedApp(null);
          setWebSearchData(null);
          webSearchDataRef.current = null;
          setWebSearchError(null);
        } else if (action.type === 'open_calculator') {
          setIsCalculatorOpen(true);
          if (action.expression) {
            setCalculatorExpr(action.expression);
            const resStr = evaluateMathExpression(action.expression);
            if (resStr) {
              handledOwnSpeech = true;
              const calcMsg =
                languageRef.current === 'de'
                  ? `Ergebnis von ${action.expression} ist ${resStr}.`
                  : `Wynik działania ${action.expression} to ${resStr}.`;
              setAssistantReply(calcMsg);
              appendChatMessage('assistant', calcMsg);
              void speakWithMiekiszon(calcMsg);
            }
          }
        } else if (action.type === 'close_calculator') {
          setIsCalculatorOpen(false);
        } else if (action.type === 'open_notepad') {
          setIsNotepadOpen(true);
        } else if (action.type === 'write_note') {
          const text = (action.text || '').trim();
          if (text) {
            const newNote: NotepadNote = {
              id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
              text,
              createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            setNotepadNotes((prev) => [newNote, ...prev]);
          }
          setIsNotepadOpen(true);
        } else if (action.type === 'delete_note') {
          if (action.all) {
            setNotepadNotes([]);
          } else if (action.text) {
            const needle = action.text.toLowerCase();
            setNotepadNotes((prev) => prev.filter((n) => !n.text.toLowerCase().includes(needle)));
          } else if (notepadNotesRef.current.length > 0) {
            setNotepadNotes((prev) => prev.slice(1));
          }
        } else if (action.type === 'close_notepad') {
          setIsNotepadOpen(false);
        } else if (action.type === 'open_app') {
          if (action.app === 'browser' || action.app === 'chrome') {
            setIsBrowserOpen(true);
            if (action.query) {
              void performWebSearch(action.query, false);
            }
          }
          const contact = findContactByName(action.contactName);
          const launch = getAppLaunchInfo(
            action.app,
            action.query || contact?.name,
            contact?.phone
          );
          launchExternalApp(launch);
        }
      }
      return handledOwnSpeech;
    },
    [
      switchTab,
      handleSelectLanguage,
      performFoodSearch,
      performStaysSearch,
      performAutoBookStay,
      performTransitSearch,
      performWebSearch,
      openBrowserArticle,
      triggerAndroidDial,
      speakWithMiekiszon,
      launchExternalApp,
      findContactByName,
      appendChatMessage,
      whatsappMessage,
      checkIn,
      checkOut,
      guests,
    ]
  );

  const handleSubmitTextCommand = useCallback(
    async (text: string, options?: { forceTts?: boolean }) => {
      const cleanText = text.trim();
      if (!cleanText) return;
      // Unlock mobile AudioContext / <audio> synchronously inside the submit gesture
      unlockMobileAudio();
      setVoiceError(null);
      setUserTranscript(cleanText);
      setIsCommandLoading(true);
      try {
        const currentResults =
          activeTabRef.current === 'food'
            ? foodDataRef.current?.results ?? []
            : activeTabRef.current === 'stays'
              ? staysDataRef.current?.results ?? []
              : [];

        const res = await fetch('/api/assistant/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: cleanText,
            currentTab: activeTabRef.current,
            currentLocation: locationRef.current,
            visibleItems: currentResults.slice(0, 6).map((item) => ({
              name: item.name,
              phone: item.phone,
            })),
            contacts: contactsRef.current.map((c) => ({
              name: c.name,
              phone: c.phone,
              role: c.role,
            })),
            voiceGender: voiceGenderRef.current,
            language: languageRef.current,
          }),
        });

        const data = await parseApiJson<CommandResponse & { error?: string }>(
          res,
          languageRef.current === 'de'
            ? 'Befehl konnte nicht ausgeführt werden'
            : 'Nie udało się wykonać polecenia'
        );

        const replyText = typeof data.replyText === 'string' ? data.replyText.trim() : '';
        const actions = Array.isArray(data.actions) ? data.actions : [];

        if (!replyText && actions.length === 0) {
          throw new Error(
            languageRef.current === 'de'
              ? 'Der Server hat eine leere Antwort zurückgegeben. Bitte versuche es erneut.'
              : 'Serwer zwrócił pustą odpowiedź. Spróbuj ponownie.'
          );
        }

        const effectiveReply =
          replyText ||
          (languageRef.current === 'de' ? 'Befehl wird ausgeführt.' : 'Wykonuję polecenie.');

        setAssistantReply(effectiveReply);
        appendChatMessage('assistant', effectiveReply);

        const handledOwnSpeech = await executeActions(actions);
        if (!handledOwnSpeech && effectiveReply) {
          await speakWithMiekiszon(
            effectiveReply,
            languageRef.current,
            Boolean(options?.forceTts)
          );
        }
      } catch (err: any) {
        const errMsg =
          err?.message ||
          (languageRef.current === 'de'
            ? 'Fehler bei der Verarbeitung des Befehls.'
            : 'Wystąpił błąd podczas przetwarzania polecenia.');
        setVoiceError(errMsg);
        setAssistantReply(errMsg);
      } finally {
        setIsCommandLoading(false);
      }
    },
    [appendChatMessage, executeActions, speakWithMiekiszon]
  );

  // ---------------------------------------------------------------------------
  // Live Video Share (Rear/Front Camera + Phone Screen Share)
  // ---------------------------------------------------------------------------
  const stopVideoShare = useCallback(() => {
    if (videoFrameIntervalRef.current !== null) {
      window.clearInterval(videoFrameIntervalRef.current);
      videoFrameIntervalRef.current = null;
    }
    if (liveVideoStreamRef.current) {
      liveVideoStreamRef.current.getTracks().forEach((t) => t.stop());
      liveVideoStreamRef.current = null;
    }
    if (hiddenCaptureVideoRef.current) {
      hiddenCaptureVideoRef.current.srcObject = null;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    setVideoMode('none');
    videoModeRef.current = 'none';
  }, []);

  const attachStreamToVideoElements = useCallback((stream: MediaStream) => {
    if (!hiddenCaptureVideoRef.current) {
      const hiddenVid = document.createElement('video');
      hiddenVid.muted = true;
      hiddenVid.playsInline = true;
      hiddenCaptureVideoRef.current = hiddenVid;
    }
    hiddenCaptureVideoRef.current.srcObject = stream;
    void hiddenCaptureVideoRef.current.play().catch(() => {});

    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = stream;
      void videoPreviewRef.current.play().catch(() => {});
    }
  }, []);

  const startVideoFrameLoop = useCallback(() => {
    if (videoFrameIntervalRef.current !== null) {
      window.clearInterval(videoFrameIntervalRef.current);
    }
    videoFrameIntervalRef.current = window.setInterval(() => {
      const ws = liveWsRef.current;
      const vid = hiddenCaptureVideoRef.current || videoPreviewRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !vid) return;
      if (vid.readyState < 2 || vid.videoWidth === 0 || vid.videoHeight === 0) return;

      const maxDim = 768;
      const scale = Math.min(1, maxDim / Math.max(vid.videoWidth, vid.videoHeight));
      const targetW = Math.max(1, Math.round(vid.videoWidth * scale));
      const targetH = Math.max(1, Math.round(vid.videoHeight * scale));

      let canvas = videoCaptureCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        videoCaptureCanvasRef.current = canvas;
      }
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(vid, 0, 0, targetW, targetH);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      const base64Jpeg = dataUrl.split(',')[1];
      if (base64Jpeg) {
        ws.send(JSON.stringify({ video: base64Jpeg }));
      }
    }, 1000);
  }, []);

  useEffect(() => {
    if (videoMode !== 'none' && liveVideoStreamRef.current && videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = liveVideoStreamRef.current;
      void videoPreviewRef.current.play().catch(() => {});
    }
  }, [videoMode, activeTab]);

  // ---------------------------------------------------------------------------
  // Gemini Live API Real-Time Voice Session + HTTP Voice Fallback (Cloudflare/Vercel safe)
  // ---------------------------------------------------------------------------
  const resetVadBuffer = useCallback(() => {
    vadSpeakingRef.current = false;
    vadSpeechChunksRef.current = [];
    vadPreRollRef.current = [];
    vadSpeechStartMsRef.current = 0;
    vadLastLoudMsRef.current = 0;
    setHasBufferedSpeech(false);
  }, []);

  const clearVoiceTimers = useCallback(() => {
    if (liveReconnectTimerRef.current !== null) {
      window.clearTimeout(liveReconnectTimerRef.current);
      liveReconnectTimerRef.current = null;
    }
    if (livePingTimerRef.current !== null) {
      window.clearInterval(livePingTimerRef.current);
      livePingTimerRef.current = null;
    }
    if (wsStartupTimerRef.current !== null) {
      window.clearTimeout(wsStartupTimerRef.current);
      wsStartupTimerRef.current = null;
    }
    if (liveResponseWatchdogRef.current !== null) {
      window.clearTimeout(liveResponseWatchdogRef.current);
      liveResponseWatchdogRef.current = null;
    }
  }, []);

  const processHttpVoiceUtterance = useCallback(
    async (chunks: Float32Array[], manualTrigger = false) => {
      if (isProcessingHttpVoiceRef.current) return;
      const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
      if (totalSamples < 4000) {
        if (manualTrigger) {
          setVoiceError(
            languageRef.current === 'de'
              ? 'Die Aufnahme war zu kurz. Sprich kurz ins Mikrofon und versuche es erneut.'
              : 'Nagranie było zbyt krótkie. Powiedz polecenie do mikrofonu i spróbuj ponownie.'
          );
        }
        return;
      }

      isProcessingHttpVoiceRef.current = true;
      setIsVoiceProcessing(true);
      setVoiceError(null);

      try {
        const audioBase64 = encodePcm16ChunksToWavBase64(chunks, 16000);
        const transcribeRes = await fetch('/api/assistant/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType: 'audio/wav',
            language: languageRef.current,
          }),
        });

        const transcribeData = await parseApiJson<{
          text?: string;
          empty?: boolean;
          error?: string;
        }>(
          transcribeRes,
          languageRef.current === 'de'
            ? 'Spracherkennung fehlgeschlagen'
            : 'Błąd rozpoznawania mowy'
        );

        const spokenText = (transcribeData.text || '').trim();
        if (!spokenText) {
          if (manualTrigger || totalSamples >= 16000) {
            setVoiceError(
              languageRef.current === 'de'
                ? 'Keine klare Sprache erkannt. Bitte sprich etwas deutlicher ins Mikrofon.'
                : 'Nie rozpoznano wyraźnej mowy. Powiedz polecenie wyraźniej bliżej mikrofonu.'
            );
          }
          return;
        }

        setUserTranscript(spokenText);
        await handleSubmitTextCommand(spokenText, { forceTts: true });
      } catch (err: any) {
        const errMsg =
          err?.message ||
          (languageRef.current === 'de'
            ? 'Fehler bei der Verarbeitung der Sprachnachricht.'
            : 'Błąd przetwarzania wypowiedzi głosowej.');
        setVoiceError(errMsg);
        setAssistantReply(errMsg);
      } finally {
        isProcessingHttpVoiceRef.current = false;
        setIsVoiceProcessing(false);
        resetVadBuffer();
      }
    },
    [handleSubmitTextCommand, resetVadBuffer]
  );

  const processHttpVoiceUtteranceRef = useRef(processHttpVoiceUtterance);
  processHttpVoiceUtteranceRef.current = processHttpVoiceUtterance;

  const stopLiveSession = useCallback(
    (preserveVideo = false, keepAliveForReconnect = false) => {
      clearVoiceTimers();
      if (!keepAliveForReconnect) {
        shouldStayLiveRef.current = false;
        voiceTransportModeRef.current = 'live';
        resetVadBuffer();
        liveLastUtteranceRef.current = [];
        setIsVoiceProcessing(false);
      }

      if (liveInputBufRef.current.trim()) {
        appendChatMessage('user', liveInputBufRef.current);
        liveInputBufRef.current = '';
      }
      if (liveOutputBufRef.current.trim()) {
        appendChatMessage('assistant', liveOutputBufRef.current);
        liveOutputBufRef.current = '';
      }

      if (liveWsRef.current) {
        const oldWs = liveWsRef.current;
        liveWsRef.current = null;
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        try {
          oldWs.close(1000, 'client_stop');
        } catch {
          // ignore
        }
      }

      if (!keepAliveForReconnect) {
        if (activeAudioElRef.current) {
          activeAudioElRef.current.stop();
          activeAudioElRef.current = null;
          isSpeakingTtsRef.current = false;
          setIsSpeakingTts(false);
        }
        if (liveProcessorRef.current) {
          liveProcessorRef.current.disconnect();
          liveProcessorRef.current = null;
        }
        if (liveGainRef.current) {
          liveGainRef.current.disconnect();
          liveGainRef.current = null;
        }
        if (liveInputCtxRef.current && liveInputCtxRef.current.state !== 'closed') {
          void liveInputCtxRef.current.close();
          liveInputCtxRef.current = null;
        }
        if (liveMicStreamRef.current) {
          liveMicStreamRef.current.getTracks().forEach((t) => t.stop());
          liveMicStreamRef.current = null;
        }
        if (livePlayerRef.current) {
          livePlayerRef.current.dispose();
          livePlayerRef.current = null;
        }
        if (!preserveVideo) {
          stopVideoShare();
        }
        setMicLevel(0);
        setIsLiveActive(false);
        isLiveActiveRef.current = false;
        setLiveStatus('idle');
        liveStatusRef.current = 'idle';
      }
    },
    [appendChatMessage, clearVoiceTimers, resetVadBuffer, stopVideoShare]
  );

  stopLiveSessionRef.current = () => stopLiveSession(false, false);

  const handleToggleMute = useCallback(() => {
    unlockMobileAudio();
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next && activeAudioElRef.current) {
        activeAudioElRef.current.stop();
        activeAudioElRef.current = null;
        isSpeakingTtsRef.current = false;
        setIsSpeakingTts(false);
      }
      if (livePlayerRef.current) {
        livePlayerRef.current.setMuted(next);
        if (!next) {
          livePlayerRef.current.unlock();
        }
      }
      if (liveMicStreamRef.current) {
        liveMicStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = !next;
        });
      }
      return next;
    });
  }, []);

  const handleFinishUtterance = useCallback(() => {
    unlockMobileAudio();
    livePlayerRef.current?.unlock();
    const captured = [...vadSpeechChunksRef.current];
    resetVadBuffer();

    if (voiceTransportModeRef.current === 'http') {
      void processHttpVoiceUtterance(captured, true);
      return;
    }

    const activeWs = liveWsRef.current;
    if (activeWs && activeWs.readyState === WebSocket.OPEN && wsReadyReceivedRef.current) {
      liveLastUtteranceRef.current = captured;
      liveTurnGotResponseRef.current = false;
      setIsVoiceProcessing(true);
      try {
        activeWs.send(JSON.stringify({ type: 'audio_end' }));
      } catch {
        // ignore
      }
      if (liveResponseWatchdogRef.current !== null) {
        window.clearTimeout(liveResponseWatchdogRef.current);
      }
      liveResponseWatchdogRef.current = window.setTimeout(() => {
        liveResponseWatchdogRef.current = null;
        if (
          shouldStayLiveRef.current &&
          voiceTransportModeRef.current === 'live' &&
          !liveTurnGotResponseRef.current
        ) {
          const snapshot = liveLastUtteranceRef.current;
          liveLastUtteranceRef.current = [];
          if (snapshot.length > 0) {
            void processHttpVoiceUtterance(snapshot, true);
          } else {
            setIsVoiceProcessing(false);
            setVoiceError(
              languageRef.current === 'de'
                ? 'Der Live-Assistent hat nicht rechtzeitig geantwortet. Bitte sprich erneut.'
                : 'Asystent nie zwrócił odpowiedzi po zakończeniu wypowiedzi. Spróbuj ponownie.'
            );
          }
        }
      }, 9500);
    } else if (captured.length > 0) {
      void processHttpVoiceUtterance(captured, true);
    }
  }, [processHttpVoiceUtterance, resetVadBuffer]);

  const handleReplayReply = useCallback(() => {
    unlockMobileAudio();
    livePlayerRef.current?.unlock();
    setVoiceError(null);
    if (assistantReply.trim()) {
      void speakWithMiekiszon(assistantReply, languageRef.current, true);
    }
  }, [assistantReply, speakWithMiekiszon]);

  const startLiveSessionWithOptions = useCallback(
    async (gender: VoiceGender, lang: AssistantLanguage, isAutoReconnect = false) => {
      shouldStayLiveRef.current = true;
      clearVoiceTimers();
      if (activeAudioElRef.current) {
        activeAudioElRef.current.stop();
        activeAudioElRef.current = null;
        isSpeakingTtsRef.current = false;
        setIsSpeakingTts(false);
      }

      if (!isAutoReconnect) {
        wsStartupFailuresRef.current = 0;
        voiceTransportModeRef.current = 'live';
        setVoiceError(null);
        setUserTranscript('');
        setIsVoiceProcessing(false);
        resetVadBuffer();
        setLiveStatus('connecting');
        liveStatusRef.current = 'connecting';
      }

      // IMPORTANT for iOS Safari / Android Chrome: unlock both Web Audio AudioContext
      // and <audio> synchronously BEFORE any `await` so the user gesture token is preserved.
      unlockMobileAudio();
      try {
        let player = livePlayerRef.current;
        if (!player) {
          player = new LivePcmPlayer((err) => {
            setVoiceError(
              lang === 'de'
                ? `Audiowiedergabe blockiert: ${err.message}`
                : `Odtwarzanie dźwięku zablokowane: ${err.message}`
            );
          });
          livePlayerRef.current = player;
        }
        player.setMuted(isMutedRef.current);
        player.unlock();

        if (!liveInputCtxRef.current || liveInputCtxRef.current.state === 'closed') {
          liveInputCtxRef.current = createCompatAudioContext();
        }
        if (liveInputCtxRef.current.state === 'suspended') {
          void liveInputCtxRef.current.resume().catch(() => {});
        }
      } catch (audioInitErr) {
        console.warn('Pre-await AudioContext unlock failed:', audioInitErr);
      }

      try {
        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
          shouldStayLiveRef.current = false;
          stopLiveSession(false, false);
          setLiveStatus('error');
          liveStatusRef.current = 'error';
          const noMicMsg =
            lang === 'de'
              ? 'Mikrofonzugriff wird von diesem Browser/Kontext blockiert (bitte direkt über HTTPS in Chrome oder Safari öffnen).'
              : 'Przeglądarka blokuje mikrofon (otwórz aplikację bezpośrednio po HTTPS w Google Chrome lub Safari i zezwól na mikrofon).';
          setVoiceError(noMicMsg);
          setAssistantReply(noMicMsg);
          return;
        }

        // Reuse existing live mic stream when reconnecting seamlessly
        const existingTracks = liveMicStreamRef.current?.getAudioTracks() ?? [];
        const hasHealthyMic = existingTracks.some((t) => t.readyState === 'live');
        let stream = liveMicStreamRef.current;

        if (!stream || !hasHealthyMic) {
          if (stream) {
            stream.getTracks().forEach((t) => t.stop());
          }
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          liveMicStreamRef.current = stream;
          const [audioTrack] = stream.getAudioTracks();
          if (audioTrack) {
            audioTrack.onended = () => {
              if (shouldStayLiveRef.current) {
                stopLiveSession(true, true);
                liveReconnectTimerRef.current = window.setTimeout(() => {
                  if (shouldStayLiveRef.current) {
                    void startLiveSessionWithOptions(
                      voiceGenderRef.current,
                      languageRef.current,
                      true
                    );
                  }
                }, 400);
              }
            };
          }
        }

        stream.getAudioTracks().forEach((t) => {
          t.enabled = !isMutedRef.current;
        });

        // Re-unlock playback AudioContext after getUserMedia (iOS Safari may suspend output on mic route switch)
        unlockMobileAudio();
        let player = livePlayerRef.current;
        if (!player) {
          player = new LivePcmPlayer((err) => {
            setVoiceError(
              lang === 'de'
                ? `Audiowiedergabe blockiert: ${err.message}`
                : `Odtwarzanie dźwięku zablokowane: ${err.message}`
            );
          });
          livePlayerRef.current = player;
        }
        player.setMuted(isMutedRef.current);
        player.unlock();

        let inputCtx = liveInputCtxRef.current;
        if (!inputCtx || inputCtx.state === 'closed') {
          inputCtx = createCompatAudioContext();
          liveInputCtxRef.current = inputCtx;
        }
        if (inputCtx.state === 'suspended') {
          await inputCtx.resume();
        }

        const activateHttpVoiceFallback = (reasonNote?: string) => {
          clearVoiceTimers();
          if (liveWsRef.current) {
            const oldWs = liveWsRef.current;
            liveWsRef.current = null;
            oldWs.onopen = null;
            oldWs.onmessage = null;
            oldWs.onerror = null;
            oldWs.onclose = null;
            try {
              oldWs.close(1000, 'fallback_http');
            } catch {
              // ignore
            }
          }
          voiceTransportModeRef.current = 'http';
          wsReadyReceivedRef.current = false;
          setIsLiveActive(true);
          isLiveActiveRef.current = true;
          setLiveStatus('active');
          liveStatusRef.current = 'active';
          setVoiceError(null);
          const profile = VOICE_PROFILES.find((v) => v.id === gender) || VOICE_PROFILES[0];
          const readyMsg =
            lang === 'de'
              ? `Sprachassistent aktiv (Deutsch, ${profile.labelDe}). Sprich deinen Befehl und mache eine kurze Pause — ich antworte per Sprache und Text.`
              : `Asystent głosowy aktywny (Polski, głos ${profile.labelPl}). Powiedz polecenie i zrób krótką pauzę — odpowiem głosem i tekstem.`;
          if (!isAutoReconnect) {
            setAssistantReply(readyMsg);
          }
          if (reasonNote) {
            console.info('[VoiceFallback] Switched to HTTP voice turn mode:', reasonNote);
          }
        };

        if (!liveProcessorRef.current || !hasHealthyMic) {
          if (liveProcessorRef.current) {
            liveProcessorRef.current.disconnect();
          }
          if (liveGainRef.current) {
            liveGainRef.current.disconnect();
          }
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;

          liveProcessorRef.current = processor;
          liveGainRef.current = silentGain;

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);

          processor.onaudioprocess = (e) => {
            const rawChannel = e.inputBuffer.getChannelData(0);
            const rms = computeRmsLevel(rawChannel);
            const nowMs = Date.now();
            if (nowMs - lastMicUiUpdateRef.current >= 140) {
              lastMicUiUpdateRef.current = nowMs;
              setMicLevel(rms);
            }

            if (isMutedRef.current) return;

            const ctxRate = liveInputCtxRef.current?.sampleRate || 48000;
            const resampled = resampleFloat32(rawChannel, ctxRate, 16000);
            const resampledCopy = new Float32Array(resampled);

            // 1. Live WebSocket real-time streaming path
            const activeWs = liveWsRef.current;
            const isLiveWsOpen =
              voiceTransportModeRef.current === 'live' &&
              activeWs &&
              activeWs.readyState === WebSocket.OPEN &&
              wsReadyReceivedRef.current;

            if (isLiveWsOpen && activeWs.bufferedAmount < 65536) {
              const base64 = float32ToPcm16Base64(resampledCopy);
              activeWs.send(JSON.stringify({ audio: base64 }));
            }

            // 2. Client-side VAD for end-of-speech signaling (Live WS) & utterance capture (HTTP fallback)
            const assistantIsAudioBusy =
              isSpeakingTtsRef.current ||
              isProcessingHttpVoiceRef.current ||
              Boolean(livePlayerRef.current?.isPlaying());

            if (assistantIsAudioBusy) {
              return;
            }

            // Maintain ~350ms pre-roll buffer so first syllable is never clipped
            vadPreRollRef.current.push(resampledCopy);
            if (vadPreRollRef.current.length > 5) {
              vadPreRollRef.current.shift();
            }

            const speechThreshold = voiceTransportModeRef.current === 'http' ? 0.055 : 0.065;
            const silenceTimeoutMs = voiceTransportModeRef.current === 'http' ? 1250 : 1200;

            if (rms >= speechThreshold) {
              if (!vadSpeakingRef.current) {
                vadSpeakingRef.current = true;
                vadSpeechStartMsRef.current = nowMs;
                vadSpeechChunksRef.current = [...vadPreRollRef.current];
                setHasBufferedSpeech(true);
              } else {
                vadSpeechChunksRef.current.push(resampledCopy);
              }
              vadLastLoudMsRef.current = nowMs;
            } else if (vadSpeakingRef.current) {
              vadSpeechChunksRef.current.push(resampledCopy);
              const speechDurationMs = nowMs - vadSpeechStartMsRef.current;
              const silenceDurationMs = nowMs - vadLastLoudMsRef.current;

              if (silenceDurationMs >= silenceTimeoutMs || speechDurationMs >= 20000) {
                const capturedChunks = vadSpeechChunksRef.current;
                vadSpeakingRef.current = false;
                vadSpeechChunksRef.current = [];
                vadSpeechStartMsRef.current = 0;
                vadLastLoudMsRef.current = 0;
                setHasBufferedSpeech(false);

                if (speechDurationMs >= 350) {
                  if (voiceTransportModeRef.current === 'http') {
                    void processHttpVoiceUtteranceRef.current(capturedChunks, false);
                  } else if (isLiveWsOpen) {
                    // Explicitly signal end-of-speech to Gemini Live & arm response watchdog
                    liveLastUtteranceRef.current = capturedChunks;
                    liveTurnGotResponseRef.current = false;
                    setIsVoiceProcessing(true);
                    try {
                      activeWs.send(JSON.stringify({ type: 'audio_end' }));
                    } catch {
                      // ignore
                    }
                    if (liveResponseWatchdogRef.current !== null) {
                      window.clearTimeout(liveResponseWatchdogRef.current);
                    }
                    liveResponseWatchdogRef.current = window.setTimeout(() => {
                      liveResponseWatchdogRef.current = null;
                      if (
                        shouldStayLiveRef.current &&
                        voiceTransportModeRef.current === 'live' &&
                        !liveTurnGotResponseRef.current
                      ) {
                        const snapshot = liveLastUtteranceRef.current;
                        liveLastUtteranceRef.current = [];
                        if (snapshot.length > 0) {
                          console.warn(
                            '[LiveWatchdog] No Live response after speech end; recovering via HTTP voice turn.'
                          );
                          void processHttpVoiceUtteranceRef.current(snapshot, false);
                        } else {
                          setIsVoiceProcessing(false);
                        }
                      }
                    }, 9500);
                  }
                }
              }
            }
          };
        }

        // If already switched to HTTP fallback mode, stay in HTTP mode cleanly
        if (voiceTransportModeRef.current === 'http') {
          activateHttpVoiceFallback();
          return;
        }

        // Close any stale WS before creating fresh one
        if (liveWsRef.current) {
          const staleWs = liveWsRef.current;
          liveWsRef.current = null;
          staleWs.onopen = null;
          staleWs.onmessage = null;
          staleWs.onerror = null;
          staleWs.onclose = null;
          try {
            staleWs.close(1000, 'replace');
          } catch {
            // ignore
          }
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsReadyReceivedRef.current = false;
        const ws = new WebSocket(
          `${protocol}//${window.location.host}/api/live?voice=${gender}&lang=${lang}`
        );
        liveWsRef.current = ws;

        // If /api/live WebSocket never completes setup (e.g. Vercel serverless or Cloudflare WS block),
        // seamlessly switch to HTTP Voice Turn mode instead of hanging in silence!
        wsStartupTimerRef.current = window.setTimeout(() => {
          wsStartupTimerRef.current = null;
          if (shouldStayLiveRef.current && !wsReadyReceivedRef.current) {
            activateHttpVoiceFallback('WebSocket /api/live startup timeout');
          }
        }, 6000);

        const scheduleAutoReconnect = (failureReason?: string, fatal = false) => {
          if (wsStartupTimerRef.current !== null) {
            window.clearTimeout(wsStartupTimerRef.current);
            wsStartupTimerRef.current = null;
          }
          if (!shouldStayLiveRef.current) {
            stopLiveSession(false, false);
            return;
          }
          if (fatal) {
            shouldStayLiveRef.current = false;
            stopLiveSession(false, false);
            setLiveStatus('error');
            liveStatusRef.current = 'error';
            const fatalMsg =
              failureReason ||
              (lang === 'de'
                ? 'Fehler bei der Verbindung zum KI-Modell. Bitte API-Schlüssel und Konfiguration prüfen.'
                : 'Błąd połączenia z modelem AI. Sprawdź klucz GEMINI_API_KEY i konfigurację serwera.');
            setVoiceError(fatalMsg);
            setAssistantReply(fatalMsg);
            return;
          }
          if (!wsReadyReceivedRef.current) {
            wsStartupFailuresRef.current += 1;
            // On Cloudflare / Vercel where WS upgrade fails immediately, switch to HTTP Voice Fallback
            if (wsStartupFailuresRef.current >= 1) {
              activateHttpVoiceFallback(failureReason || 'WebSocket unavailable');
              return;
            }
          }
          if (liveReconnectTimerRef.current !== null) return;
          stopLiveSession(true, true);
          const attempt = reconnectAttemptRef.current;
          reconnectAttemptRef.current = Math.min(attempt + 1, 5);
          const delayMs = Math.min(2500, 450 + attempt * 400);
          liveReconnectTimerRef.current = window.setTimeout(() => {
            liveReconnectTimerRef.current = null;
            if (shouldStayLiveRef.current) {
              void startLiveSessionWithOptions(
                voiceGenderRef.current,
                languageRef.current,
                true
              );
            }
          }, delayMs);
        };

        ws.onopen = () => {
          if (livePingTimerRef.current !== null) {
            window.clearInterval(livePingTimerRef.current);
          }
          livePingTimerRef.current = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'ping' }));
              } catch {
                // ignore
              }
            }
            if (liveInputCtxRef.current?.state === 'suspended') {
              void liveInputCtxRef.current.resume().catch(() => {});
            }
            livePlayerRef.current?.resumeIfNeeded();
          }, 12000);
        };

        ws.onmessage = (event) => {
          let msg: any;
          try {
            msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
          } catch {
            return;
          }

          if (msg.type === 'pong') {
            return;
          }

          if (msg.type === 'ready') {
            if (wsStartupTimerRef.current !== null) {
              window.clearTimeout(wsStartupTimerRef.current);
              wsStartupTimerRef.current = null;
            }
            wsReadyReceivedRef.current = true;
            wsStartupFailuresRef.current = 0;
            reconnectAttemptRef.current = 0;
            voiceTransportModeRef.current = 'live';
            setIsLiveActive(true);
            isLiveActiveRef.current = true;
            setLiveStatus('active');
            liveStatusRef.current = 'active';
            setVoiceError(null);
            liveInputBufRef.current = '';
            liveOutputBufRef.current = '';
            if (!isAutoReconnect) {
              const profile = VOICE_PROFILES.find((v) => v.id === gender) || VOICE_PROFILES[0];
              const readyText =
                lang === 'de'
                  ? `Live-Verbindung aktiv (Deutsch, ${profile.labelDe} · ${
                      profile.gender === 'male' ? 'männlich' : 'weiblich'
                    }). Ich höre zu.`
                  : `Połączono na żywo (Polski, głos ${profile.labelPl} · ${
                      profile.gender === 'male' ? 'męski' : 'damski'
                    }). Słucham Cię.`;
              setAssistantReply(readyText);
            }
          } else if (msg.type === 'audio' && msg.audio) {
            liveTurnGotResponseRef.current = true;
            setIsVoiceProcessing(false);
            if (liveResponseWatchdogRef.current !== null) {
              window.clearTimeout(liveResponseWatchdogRef.current);
              liveResponseWatchdogRef.current = null;
            }
            livePlayerRef.current?.enqueuePcmBase64(msg.audio, msg.sampleRate || 24000);
          } else if (msg.type === 'interrupted') {
            livePlayerRef.current?.interrupt();
            storyPlayerRef.current?.pause();
            setIsVoiceProcessing(false);
          } else if (msg.type === 'input_transcript' && msg.text) {
            const st = storyPlayerRef.current?.getStatus();
            if (st === 'playing' || st === 'loading') {
              const lowerChunk = String(msg.text).toLowerCase();
              if (!/(kontynuuj|czytaj dalej|mów dalej)/.test(lowerChunk)) {
                storyPlayerRef.current?.pause();
              }
            }
            liveInputBufRef.current = liveInputBufRef.current
              ? `${liveInputBufRef.current} ${msg.text}`.replace(/\s+/g, ' ').trim()
              : String(msg.text).trim();
            setUserTranscript(liveInputBufRef.current);
          } else if (
            (msg.type === 'output_transcript' || msg.type === 'output_text') &&
            msg.text
          ) {
            liveTurnGotResponseRef.current = true;
            setIsVoiceProcessing(false);
            if (liveResponseWatchdogRef.current !== null) {
              window.clearTimeout(liveResponseWatchdogRef.current);
              liveResponseWatchdogRef.current = null;
            }
            liveOutputBufRef.current = `${liveOutputBufRef.current}${msg.text}`;
            setAssistantReply(liveOutputBufRef.current);
          } else if (msg.type === 'turn_complete') {
            setIsVoiceProcessing(false);
            if (liveResponseWatchdogRef.current !== null) {
              window.clearTimeout(liveResponseWatchdogRef.current);
              liveResponseWatchdogRef.current = null;
            }
            if (liveInputBufRef.current.trim()) {
              appendChatMessage('user', liveInputBufRef.current, lang);
              liveInputBufRef.current = '';
            }
            if (liveOutputBufRef.current.trim()) {
              appendChatMessage('assistant', liveOutputBufRef.current, lang);
              liveOutputBufRef.current = '';
            }
            liveLastUtteranceRef.current = [];
          } else if (msg.type === 'tool_action') {
            liveTurnGotResponseRef.current = true;
            setIsVoiceProcessing(false);
            if (liveResponseWatchdogRef.current !== null) {
              window.clearTimeout(liveResponseWatchdogRef.current);
              liveResponseWatchdogRef.current = null;
            }
            const { name, args } = msg;
            if (name === 'navigateToTab') {
              void executeActions([{ type: 'navigate', tab: args.tab, explicit: true }]);
            } else if (name === 'closeOrReturnTab') {
              void executeActions([{ type: 'close_tab', targetTab: args.targetTab }]);
            } else if (name === 'setAssistantLanguage') {
              void executeActions([{ type: 'set_language', language: args.language }]);
            } else if (name === 'searchFoodGermany') {
              void executeActions([
                {
                  type: 'search_food',
                  location: args.location,
                  country: args.country,
                  category: args.category || 'all',
                },
              ]);
            } else if (name === 'searchStaysGermany') {
              void executeActions([
                {
                  type: 'search_stays',
                  location: args.location,
                  country: args.country,
                  stayType: args.stayType || 'all',
                },
              ]);
            } else if (name === 'autoBookStay') {
              void executeActions([
                {
                  type: 'auto_book_stay',
                  location: args.location,
                  country: args.country,
                  stayName: args.stayName,
                  checkIn: args.checkIn,
                  checkOut: args.checkOut,
                  guests: args.guests,
                },
              ]);
            } else if (name === 'checkTransitOrFuel') {
              void executeActions([
                {
                  type: 'search_transit',
                  mode: args.mode || 'trains',
                  from: args.from,
                  to: args.to,
                  country: args.country,
                  query: args.query,
                },
              ]);
            } else if (name === 'searchWebAndPlaces') {
              void executeActions([
                {
                  type: 'web_search',
                  query: args.query,
                  autoRedirect: Boolean(args.autoRedirect),
                  codeOnly: Boolean(args.codeOnly),
                },
              ]);
            } else if (name === 'dialPhoneNumber') {
              void executeActions([{ type: 'dial', target: args.target || 'first' }]);
            } else if (name === 'prepareWhatsappMessage') {
              void executeActions([
                {
                  type: 'prepare_whatsapp',
                  message: args.message,
                  recipientFilter: args.recipientFilter,
                },
              ]);
            } else if (name === 'setAlarm') {
              void executeActions([
                { type: 'set_alarm', time: args.time, label: args.label },
              ]);
            } else if (name === 'deleteAlarm') {
              void executeActions([
                {
                  type: 'delete_alarm',
                  time: args.time,
                  label: args.label,
                  all: Boolean(args.all),
                },
              ]);
            } else if (name === 'setReminder') {
              void executeActions([
                {
                  type: 'set_reminder',
                  delayMinutes: args.delayMinutes,
                  time: args.time,
                  text: args.text,
                },
              ]);
            } else if (name === 'deleteReminder') {
              void executeActions([
                {
                  type: 'delete_reminder',
                  text: args.text,
                  all: Boolean(args.all),
                },
              ]);
            } else if (name === 'tellOrContinueStory') {
              if (args.action === 'continue') {
                void executeActions([{ type: 'continue_story' }]);
              } else if (args.action === 'pause') {
                void executeActions([{ type: 'pause_story' }]);
              } else {
                void executeActions([{ type: 'read_story', topic: args.topic }]);
              }
            } else if (name === 'openYouTubeMusic') {
              void executeActions([
                {
                  type: 'open_youtube',
                  service: args.service === 'youtube' ? 'youtube' : 'youtube_music',
                  query: args.query,
                  ...(args.trackIndex ? { trackIndex: Number(args.trackIndex) } : {}),
                  ...(args.randomTrack ? { randomTrack: Boolean(args.randomTrack) } : {}),
                },
              ]);
            } else if (name === 'selectYouTubeTrack') {
              void executeActions([
                {
                  type: 'select_youtube_track',
                  ...(args.trackIndex ? { trackIndex: Number(args.trackIndex) } : {}),
                  ...(args.randomTrack ? { randomTrack: Boolean(args.randomTrack) } : {}),
                  ...(args.nextTrack ? { nextTrack: Boolean(args.nextTrack) } : {}),
                },
              ]);
            } else if (name === 'closeYouTube') {
              void executeActions([{ type: 'close_youtube' }]);
            } else if (name === 'openBrowser') {
              void executeActions([
                {
                  type: 'open_browser',
                  query: args.query,
                  openExternalChrome: Boolean(args.openExternalChrome),
                },
              ]);
            } else if (name === 'selectBrowserArticle') {
              void executeActions([
                {
                  type: 'select_article',
                  articleIndex: Number(args.articleIndex) || 1,
                  readAloud: Boolean(args.readAloud),
                },
              ]);
            } else if (name === 'closeArticle') {
              void executeActions([{ type: 'close_article' }]);
            } else if (name === 'closeBrowser') {
              void executeActions([{ type: 'close_browser' }]);
            } else if (name === 'manageCalculator') {
              if (args.action === 'close') {
                void executeActions([{ type: 'close_calculator' }]);
              } else {
                void executeActions([
                  { type: 'open_calculator', expression: args.expression },
                ]);
              }
            } else if (name === 'manageNotepad') {
              if (args.action === 'close') {
                void executeActions([{ type: 'close_notepad' }]);
              } else if (args.action === 'delete') {
                void executeActions([
                  { type: 'delete_note', text: args.text, all: Boolean(args.all) },
                ]);
              } else if (args.action === 'write' && args.text) {
                void executeActions([{ type: 'write_note', text: args.text }]);
              } else {
                void executeActions([{ type: 'open_notepad' }]);
              }
            } else if (name === 'openPhoneApp') {
              void executeActions([
                {
                  type: 'open_app',
                  app: args.app,
                  query: args.query,
                  contactName: args.contactName,
                },
              ]);
            }
          } else if (msg.type === 'reconnect_needed' || msg.type === 'closed') {
            scheduleAutoReconnect();
          } else if (msg.type === 'error') {
            const isFatal =
              Boolean(msg.fatal) ||
              msg.status === 400 ||
              msg.status === 401 ||
              msg.status === 403 ||
              msg.status === 404;
            setVoiceError(msg.message || 'Błąd połączenia głosowego na żywo.');
            if (shouldStayLiveRef.current && !isFatal) {
              scheduleAutoReconnect(msg.message, false);
            } else {
              scheduleAutoReconnect(msg.message, true);
            }
          }
        };

        ws.onerror = () => {
          scheduleAutoReconnect(
            lang === 'de'
              ? 'WebSocket-Verbindung fehlgeschlagen.'
              : 'Błąd połączenia WebSocket /api/live.'
          );
        };

        ws.onclose = () => {
          if (shouldStayLiveRef.current && voiceTransportModeRef.current === 'live') {
            scheduleAutoReconnect();
          } else if (!shouldStayLiveRef.current) {
            stopLiveSession(false, false);
          }
        };
      } catch (err: any) {
        if (
          err?.name === 'NotAllowedError' ||
          err?.name === 'NotFoundError' ||
          err?.name === 'SecurityError' ||
          err?.name === 'TypeError'
        ) {
          shouldStayLiveRef.current = false;
          const micErr =
            err?.name === 'NotFoundError'
              ? 'Nie wykryto mikrofonu na tym urządzeniu.'
              : 'Nie udało się uruchomić mikrofonu do rozmowy na żywo. Sprawdź uprawnienia mikrofonu w przeglądarce.';
          setVoiceError(micErr);
          setAssistantReply(micErr);
          stopLiveSession(false, false);
          setLiveStatus('error');
          liveStatusRef.current = 'error';
        } else if (shouldStayLiveRef.current) {
          wsStartupFailuresRef.current += 1;
          if (wsStartupFailuresRef.current >= 2) {
            shouldStayLiveRef.current = false;
            stopLiveSession(false, false);
            setLiveStatus('error');
            liveStatusRef.current = 'error';
            const errMsg =
              err?.message ||
              'Nie udało się uruchomić sesji głosowej. Sprawdź połączenie z internetem i mikrofon.';
            setVoiceError(errMsg);
            setAssistantReply(errMsg);
            return;
          }
          const attempt = reconnectAttemptRef.current;
          reconnectAttemptRef.current = Math.min(attempt + 1, 5);
          liveReconnectTimerRef.current = window.setTimeout(() => {
            liveReconnectTimerRef.current = null;
            if (shouldStayLiveRef.current) {
              void startLiveSessionWithOptions(
                voiceGenderRef.current,
                languageRef.current,
                true
              );
            }
          }, 1000);
        } else {
          stopLiveSession(false, false);
          setLiveStatus('error');
          liveStatusRef.current = 'error';
        }
      }
    },
    [
      appendChatMessage,
      clearVoiceTimers,
      executeActions,
      resetVadBuffer,
      stopLiveSession,
    ]
  );

  useEffect(() => {
    const handleWakeup = () => {
      if (!shouldStayLiveRef.current) return;
      if (liveInputCtxRef.current?.state === 'suspended') {
        void liveInputCtxRef.current.resume().catch(() => {});
      }
      livePlayerRef.current?.resumeIfNeeded();
      if (voiceTransportModeRef.current === 'live') {
        const ws = liveWsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          void startLiveSessionWithOptions(voiceGenderRef.current, languageRef.current, true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleWakeup);
    window.addEventListener('online', handleWakeup);
    return () => {
      document.removeEventListener('visibilitychange', handleWakeup);
      window.removeEventListener('online', handleWakeup);
    };
  }, [startLiveSessionWithOptions]);

  startLiveSessionRef.current = async (gender: VoiceGender, lang: AssistantLanguage) => {
    stopLiveSession(true, true);
    await startLiveSessionWithOptions(gender, lang, false);
  };

  const acquireCameraStream = useCallback(
    async (facing: CameraFacingMode) => {
      setVideoError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setVideoError('Twoja przeglądarka nie obsługuje dostępu do kamery.');
        return;
      }
      try {
        if (liveVideoStreamRef.current) {
          liveVideoStreamRef.current.getTracks().forEach((t) => t.stop());
          liveVideoStreamRef.current = null;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack) {
          videoTrack.onended = () => stopVideoShare();
        }
        liveVideoStreamRef.current = stream;
        attachStreamToVideoElements(stream);
        setCameraFacingMode(facing);
        cameraFacingRef.current = facing;
        setVideoMode('camera');
        videoModeRef.current = 'camera';
        startVideoFrameLoop();

        if (!isLiveActiveRef.current && liveStatusRef.current !== 'connecting') {
          await startLiveSessionWithOptions(voiceGenderRef.current, languageRef.current);
        }
      } catch (err: any) {
        setVideoError(
          err?.name === 'NotAllowedError'
            ? 'Odmówiono dostępu do kamery w przeglądarce.'
            : 'Nie udało się uruchomić wybranej kamery.'
        );
      }
    },
    [attachStreamToVideoElements, startLiveSessionWithOptions, startVideoFrameLoop, stopVideoShare]
  );

  const handleToggleCamera = useCallback(async () => {
    if (videoModeRef.current === 'camera') {
      stopVideoShare();
      return;
    }
    await acquireCameraStream(cameraFacingRef.current);
  }, [acquireCameraStream, stopVideoShare]);

  const handleSwitchCameraFacing = useCallback(async () => {
    const nextFacing: CameraFacingMode =
      cameraFacingRef.current === 'environment' ? 'user' : 'environment';
    await acquireCameraStream(nextFacing);
  }, [acquireCameraStream]);

  const handleToggleScreenShare = useCallback(async () => {
    if (videoModeRef.current === 'screen') {
      stopVideoShare();
      return;
    }
    setVideoError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setVideoError(
        'Udostępnianie ekranu nie jest wspierane w tej przeglądarce mobilnej (użyj Chrome / Safari lub kamery).'
      );
      return;
    }
    try {
      if (liveVideoStreamRef.current) {
        liveVideoStreamRef.current.getTracks().forEach((t) => t.stop());
        liveVideoStreamRef.current = null;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
      const [screenTrack] = stream.getVideoTracks();
      if (screenTrack) {
        screenTrack.onended = () => stopVideoShare();
      }
      liveVideoStreamRef.current = stream;
      attachStreamToVideoElements(stream);
      setVideoMode('screen');
      videoModeRef.current = 'screen';
      startVideoFrameLoop();

      if (!isLiveActiveRef.current && liveStatusRef.current !== 'connecting') {
        await startLiveSessionWithOptions(voiceGenderRef.current, languageRef.current);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setVideoError(
          err?.name === 'NotAllowedError'
            ? 'Przerwano lub odmówiono udostępniania ekranu.'
            : 'Nie udało się udostępnić ekranu na tym urządzeniu.'
        );
      }
    }
  }, [attachStreamToVideoElements, startLiveSessionWithOptions, startVideoFrameLoop, stopVideoShare]);

  const handleToggleLive = useCallback(async () => {
    if (isLiveActive || liveStatus === 'connecting' || shouldStayLiveRef.current) {
      shouldStayLiveRef.current = false;
      stopLiveSession(false, false);
      return;
    }
    await startLiveSessionWithOptions(voiceGenderRef.current, languageRef.current);
  }, [isLiveActive, liveStatus, stopLiveSession, startLiveSessionWithOptions]);

  const handleSelectVoiceGender = useCallback(
    async (gender: VoiceGender) => {
      setVoiceGender(gender);
      voiceGenderRef.current = gender;
      if (isLiveActive || shouldStayLiveRef.current) {
        stopLiveSession(true, true);
        await startLiveSessionWithOptions(gender, languageRef.current, false);
      }
    },
    [isLiveActive, stopLiveSession, startLiveSessionWithOptions]
  );

  useEffect(() => {
    return () => {
      shouldStayLiveRef.current = false;
      stopLiveSession(false, false);
    };
  }, [stopLiveSession]);

  // ---------------------------------------------------------------------------
  // UI Handlers
  // ---------------------------------------------------------------------------
  const handleSelectTab = (tab: TabId) => {
    switchTab(tab);
    setDetachedWindow(null);
    if (tab === 'stays' && !staysData && !isStaysLoading && (locationInput.trim() || coordinates)) {
      void performStaysSearch(locationInput, stayType, coordinates);
    } else if (tab === 'food' && !foodData && !isFoodLoading && (locationInput.trim() || coordinates)) {
      void performFoodSearch(locationInput, foodCategory, coordinates);
    }
  };

  const handleSelectFoodCategory = (cat: FoodCategory) => {
    setFoodCategory(cat);
    if (locationInput.trim() || coordinates) {
      void performFoodSearch(locationInput, cat, coordinates);
    }
  };

  const handleSelectStayType = (st: StayType) => {
    setStayType(st);
    if (locationInput.trim() || coordinates) {
      void performStaysSearch(locationInput, st, coordinates);
    }
  };

  const handleChangeCheckIn = (rawVal: string) => {
    const safeIn = clampStayDate(rawVal, checkIn);
    setCheckIn(safeIn);
    if (checkOut <= safeIn) {
      setCheckOut(addDaysToIso(safeIn, 2));
    }
  };

  const handleChangeCheckOut = (rawVal: string) => {
    const minOut = addDaysToIso(checkIn, 1);
    const safeOut = clampStayDate(rawVal, minOut);
    setCheckOut(safeOut <= checkIn ? minOut : safeOut);
  };

  const handleApplyDatePreset = (newIn: string, newOut: string) => {
    const safeIn = clampStayDate(newIn);
    const safeOut = clampStayDate(newOut, addDaysToIso(safeIn, 2));
    const finalOut = safeOut <= safeIn ? addDaysToIso(safeIn, 2) : safeOut;
    setCheckIn(safeIn);
    setCheckOut(finalOut);
    if (locationInput.trim() || coordinates) {
      void performStaysSearch(locationInput, stayType, coordinates, safeIn, finalOut);
    }
  };

  const handleSelectTransitMode = (m: TransitMode) => {
    setTransitMode(m);
    void performTransitSearch(m, transitFrom || locationInput, transitTo);
  };

  const handleQuickFuelNearby = () => {
    setTransitMode('fuel');
    if (coordinatesRef.current) {
      void performTransitSearch('fuel', transitFrom || locationRef.current, '');
    } else if (locationRef.current.trim()) {
      void performTransitSearch('fuel', locationRef.current, '');
      detectFastLocation(false, false, 'fuel');
    } else {
      detectFastLocation(true, true, 'fuel');
    }
  };

  const handleBackFromDetachedWindow = () => {
    const target: TabId =
      previousTab && previousTab !== detachedWindow ? previousTab : 'assistant';
    setDetachedWindow(null);
    switchTab(target);
  };

  const handleCloseFoodTab = () => {
    const fallbackTab: TabId =
      previousTab && previousTab !== 'food' ? previousTab : 'assistant';
    switchTab(fallbackTab);
  };

  const appBody = (
    <div className="min-h-dvh overflow-x-hidden bg-[#050505] text-[#F3F5F2] flex flex-col">
      {isGmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2 text-xs md:text-sm text-center shrink-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isLiveActive={isLiveActive}
        liveStatus={liveStatus}
        onToggleLive={handleToggleLive}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 py-3 sm:px-6 sm:py-5">
        {/* Tab 1: Pure Assistant Conversation Window (Full-interface vertical scrolling) */}
        {activeTab === 'assistant' && (
          <div className="flex flex-1 flex-col gap-4">
            <VoiceDock
              language={language}
              onSelectLanguage={(lang) => void handleSelectLanguage(lang)}
              voiceGender={voiceGender}
              onSelectVoiceGender={(g) => void handleSelectVoiceGender(g)}
              isLiveActive={isLiveActive}
              liveStatus={liveStatus}
              micLevel={micLevel}
              onToggleLive={handleToggleLive}
              isMuted={isMuted}
              onToggleMute={handleToggleMute}
              videoMode={videoMode}
              cameraFacingMode={cameraFacingMode}
              videoError={videoError}
              videoPreviewRef={videoPreviewRef}
              onToggleCamera={() => void handleToggleCamera()}
              onSwitchCameraFacing={() => void handleSwitchCameraFacing()}
              onToggleScreenShare={() => void handleToggleScreenShare()}
              onStopVideo={stopVideoShare}
              assistantReply={assistantReply}
              userTranscript={userTranscript}
              voiceError={voiceError}
              isVoiceProcessing={isVoiceProcessing}
              canFinishUtterance={hasBufferedSpeech}
              onFinishUtterance={handleFinishUtterance}
              onReplayReply={handleReplayReply}
              isCommandLoading={isCommandLoading}
              onSubmitCommand={(txt) => void handleSubmitTextCommand(txt)}
              alarms={alarms}
              reminders={reminders}
              onRemoveAlarm={(id) =>
                setAlarms((prev) => prev.filter((a) => a.id !== id))
              }
              onRemoveReminder={(id) =>
                setReminders((prev) => prev.filter((r) => r.id !== id))
              }
              lastLaunchedApp={lastLaunchedApp}
              onDismissLaunchedApp={() => setLastLaunchedApp(null)}
              storyStatus={storyStatus}
              storyProgress={storyProgress}
              onPauseStory={() => {
                storyPlayerRef.current?.pause();
              }}
              onResumeStory={() => {
                void storyPlayerRef.current?.resume();
              }}
              onStopStory={() => {
                storyPlayerRef.current?.stop();
              }}
              onOpenCalculator={() => setIsCalculatorOpen(true)}
              onOpenNotepad={() => setIsNotepadOpen(true)}
              onOpenBrowser={() => setIsBrowserOpen(true)}
              onOpenYoutube={() =>
                void executeActions([
                  {
                    type: 'open_youtube',
                    service: 'youtube_music',
                    query: language === 'de' ? 'Musik Hits' : 'Polskie hity',
                  },
                ])
              }
              onOpenWhatsapp={() => setIsWhatsappModalOpen(true)}
              notesCount={notepadNotes.length}
            />

            {(activeYoutubeVideo || youtubeResults.length > 0 || isYoutubeLoading || youtubeError) && (
              <div className="w-full shrink-0">
                <YouTubePlayerPanel
                  language={language}
                  query={youtubeQuery}
                  results={youtubeResults}
                  activeVideo={activeYoutubeVideo}
                  isLoading={isYoutubeLoading}
                  error={youtubeError}
                  onSelectVideo={(vid) => setActiveYoutubeVideo(vid)}
                  onPlayAnother={() =>
                    void executeActions([
                      { type: 'select_youtube_track', randomTrack: true, nextTrack: true },
                    ])
                  }
                  onClose={() => {
                    setActiveYoutubeVideo(null);
                    setYoutubeResults([]);
                    setYoutubeError(null);
                  }}
                />
              </div>
            )}

            {(isBrowserOpen || webSearchData || isWebSearchLoading || webSearchError || activeArticle || isArticleLoading) && (
              <div className="w-full shrink-0">
                <WebSearchResultsPanel
                  language={language}
                  isBrowserOpen={isBrowserOpen}
                  data={webSearchData}
                  isLoading={isWebSearchLoading}
                  error={webSearchError}
                  activeArticle={activeArticle}
                  isArticleLoading={isArticleLoading}
                  articleError={articleError}
                  onSearchQuery={(q) => void performWebSearch(q, false)}
                  onOpenArticle={(item, readAloud) =>
                    void openBrowserArticle(item, Boolean(readAloud), (txt) => {
                      setAssistantReply(txt);
                      appendChatMessage('assistant', txt);
                      void speakWithMiekiszon(txt);
                    })
                  }
                  onCloseArticle={() => {
                    setActiveArticle(null);
                    setArticleError(null);
                  }}
                  onReadArticleAloud={(article) => {
                    const speech = `${article.title}. ${article.content.slice(0, 750)}`;
                    setAssistantReply(speech);
                    appendChatMessage('assistant', speech);
                    void speakWithMiekiszon(speech);
                  }}
                  onOpenExternalChrome={(q) =>
                    launchExternalApp(getAppLaunchInfo('chrome', q))
                  }
                  onClose={() => void executeActions([{ type: 'close_browser' }])}
                  onOpenDialer={(target) => setDialTarget(target)}
                />
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Pure Food Search + Google Maps + Phone Ordering + Inline Found Results */}
        {activeTab === 'food' && (
          <div className="flex-1 space-y-4">
            {(activeYoutubeVideo || youtubeResults.length > 0 || isYoutubeLoading || youtubeError) && (
              <YouTubePlayerPanel
                language={language}
                query={youtubeQuery}
                results={youtubeResults}
                activeVideo={activeYoutubeVideo}
                isLoading={isYoutubeLoading}
                error={youtubeError}
                onSelectVideo={(vid) => setActiveYoutubeVideo(vid)}
                onPlayAnother={() =>
                  void executeActions([
                    { type: 'select_youtube_track', randomTrack: true, nextTrack: true },
                  ])
                }
                onClose={() => {
                  setActiveYoutubeVideo(null);
                  setYoutubeResults([]);
                  setYoutubeError(null);
                }}
              />
            )}
            {(isBrowserOpen || webSearchData || isWebSearchLoading || webSearchError || activeArticle || isArticleLoading) && (
              <WebSearchResultsPanel
                language={language}
                isBrowserOpen={isBrowserOpen}
                data={webSearchData}
                isLoading={isWebSearchLoading}
                error={webSearchError}
                activeArticle={activeArticle}
                isArticleLoading={isArticleLoading}
                articleError={articleError}
                onSearchQuery={(q) => void performWebSearch(q, false)}
                onOpenArticle={(item, readAloud) =>
                  void openBrowserArticle(item, Boolean(readAloud), (txt) => {
                    setAssistantReply(txt);
                    appendChatMessage('assistant', txt);
                    void speakWithMiekiszon(txt);
                  })
                }
                onCloseArticle={() => {
                  setActiveArticle(null);
                  setArticleError(null);
                }}
                onReadArticleAloud={(article) => {
                  const speech = `${article.title}. ${article.content.slice(0, 750)}`;
                  setAssistantReply(speech);
                  appendChatMessage('assistant', speech);
                  void speakWithMiekiszon(speech);
                }}
                onOpenExternalChrome={(q) =>
                  launchExternalApp(getAppLaunchInfo('chrome', q))
                }
                onClose={() => void executeActions([{ type: 'close_browser' }])}
                onOpenDialer={(target) => setDialTarget(target)}
              />
            )}
            <FoodTab
              category={foodCategory}
              onSelectCategory={handleSelectFoodCategory}
              locationInput={locationInput}
              onLocationInputChange={setLocationInput}
              onSearchByLocation={() =>
                void performFoodSearch(locationInput, foodCategory, coordinates)
              }
              onUseMyLocation={() => detectFastLocation(true, true)}
              hasGpsLock={Boolean(coordinates)}
              isLocating={isLocating}
              coordinates={coordinates}
              hasMapsProvider={Boolean(mapsApiKey)}
              data={foodData}
              isLoading={isFoodLoading}
              error={foodError}
              onOpenDialer={(target) => setDialTarget(target)}
              onRetrySearch={() =>
                void performFoodSearch(locationInput, foodCategory, coordinates)
              }
              onCloseTab={handleCloseFoodTab}
            />
          </div>
        )}

        {/* Tab 3: Pure Stays Search + Automatic Booking + Inline Found Results */}
        {activeTab === 'stays' && (
          <div className="flex-1 space-y-4">
            {(activeYoutubeVideo || youtubeResults.length > 0 || isYoutubeLoading || youtubeError) && (
              <YouTubePlayerPanel
                language={language}
                query={youtubeQuery}
                results={youtubeResults}
                activeVideo={activeYoutubeVideo}
                isLoading={isYoutubeLoading}
                error={youtubeError}
                onSelectVideo={(vid) => setActiveYoutubeVideo(vid)}
                onPlayAnother={() =>
                  void executeActions([
                    { type: 'select_youtube_track', randomTrack: true, nextTrack: true },
                  ])
                }
                onClose={() => {
                  setActiveYoutubeVideo(null);
                  setYoutubeResults([]);
                  setYoutubeError(null);
                }}
              />
            )}
            {(isBrowserOpen || webSearchData || isWebSearchLoading || webSearchError || activeArticle || isArticleLoading) && (
              <WebSearchResultsPanel
                language={language}
                isBrowserOpen={isBrowserOpen}
                data={webSearchData}
                isLoading={isWebSearchLoading}
                error={webSearchError}
                activeArticle={activeArticle}
                isArticleLoading={isArticleLoading}
                articleError={articleError}
                onSearchQuery={(q) => void performWebSearch(q, false)}
                onOpenArticle={(item, readAloud) =>
                  void openBrowserArticle(item, Boolean(readAloud), (txt) => {
                    setAssistantReply(txt);
                    appendChatMessage('assistant', txt);
                    void speakWithMiekiszon(txt);
                  })
                }
                onCloseArticle={() => {
                  setActiveArticle(null);
                  setArticleError(null);
                }}
                onReadArticleAloud={(article) => {
                  const speech = `${article.title}. ${article.content.slice(0, 750)}`;
                  setAssistantReply(speech);
                  appendChatMessage('assistant', speech);
                  void speakWithMiekiszon(speech);
                }}
                onOpenExternalChrome={(q) =>
                  launchExternalApp(getAppLaunchInfo('chrome', q))
                }
                onClose={() => void executeActions([{ type: 'close_browser' }])}
                onOpenDialer={(target) => setDialTarget(target)}
              />
            )}
            <StaysTab
              stayType={stayType}
              onSelectStayType={handleSelectStayType}
              locationInput={locationInput}
              onLocationInputChange={setLocationInput}
              onSearchByLocation={() =>
                void performStaysSearch(locationInput, stayType, coordinates)
              }
              onUseMyLocation={() => detectFastLocation(true, true)}
              hasGpsLock={Boolean(coordinates)}
              isLocating={isLocating}
              checkIn={checkIn}
              checkOut={checkOut}
              guests={guests}
              onChangeCheckIn={handleChangeCheckIn}
              onChangeCheckOut={handleChangeCheckOut}
              onApplyDatePreset={handleApplyDatePreset}
              onChangeGuests={setGuests}
              data={staysData}
              isLoading={isStaysLoading}
              error={staysError}
              bookings={stayBookings}
              isAutoBooking={isAutoBooking}
              onOpenAutoBookModal={(stay) => setAutoBookingTarget(stay)}
              onAutoBookBest={() => {
                const bestStay = staysDataRef.current?.results?.[0];
                void performAutoBookStay({
                  stay: bestStay,
                  location: locationInput,
                  checkIn,
                  checkOut,
                  guests,
                });
              }}
              onRemoveBooking={(id) =>
                setStayBookings((prev) => prev.filter((b) => b.id !== id))
              }
              onOpenDialer={(target) => setDialTarget(target)}
              onRetrySearch={() =>
                void performStaysSearch(locationInput, stayType, coordinates)
              }
              onOpenDetached={() => setDetachedWindow('stays')}
            />
          </div>
        )}

        {/* Tab 4: Transit (Trains, S-Bahn, Buses, Car Driving Route & Fuel Prices) + Inline Found Results */}
        {activeTab === 'transit' && (
          <div className="flex-1 space-y-4">
            {(activeYoutubeVideo || youtubeResults.length > 0 || isYoutubeLoading || youtubeError) && (
              <YouTubePlayerPanel
                language={language}
                query={youtubeQuery}
                results={youtubeResults}
                activeVideo={activeYoutubeVideo}
                isLoading={isYoutubeLoading}
                error={youtubeError}
                onSelectVideo={(vid) => setActiveYoutubeVideo(vid)}
                onPlayAnother={() =>
                  void executeActions([
                    { type: 'select_youtube_track', randomTrack: true, nextTrack: true },
                  ])
                }
                onClose={() => {
                  setActiveYoutubeVideo(null);
                  setYoutubeResults([]);
                  setYoutubeError(null);
                }}
              />
            )}
            {(isBrowserOpen || webSearchData || isWebSearchLoading || webSearchError || activeArticle || isArticleLoading) && (
              <WebSearchResultsPanel
                language={language}
                isBrowserOpen={isBrowserOpen}
                data={webSearchData}
                isLoading={isWebSearchLoading}
                error={webSearchError}
                activeArticle={activeArticle}
                isArticleLoading={isArticleLoading}
                articleError={articleError}
                onSearchQuery={(q) => void performWebSearch(q, false)}
                onOpenArticle={(item, readAloud) =>
                  void openBrowserArticle(item, Boolean(readAloud), (txt) => {
                    setAssistantReply(txt);
                    appendChatMessage('assistant', txt);
                    void speakWithMiekiszon(txt);
                  })
                }
                onCloseArticle={() => {
                  setActiveArticle(null);
                  setArticleError(null);
                }}
                onReadArticleAloud={(article) => {
                  const speech = `${article.title}. ${article.content.slice(0, 750)}`;
                  setAssistantReply(speech);
                  appendChatMessage('assistant', speech);
                  void speakWithMiekiszon(speech);
                }}
                onOpenExternalChrome={(q) =>
                  launchExternalApp(getAppLaunchInfo('chrome', q))
                }
                onClose={() => void executeActions([{ type: 'close_browser' }])}
                onOpenDialer={(target) => setDialTarget(target)}
              />
            )}
            <TransitTab
              mode={transitMode}
              onSelectMode={handleSelectTransitMode}
              fromInput={transitFrom}
              toInput={transitTo}
              onChangeFrom={setTransitFrom}
              onChangeTo={setTransitTo}
              onSearch={() =>
                void performTransitSearch(
                  transitMode,
                  transitFrom || locationInput,
                  transitTo
                )
              }
              data={transitData}
              isLoading={isTransitLoading}
              error={transitError}
              coordinates={coordinates}
              globalLocationInput={locationInput}
              hasMapsProvider={Boolean(mapsApiKey)}
              onUseMyLocation={() => detectFastLocation(true, true)}
              onQuickFuelNearby={handleQuickFuelNearby}
              isLocating={isLocating}
              onOpenDetached={() => setDetachedWindow('transit')}
            />
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t border-[#141814] bg-[#050505] py-2.5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-[11px] text-[#6B7369] sm:px-6">
          <span>Miękiszon</span>
          <span>PL / DE</span>
        </div>
      </footer>

      <DetachedWindowModal
        windowTab={detachedWindow}
        previousTab={previousTab}
        onClose={() => setDetachedWindow(null)}
        onBackToPrevious={handleBackFromDetachedWindow}
      >
        {(activeYoutubeVideo || youtubeResults.length > 0 || isYoutubeLoading || youtubeError) && (
          <div className="mb-4">
            <YouTubePlayerPanel
              language={language}
              query={youtubeQuery}
              results={youtubeResults}
              activeVideo={activeYoutubeVideo}
              isLoading={isYoutubeLoading}
              error={youtubeError}
              onSelectVideo={(vid) => setActiveYoutubeVideo(vid)}
              onPlayAnother={() =>
                void executeActions([
                  { type: 'select_youtube_track', randomTrack: true, nextTrack: true },
                ])
              }
              onClose={() => {
                setActiveYoutubeVideo(null);
                setYoutubeResults([]);
                setYoutubeError(null);
              }}
            />
          </div>
        )}
        {(isBrowserOpen || webSearchData || isWebSearchLoading || webSearchError || activeArticle || isArticleLoading) && (
          <div className="mb-4">
            <WebSearchResultsPanel
              language={language}
              isBrowserOpen={isBrowserOpen}
              data={webSearchData}
              isLoading={isWebSearchLoading}
              error={webSearchError}
              activeArticle={activeArticle}
              isArticleLoading={isArticleLoading}
              articleError={articleError}
              onSearchQuery={(q) => void performWebSearch(q, false)}
              onOpenArticle={(item, readAloud) =>
                void openBrowserArticle(item, Boolean(readAloud), (txt) => {
                  setAssistantReply(txt);
                  appendChatMessage('assistant', txt);
                  void speakWithMiekiszon(txt);
                })
              }
              onCloseArticle={() => {
                setActiveArticle(null);
                setArticleError(null);
              }}
              onReadArticleAloud={(article) => {
                const speech = `${article.title}. ${article.content.slice(0, 750)}`;
                setAssistantReply(speech);
                appendChatMessage('assistant', speech);
                void speakWithMiekiszon(speech);
              }}
              onOpenExternalChrome={(q) =>
                launchExternalApp(getAppLaunchInfo('chrome', q))
              }
              onClose={() => void executeActions([{ type: 'close_browser' }])}
              onOpenDialer={(target) => setDialTarget(target)}
            />
          </div>
        )}
        {detachedWindow === 'stays' && (
          <StaysTab
            stayType={stayType}
            onSelectStayType={handleSelectStayType}
            locationInput={locationInput}
            onLocationInputChange={setLocationInput}
            onSearchByLocation={() =>
              void performStaysSearch(locationInput, stayType, coordinates)
            }
            onUseMyLocation={() => detectFastLocation(true, true)}
            hasGpsLock={Boolean(coordinates)}
            isLocating={isLocating}
            checkIn={checkIn}
            checkOut={checkOut}
            guests={guests}
            onChangeCheckIn={handleChangeCheckIn}
            onChangeCheckOut={handleChangeCheckOut}
            onApplyDatePreset={handleApplyDatePreset}
            onChangeGuests={setGuests}
            data={staysData}
            isLoading={isStaysLoading}
            error={staysError}
            bookings={stayBookings}
            isAutoBooking={isAutoBooking}
            onOpenAutoBookModal={(stay) => setAutoBookingTarget(stay)}
            onAutoBookBest={() => {
              const bestStay = staysDataRef.current?.results?.[0];
              void performAutoBookStay({
                stay: bestStay,
                location: locationInput,
                checkIn,
                checkOut,
                guests,
              });
            }}
            onRemoveBooking={(id) =>
              setStayBookings((prev) => prev.filter((b) => b.id !== id))
            }
            onOpenDialer={(target) => setDialTarget(target)}
            onRetrySearch={() =>
              void performStaysSearch(locationInput, stayType, coordinates)
            }
          />
        )}
        {detachedWindow === 'transit' && (
          <TransitTab
            mode={transitMode}
            onSelectMode={handleSelectTransitMode}
            fromInput={transitFrom}
            toInput={transitTo}
            onChangeFrom={setTransitFrom}
            onChangeTo={setTransitTo}
            onSearch={() =>
              void performTransitSearch(
                transitMode,
                transitFrom || locationInput,
                transitTo
              )
            }
            data={transitData}
            isLoading={isTransitLoading}
            error={transitError}
            coordinates={coordinates}
            globalLocationInput={locationInput}
            hasMapsProvider={Boolean(mapsApiKey)}
            onUseMyLocation={() => detectFastLocation(true, true)}
            onQuickFuelNearby={handleQuickFuelNearby}
            isLocating={isLocating}
          />
        )}
      </DetachedWindowModal>

      <AutoBookingModal
        stay={autoBookingTarget}
        checkIn={checkIn}
        checkOut={checkOut}
        guests={guests}
        isSubmitting={isAutoBooking}
        onClose={() => setAutoBookingTarget(null)}
        onConfirm={(payload) => void performAutoBookStay(payload)}
      />

      <WhatsappModal
        isOpen={isWhatsappModalOpen}
        onClose={() => setIsWhatsappModalOpen(false)}
        contacts={whatsappContacts}
        onUpdateContacts={setWhatsappContacts}
        message={whatsappMessage}
        onChangeMessage={setWhatsappMessage}
      />

      <DialerModal target={dialTarget} onClose={() => setDialTarget(null)} />

      <CalculatorModal
        isOpen={isCalculatorOpen}
        language={language}
        initialExpression={calculatorExpr}
        onClose={() => setIsCalculatorOpen(false)}
      />

      <NotepadModal
        isOpen={isNotepadOpen}
        language={language}
        notes={notepadNotes}
        onAddNote={(text) => {
          setNotepadNotes((prev) => [
            {
              id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
              text,
              createdAt: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            },
            ...prev,
          ]);
        }}
        onDeleteNote={(id) =>
          setNotepadNotes((prev) => prev.filter((n) => n.id !== id))
        }
        onClearAll={() => setNotepadNotes([])}
        onClose={() => setIsNotepadOpen(false)}
      />

      <OfflineIndicator />
    </div>
  );

  if (mapsApiKey) {
    return (
      <APIProvider
        apiKey={mapsApiKey}
        libraries={['maps', 'places', 'marker', 'core', 'routes']}
        language={language === 'de' ? 'de' : 'pl'}
      >
        <GooglePlacesFoodBridge onRegisterSearch={handleRegisterGoogleFoodSearch} />
        {appBody}
      </APIProvider>
    );
  }

  return appBody;
}
