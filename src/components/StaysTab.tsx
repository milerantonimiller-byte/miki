import React, { useRef, useState } from 'react';
import {
  BedDouble,
  Calendar,
  ExternalLink,
  MapPin,
  PhoneCall,
  Users,
  AlertCircle,
  Zap,
  CheckCircle2,
  Trash2,
  Loader2,
  Navigation,
  Search,
  X,
  ArrowUpDown,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DialTarget,
  StayBookingRecord,
  StayPriceFilter,
  StayResult,
  StayType,
  StaysSearchResponse,
} from '../types';
import {
  buildAirbnbDeepLink,
  buildBookingDeepLink,
  buildExpediaDeepLink,
  buildFewoDeepLink,
  buildHrsDeepLink,
  countStayNights,
  formatPolishDateDisplay,
  getCurrentStayDates,
  getMaxStayIsoDate,
  getNextWeekendDates,
  getTodayIsoDate,
  parseStayPriceEur,
  sanitizePhoneForTel,
  stripHyphensForCodeOnly,
} from '../utils/location';
import staysBannerImg from '../assets/images/stays_hotel_banner_1795279672880.jpg';

interface StaysTabProps {
  stayType: StayType;
  onSelectStayType: (type: StayType) => void;
  locationInput: string;
  onLocationInputChange: (val: string) => void;
  onSearchByLocation: () => void;
  onUseMyLocation: () => void;
  hasGpsLock: boolean;
  isLocating: boolean;
  checkIn: string;
  checkOut: string;
  guests: number;
  onChangeCheckIn: (val: string) => void;
  onChangeCheckOut: (val: string) => void;
  onApplyDatePreset: (checkIn: string, checkOut: string) => void;
  onChangeGuests: (val: number) => void;
  data: StaysSearchResponse | null;
  isLoading: boolean;
  error: string | null;
  bookings: StayBookingRecord[];
  isAutoBooking: boolean;
  onOpenAutoBookModal: (stay: StayResult) => void;
  onAutoBookBest: () => void;
  onRemoveBooking: (id: string) => void;
  onOpenDialer: (target: DialTarget) => void;
  onRetrySearch: () => void;
  onSearchByPrice?: (minPriceEur: number | null, maxPriceEur: number | null) => void;
  onOpenDetached?: () => void;
}

const STAY_TYPES: { id: StayType; label: string }[] = [
  { id: 'all', label: 'Wszystkie noclegi' },
  { id: 'rooms', label: 'Pokoje' },
  { id: 'hotel', label: 'Hotele' },
  { id: 'apartment', label: 'Apartamenty' },
  { id: 'budget', label: 'Budżetowe' },
];

const PRICE_PRESETS: {
  id: Exclude<StayPriceFilter, 'custom'>;
  label: string;
  min: number | null;
  max: number | null;
}[] = [
  { id: 'all', label: 'Wszystkie ceny', min: null, max: null },
  { id: 'under_60', label: 'Do 60 €', min: null, max: 60 },
  { id: '60_120', label: '60–120 €', min: 60, max: 120 },
  { id: 'over_120', label: '120+ €', min: 120, max: null },
];

export const StaysTab: React.FC<StaysTabProps> = ({
  stayType,
  onSelectStayType,
  locationInput,
  onLocationInputChange,
  onSearchByLocation,
  onUseMyLocation,
  isLocating,
  checkIn,
  checkOut,
  guests,
  onChangeCheckIn,
  onChangeCheckOut,
  onApplyDatePreset,
  onChangeGuests,
  data,
  isLoading,
  error,
  bookings,
  isAutoBooking,
  onOpenAutoBookModal,
  onAutoBookBest,
  onRemoveBooking,
  onOpenDialer,
  onRetrySearch,
  onSearchByPrice,
}) => {
  const [bannerError, setBannerError] = useState(false);
  const [showBookingFilters, setShowBookingFilters] = useState(false);
  const [priceFilter, setPriceFilter] = useState<StayPriceFilter>('all');
  const [customMaxEur, setCustomMaxEur] = useState('');
  const [sortByPriceAsc, setSortByPriceAsc] = useState(false);
  const locationInputRef = useRef<HTMLInputElement | null>(null);

  const todayIso = getTodayIsoDate();
  const maxDateIso = getMaxStayIsoDate();
  const nightsCount = countStayNights(checkIn, checkOut);
  const normalizedCodeQuery = stripHyphensForCodeOnly(locationInput).toUpperCase();
  const activeSearchCity =
    locationInput.trim() || data?.resolvedLocation || '10115 Berlin';

  const parsedCustomMax = Number.parseInt(customMaxEur.trim(), 10);
  const validCustomMax =
    Number.isFinite(parsedCustomMax) && parsedCustomMax > 0 ? parsedCustomMax : null;

  const activeMinEur: number | null =
    priceFilter === '60_120' ? 60 : priceFilter === 'over_120' ? 120 : null;
  const activeMaxEur: number | null =
    priceFilter === 'under_60'
      ? 60
      : priceFilter === '60_120'
        ? 120
        : priceFilter === 'custom'
          ? validCustomMax
          : null;
  const hasActivePriceFilter = activeMinEur !== null || activeMaxEur !== null;

  const rawResults = data?.results ?? [];
  const pricedCount = rawResults.filter(
    (s) => parseStayPriceEur(s.approxPriceEur, s.priceNumericEur) !== null
  ).length;

  const presetCounts = React.useMemo(() => {
    const counts: Record<Exclude<StayPriceFilter, 'custom'>, number> = {
      all: rawResults.length,
      under_60: 0,
      '60_120': 0,
      over_120: 0,
    };
    for (const s of rawResults) {
      const p = parseStayPriceEur(s.approxPriceEur, s.priceNumericEur);
      if (p === null) continue;
      if (p <= 60) counts.under_60 += 1;
      if (p >= 60 && p <= 120) counts['60_120'] += 1;
      if (p >= 120) counts.over_120 += 1;
    }
    return counts;
  }, [rawResults]);

  const displayedStays = React.useMemo(() => {
    const withPrice = rawResults.map((stay) => ({
      stay,
      numericPrice: parseStayPriceEur(stay.approxPriceEur, stay.priceNumericEur),
    }));

    const filtered =
      hasActivePriceFilter && pricedCount > 0
        ? withPrice.filter(({ numericPrice }) => {
            if (numericPrice === null) return false;
            if (activeMinEur !== null && numericPrice < activeMinEur) return false;
            if (activeMaxEur !== null && numericPrice > activeMaxEur) return false;
            return true;
          })
        : withPrice;

    const sorted = sortByPriceAsc
      ? [...filtered].sort((a, b) => {
          if (a.numericPrice === null && b.numericPrice === null) return 0;
          if (a.numericPrice === null) return 1;
          if (b.numericPrice === null) return -1;
          return a.numericPrice - b.numericPrice;
        })
      : filtered;

    return sorted.map((item) => item.stay);
  }, [
    rawResults,
    pricedCount,
    hasActivePriceFilter,
    activeMinEur,
    activeMaxEur,
    sortByPriceAsc,
  ]);

  const handleSelectPricePreset = (preset: (typeof PRICE_PRESETS)[number]) => {
    setPriceFilter(preset.id);
    if (preset.id === 'all') {
      setCustomMaxEur('');
      return;
    }
    const matchesInCurrent = rawResults.some((stay) => {
      const p = parseStayPriceEur(stay.approxPriceEur, stay.priceNumericEur);
      if (p === null) return false;
      if (preset.min !== null && p < preset.min) return false;
      if (preset.max !== null && p > preset.max) return false;
      return true;
    });
    if (onSearchByPrice && rawResults.length > 0 && (pricedCount === 0 || !matchesInCurrent)) {
      onSearchByPrice(preset.min, preset.max);
    }
  };

  const portalBookingUrl = buildBookingDeepLink(
    stayType === 'rooms' ? 'Pokój' : '',
    activeSearchCity,
    checkIn,
    checkOut,
    guests,
    activeMaxEur
  );
  const portalAirbnbUrl = buildAirbnbDeepLink(
    activeSearchCity,
    checkIn,
    checkOut,
    guests,
    activeMaxEur
  );
  const portalHrsUrl = buildHrsDeepLink(
    '',
    activeSearchCity,
    checkIn,
    checkOut,
    guests
  );
  const portalFewoUrl = buildFewoDeepLink(
    activeSearchCity,
    checkIn,
    checkOut,
    guests
  );
  const portalExpediaUrl = buildExpediaDeepLink(
    '',
    activeSearchCity,
    checkIn,
    checkOut,
    guests
  );

  return (
    <div className="space-y-5">
      {/* 1. Cinematic Dark Banner */}
      <section
        aria-label="Baner Noclegi i Hotele"
        className="relative h-28 sm:h-32 w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0B1018] shadow-xl shadow-black/40"
      >
        {!bannerError ? (
          <img
            src={staysBannerImg}
            alt="Hotele, apartamenty i noclegi po kodzie pocztowym"
            referrerPolicy="no-referrer"
            onError={() => setBannerError(true)}
            className="h-full w-full object-cover object-center opacity-50"
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-full w-full bg-[radial-gradient(circle_at_80%_50%,rgba(34,197,94,0.18),transparent_60%),#0B1018]"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#05070B]/95 via-[#05070B]/75 to-transparent"
        />
        <div className="relative z-10 flex h-full flex-col justify-center px-5 sm:px-7 max-w-xl">
          <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-white text-balance">
            Pokoje, hotele i noclegi
          </h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Wyszukuj pokoje po kodzie pocztowym lub GPS i filtruj według ceny za noc.
          </p>
        </div>
      </section>

      {/* 2. Postal Code Search Bar + Single GPS Search Button */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearchByLocation();
        }}
        className="flex flex-col gap-2.5 sm:flex-row sm:items-center rounded-2xl border border-white/[0.08] bg-[#0B1018]/90 p-2.5 shadow-lg shadow-black/30"
      >
        <div className="relative flex-1">
          <MapPin
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4ADE80]"
            aria-hidden="true"
          />
          <input
            ref={locationInputRef}
            type="text"
            enterKeyHint="search"
            value={locationInput}
            onChange={(e) => onLocationInputChange(e.target.value)}
            placeholder="Kod pocztowy lub miasto (np. 10115, 00-001)"
            aria-label="Kod pocztowy lub miasto do wyszukania noclegów"
            className={`min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-[#111723] pl-10 text-xs sm:text-sm text-white placeholder-[#64748B] focus:border-[#22C55E] focus:bg-[#070A10] focus:outline-none ${
              locationInput.trim() ? 'pr-18' : 'pr-11'
            }`}
          />
          {locationInput.trim() && (
            <button
              type="button"
              onClick={() => {
                onLocationInputChange('');
                locationInputRef.current?.focus();
              }}
              aria-label="Wyczyść kod pocztowy"
              className="absolute right-10 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#94A3B8] transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading}
            aria-label="Szukaj noclegów po kodzie pocztowym"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#4ADE80] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40 cursor-pointer"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={onUseMyLocation}
          disabled={isLocating || isLoading}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-5 text-xs font-semibold text-[#041409] transition-all hover:bg-[#4ADE80] shadow-sm shadow-[#22C55E]/25 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Navigation className="h-4 w-4" aria-hidden="true" />
          <span>{isLocating ? 'Namierzam...' : 'Szukaj po GPS'}</span>
        </button>
      </form>

      {/* Stay Type Filter Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Typ noclegów"
          className="flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.07] bg-[#0B1018] p-1.5"
        >
          {STAY_TYPES.map((t) => {
            const isActive = stayType === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => onSelectStayType(t.id)}
                className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-[#22C55E] text-[#041409] shadow-sm shadow-[#22C55E]/20'
                    : 'text-[#94A3B8] hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
          {data?.resolvedLocation && data.validGermany && (
            <span>
              Noclegi dla:{' '}
              <span className="font-semibold text-white">{data.resolvedLocation}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowBookingFilters((v) => !v)}
            className="font-medium text-[#4ADE80] underline decoration-[#22C55E]/40 underline-offset-4 hover:text-[#86EFAC] cursor-pointer"
          >
            {showBookingFilters
              ? 'Ukryj termin i gości'
              : `${formatPolishDateDisplay(checkIn)} → ${formatPolishDateDisplay(checkOut)} · ${guests} os.`}
          </button>
        </div>
      </div>

      {/* Price Filter & Sort Bar */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-white/[0.07] bg-[#0B1018]/90 p-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 px-2 text-xs font-medium text-[#94A3B8]">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
            <span>Cena / noc:</span>
          </span>
          {PRICE_PRESETS.map((preset) => {
            const isActive = priceFilter === preset.id;
            const count = presetCounts[preset.id];
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPricePreset(preset)}
                className={`min-h-[34px] rounded-xl px-3 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#22C55E] text-[#041409] shadow-sm shadow-[#22C55E]/20'
                    : 'border border-white/[0.08] bg-[#111723] text-[#CBD5E1] hover:border-[#22C55E]/50 hover:text-white'
                }`}
              >
                {preset.label}
                {rawResults.length > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (validCustomMax && onSearchByPrice) {
                setPriceFilter('custom');
                onSearchByPrice(null, validCustomMax);
              }
            }}
            className="flex items-center gap-1.5"
          >
            <label className="flex min-h-[34px] items-center gap-1 rounded-xl border border-white/[0.08] bg-[#111723] px-2.5 text-xs text-[#94A3B8] focus-within:border-[#22C55E]">
              <span>Maks.</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={customMaxEur}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
                  setCustomMaxEur(digits);
                  setPriceFilter(digits ? 'custom' : 'all');
                }}
                placeholder="np. 80"
                aria-label="Maksymalna cena pokoju za noc w EUR"
                className="w-14 bg-transparent font-mono-tabular text-xs font-semibold text-white placeholder-[#64748B] focus:outline-none"
              />
              <span className="font-mono-tabular text-[#4ADE80]">€</span>
            </label>
            {validCustomMax && onSearchByPrice && (
              <button
                type="submit"
                disabled={isLoading}
                className="min-h-[34px] rounded-xl border border-[#22C55E]/40 bg-[#081A10] px-2.5 text-xs font-semibold text-[#4ADE80] hover:border-[#22C55E] disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                Szukaj w cenie
              </button>
            )}
          </form>

          <button
            type="button"
            onClick={() => setSortByPriceAsc((v) => !v)}
            className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              sortByPriceAsc
                ? 'border border-[#22C55E]/60 bg-[#081A10] text-[#4ADE80]'
                : 'border border-white/[0.08] bg-[#111723] text-[#CBD5E1] hover:border-[#22C55E]/50 hover:text-white'
            }`}
          >
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Od najtańszych</span>
          </button>
        </div>
      </div>

      {/* Collapsible Dates & Guest Controls */}
      {showBookingFilters && (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0B1018] p-4">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <label className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 py-1.5 text-[#94A3B8]">
              <Calendar className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
              <span>Od:</span>
              <input
                type="date"
                min={todayIso}
                max={maxDateIso}
                value={checkIn}
                onChange={(e) => onChangeCheckIn(e.target.value)}
                className="bg-transparent font-mono-tabular text-xs font-medium text-white focus:outline-none [color-scheme:dark]"
              />
            </label>
            <label className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 py-1.5 text-[#94A3B8]">
              <Calendar className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
              <span>Do:</span>
              <input
                type="date"
                min={checkIn || todayIso}
                max={maxDateIso}
                value={checkOut}
                onChange={(e) => onChangeCheckOut(e.target.value)}
                className="bg-transparent font-mono-tabular text-xs font-medium text-white focus:outline-none [color-scheme:dark]"
              />
            </label>
            <label className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 py-1.5 text-[#94A3B8]">
              <Users className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
              <span>Goście:</span>
              <select
                value={guests}
                onChange={(e) => onChangeGuests(Number(e.target.value))}
                className="bg-[#111723] font-mono-tabular text-xs font-medium text-white focus:outline-none"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n} className="bg-[#0B1018] text-white">
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={onAutoBookBest}
              disabled={isAutoBooking || isLoading}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3.5 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {isAutoBooking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{isAutoBooking ? 'Rezerwuję...' : 'Zarezerwuj automatycznie'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[#94A3B8]">Szybkie daty:</span>
              <button
                type="button"
                onClick={() => {
                  const { checkIn: dIn, checkOut: dOut } = getCurrentStayDates(0, 2);
                  onApplyDatePreset(dIn, dOut);
                }}
                className="min-h-[30px] rounded-xl border border-[#22C55E]/35 bg-[#081A10] px-2.5 font-medium text-[#4ADE80] hover:border-[#22C55E] cursor-pointer"
              >
                Od dziś (2 noce)
              </button>
              <button
                type="button"
                onClick={() => {
                  const { checkIn: dIn, checkOut: dOut } = getCurrentStayDates(1, 2);
                  onApplyDatePreset(dIn, dOut);
                }}
                className="min-h-[30px] rounded-xl border border-white/[0.08] bg-[#111723] px-2.5 font-medium text-[#E2E8F0] hover:border-[#22C55E]/60 cursor-pointer"
              >
                Od jutra
              </button>
              <button
                type="button"
                onClick={() => {
                  const { checkIn: dIn, checkOut: dOut } = getNextWeekendDates();
                  onApplyDatePreset(dIn, dOut);
                }}
                className="min-h-[30px] rounded-xl border border-white/[0.08] bg-[#111723] px-2.5 font-medium text-[#E2E8F0] hover:border-[#22C55E]/60 cursor-pointer"
              >
                Weekend
              </button>
            </div>

            <span className="font-mono-tabular font-semibold text-[#4ADE80]">
              {nightsCount} {nightsCount === 1 ? 'noc' : nightsCount < 5 ? 'noce' : 'nocy'}
            </span>
          </div>
        </div>
      )}

      {/* Confirmed Automatic Reservations List */}
      {bookings.length > 0 && (
        <section
          aria-label="Moje automatyczne rezerwacje noclegów"
          className="rounded-2xl border border-[#22C55E]/30 bg-[#081A10] p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-[#86EFAC]">
            <CheckCircle2 className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
            <span>Moje automatyczne rezerwacje ({bookings.length})</span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {bookings.map((bk) => {
              const telHref = sanitizePhoneForTel(bk.phone);
              const cleanCode = stripHyphensForCodeOnly(bk.confirmationCode);
              const isCodeMatched =
                Boolean(normalizedCodeQuery) &&
                cleanCode.toUpperCase().includes(normalizedCodeQuery);
              return (
                <div
                  key={bk.id}
                  className={`flex flex-col justify-between rounded-2xl border bg-[#0B1018] p-4 text-xs space-y-2.5 ${
                    isCodeMatched ? 'border-[#22C55E] ring-1 ring-[#22C55E]' : 'border-white/[0.08]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono-tabular text-[11px] font-semibold text-[#4ADE80]">
                          Kod: {cleanCode}
                        </span>
                        <h3 className="mt-0.5 font-display text-base font-bold text-white">
                          {bk.stayName}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveBooking(bk.id)}
                        aria-label="Usuń rezerwację"
                        className="text-[#94A3B8] hover:text-[#F87171] cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <p className="mt-1 text-[#94A3B8]">
                      {bk.address} · {bk.city}
                    </p>
                    <p className="mt-1 font-mono-tabular text-white">
                      Termin: {bk.checkIn} → {bk.checkOut} · Goście: {bk.guests}
                    </p>
                    <p className="mt-0.5 text-[#94A3B8]">
                      Gość: {bk.guestName} ({bk.guestEmail})
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-2.5">
                    <a
                      href={bk.bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#22C55E] px-3 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80]"
                    >
                      <span>Dokończ na Booking.com</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {telHref && (
                      <a
                        href={`tel:${telHref}`}
                        onClick={() =>
                          onOpenDialer({
                            name: bk.stayName,
                            phone: telHref,
                            address: bk.address,
                          })
                        }
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E]"
                      >
                        <PhoneCall className="h-3 w-3 text-[#4ADE80]" />
                        <span>Zadzwoń</span>
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Immediate Results / Loading / Error */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-56 animate-pulse rounded-2xl border border-white/[0.07] bg-[#0B1018] p-5"
            >
              <div className="h-5 w-2/3 rounded bg-[#161E2C]" />
              <div className="mt-3 h-3 w-1/2 rounded bg-[#121926]" />
              <div className="mt-6 h-12 w-full rounded bg-[#0F1520]" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-2xl border border-[#EF4444]/40 bg-[#26090A] p-5 text-sm text-[#FCA5A5]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#F87171]" />
            <div>
              <p className="font-semibold text-white">Nie udało się pobrać noclegów</p>
              <p className="mt-1 text-xs text-[#FCA5A5]">{error}</p>
              <button
                type="button"
                onClick={onRetrySearch}
                className="mt-3 min-h-[40px] rounded-xl border border-[#EF4444]/40 bg-[#180708] px-4 text-xs font-semibold text-[#FCA5A5] hover:bg-[#380E10] cursor-pointer"
              >
                Spróbuj ponownie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price filter portal-only notice when source lacks numeric EUR prices */}
      {!isLoading &&
        !error &&
        data?.validGermany &&
        displayedStays.length > 0 &&
        hasActivePriceFilter &&
        pricedCount === 0 && (
          <div className="rounded-xl border border-[#22C55E]/25 bg-[#081A10]/70 px-4 py-2.5 text-xs text-[#A7F3D0]">
            Wybrany budżet został zastosowany w linkach do Booking.com i Airbnb — otwórz wybraną ofertę, aby zobaczyć dokładną cenę za noc.
          </div>
        )}

      {/* Stays Cards */}
      {!isLoading && !error && data?.validGermany && displayedStays.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {displayedStays.map((stay) => {
            const telHref = sanitizePhoneForTel(stay.phone);
            const numericPrice = parseStayPriceEur(
              stay.approxPriceEur,
              stay.priceNumericEur
            );
            const cardBookingUrl = activeMaxEur
              ? buildBookingDeepLink(
                  stay.name,
                  stay.city || activeSearchCity,
                  checkIn,
                  checkOut,
                  guests,
                  activeMaxEur
                )
              : stay.bookingUrl;
            const cardAirbnbUrl = activeMaxEur
              ? buildAirbnbDeepLink(
                  stay.city || activeSearchCity,
                  checkIn,
                  checkOut,
                  guests,
                  activeMaxEur
                )
              : stay.airbnbUrl;
            return (
              <article
                key={stay.id || stay.name}
                className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-all hover:border-[#22C55E]/50"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold text-white">
                      {stay.name}
                    </h3>
                    {(numericPrice !== null || stay.approxPriceEur) && (
                      <div className="shrink-0 rounded-xl border border-[#22C55E]/35 bg-[#081A10] px-2.5 py-1 text-right">
                        <div className="font-mono-tabular text-sm font-bold text-[#4ADE80] whitespace-nowrap">
                          {numericPrice !== null
                            ? `${numericPrice} € / noc`
                            : stay.approxPriceEur}
                        </div>
                        {numericPrice !== null && nightsCount > 1 && (
                          <div className="font-mono-tabular text-[11px] text-[#A7F3D0] whitespace-nowrap">
                            {nightsCount} {nightsCount < 5 ? 'noce' : 'nocy'}: ~{numericPrice * nightsCount} €
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94A3B8]">
                    <span className="font-medium text-[#E2E8F0]">
                      {stay.stayTypeLabel || stay.stayType}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {stay.rating ? `Ocena ${stay.rating}` : 'Sprawdź oceny'}
                    </span>
                    {stay.distanceInfo && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{stay.distanceInfo}</span>
                      </>
                    )}
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-[#CBD5E1]">
                    {stay.highlight}
                  </p>

                  <div className="mt-3 flex items-start gap-2 text-xs text-[#94A3B8]">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4ADE80]" />
                    <span>
                      {stay.address}
                      {stay.postalCode ? `, ${stay.postalCode}` : ''} {stay.city || ''}
                    </span>
                  </div>
                </div>

                <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenAutoBookModal(stay)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] transition-colors hover:bg-[#4ADE80] whitespace-nowrap cursor-pointer"
                    >
                      <Zap className="h-4 w-4" aria-hidden="true" />
                      <span>Rezerwuj automatycznie</span>
                    </button>

                    <a
                      href={cardBookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E] hover:text-white whitespace-nowrap"
                    >
                      <BedDouble className="h-3.5 w-3.5 text-[#4ADE80]" />
                      <span>Booking</span>
                    </a>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={cardAirbnbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E] whitespace-nowrap"
                    >
                      <span>Airbnb</span>
                      <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
                    </a>

                    <a
                      href={
                        stay.hrsUrl ||
                        buildHrsDeepLink(
                          stay.name,
                          stay.city || activeSearchCity,
                          checkIn,
                          checkOut,
                          guests
                        )
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E] whitespace-nowrap"
                    >
                      <span>HRS</span>
                      <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
                    </a>

                    <a
                      href={
                        stay.fewoUrl ||
                        buildFewoDeepLink(
                          stay.city || activeSearchCity,
                          checkIn,
                          checkOut,
                          guests
                        )
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E] whitespace-nowrap"
                    >
                      <span>FeWo</span>
                      <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
                    </a>

                    <a
                      href={
                        stay.expediaUrl ||
                        buildExpediaDeepLink(
                          stay.name,
                          stay.city || activeSearchCity,
                          checkIn,
                          checkOut,
                          guests
                        )
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E] whitespace-nowrap"
                    >
                      <span>Expedia</span>
                      <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
                    </a>

                    {telHref && (
                      <a
                        href={`tel:${telHref}`}
                        onClick={() =>
                          onOpenDialer({
                            name: stay.name,
                            phone: telHref,
                            address: `${stay.address}, ${stay.postalCode} ${stay.city}`,
                          })
                        }
                        className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E] whitespace-nowrap"
                      >
                        <PhoneCall className="h-3.5 w-3.5 text-[#4ADE80]" />
                        <span className="font-mono-tabular">Zadzwoń</span>
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Filtered out by price */}
      {!isLoading &&
        !error &&
        data?.validGermany &&
        rawResults.length > 0 &&
        displayedStays.length === 0 && (
          <div className="rounded-2xl border border-white/[0.08] bg-[#0B1018] p-6 text-center space-y-3">
            <p className="font-display text-base font-semibold text-white">
              Brak ofert w wybranym przedziale cenowym na obecnej liście
            </p>
            <p className="text-xs text-[#94A3B8]">
              Możesz wyszukać pokoje na żywo w tym budżecie albo pokazać wszystkie ceny.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {onSearchByPrice && hasActivePriceFilter && (
                <button
                  type="button"
                  onClick={() => onSearchByPrice(activeMinEur, activeMaxEur)}
                  className="min-h-[40px] rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] cursor-pointer"
                >
                  Szukaj pokoi w tym budżecie
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPriceFilter('all');
                  setCustomMaxEur('');
                }}
                className="min-h-[40px] rounded-xl border border-white/[0.08] bg-[#111723] px-4 text-xs font-semibold text-[#E2E8F0] hover:border-[#22C55E] cursor-pointer"
              >
                Pokaż wszystkie ceny
              </button>
            </div>
          </div>
        )}

      {/* Empty Results State */}
      {!isLoading && !error && data && data.validGermany && rawResults.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0B1018] p-6 text-center">
          <p className="font-display text-base font-semibold text-white">
            Brak noclegów dla „{data.resolvedLocation || locationInput}”
          </p>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Wpisz inny kod pocztowy lub przełącz kategorię na „Wszystkie noclegi”.
          </p>
        </div>
      )}

      {/* Connected Portals Footer Strip */}
      {!isLoading && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-[#0B1018] p-4">
          <span className="text-xs font-medium text-[#94A3B8]">
            Szukaj pokoi bezpośrednio w portalach ({activeSearchCity}):
          </span>
          <div className="flex flex-wrap gap-1.5">
            <a
              href={portalBookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-[#22C55E]/35 bg-[#081A10] px-3 text-xs font-semibold text-[#4ADE80] hover:border-[#22C55E]"
            >
              <span>Booking.com</span>
              <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
            </a>
            <a
              href={portalAirbnbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-[#22C55E]/35 bg-[#081A10] px-3 text-xs font-semibold text-[#4ADE80] hover:border-[#22C55E]"
            >
              <span>Airbnb</span>
              <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
            </a>
            <a
              href={portalHrsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E]"
            >
              <span>HRS</span>
              <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
            </a>
            <a
              href={portalFewoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E]"
            >
              <span>FeWo-direkt</span>
              <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
            </a>
            <a
              href={portalExpediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs font-medium text-[#E2E8F0] hover:border-[#22C55E]"
            >
              <span>Expedia</span>
              <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
