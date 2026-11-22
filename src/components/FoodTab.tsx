import React, { useRef, useState } from 'react';
import {
  PhoneCall,
  MapPin,
  Clock,
  AlertCircle,
  Navigation,
  Route,
  Star,
  Search,
  X,
  Mail,
} from 'lucide-react';
import {
  DialTarget,
  FoodCategory,
  FoodSearchResponse,
} from '../types';
import {
  buildGoogleMapsDirectionsUrl,
  sanitizePhoneForTel,
} from '../utils/location';
import foodBannerImg from '../assets/images/food_pizza_kebab_banner_1795024200178.jpg';

interface FoodTabProps {
  category: FoodCategory;
  onSelectCategory: (cat: FoodCategory) => void;
  locationInput: string;
  onLocationInputChange: (val: string) => void;
  onSearchByLocation: (locationOverride?: string) => void;
  onUseMyLocation: () => void;
  hasGpsLock: boolean;
  isLocating: boolean;
  coordinates?: { lat: number; lng: number };
  hasMapsProvider: boolean;
  data: FoodSearchResponse | null;
  isLoading: boolean;
  error: string | null;
  onOpenDialer: (target: DialTarget) => void;
  onRetrySearch: () => void;
  onCloseTab?: () => void;
}

const FOOD_CATEGORIES: { id: FoodCategory; label: string }[] = [
  { id: 'all', label: 'Wszystkie' },
  { id: 'doner', label: 'Döner / Kebab' },
  { id: 'pizza', label: 'Pizza' },
  { id: 'chinese', label: 'Chińskie jedzenie' },
  { id: 'near_post', label: 'W pobliżu poczty' },
];

export const FoodTab: React.FC<FoodTabProps> = ({
  category,
  onSelectCategory,
  locationInput,
  onLocationInputChange,
  onSearchByLocation,
  onUseMyLocation,
  isLocating,
  data,
  isLoading,
  error,
  onOpenDialer,
  onRetrySearch,
}) => {
  const [bannerError, setBannerError] = useState(false);
  const locationInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-5">
      {/* 1. Cinematic Dark Banner */}
      <section
        aria-label="Baner Jedzenie i Restauracje"
        className="relative h-28 sm:h-32 w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0B1018] shadow-xl shadow-black/40"
      >
        {!bannerError ? (
          <img
            src={foodBannerImg}
            alt="Pizza i döner kebab — wyszukiwarka restauracji po kodzie pocztowym"
            referrerPolicy="no-referrer"
            onError={() => setBannerError(true)}
            className="h-full w-full object-cover object-center opacity-45"
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
            Pizza, Döner i restauracje w pobliżu
          </h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Wpisz kod pocztowy lub miasto albo wyszukaj przez GPS.
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
            aria-label="Kod pocztowy lub miasto do wyszukania restauracji"
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
            aria-label="Szukaj po kodzie pocztowym"
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

      {/* Category Filter Tabs */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Kategorie jedzenia"
          className="flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.07] bg-[#0B1018] p-1.5"
        >
          {FOOD_CATEGORIES.map((cat) => {
            const isActive = category === cat.id;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => onSelectCategory(cat.id)}
                className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-[#22C55E] text-[#041409] shadow-sm shadow-[#22C55E]/20'
                    : 'text-[#94A3B8] hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {data?.resolvedLocation && data.validGermany && (
          <p className="text-xs text-[#94A3B8]">
            Restauracje dla:{' '}
            <span className="font-semibold text-white">{data.resolvedLocation}</span>
          </p>
        )}
      </div>

      {/* 3. Immediate Results / Loading / Error */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-52 animate-pulse rounded-2xl border border-white/[0.07] bg-[#0B1018] p-5"
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
            <div className="flex-1">
              <p className="font-semibold text-white">Nie udało się pobrać restauracji</p>
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

      {/* Nearest Post Office Card (when near_post is active) */}
      {!isLoading && !error && data?.validGermany && data.postOffice && (
        <div className="rounded-2xl border border-[#22C55E]/30 bg-[#081A10] p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#4ADE80]">
                Najbliższa placówka pocztowa
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold text-white">
                {data.postOffice.name}
              </h3>
              <p className="mt-0.5 text-xs text-[#94A3B8]">
                {data.postOffice.address} ·{' '}
                <span className="font-mono-tabular">{data.postOffice.postalCode}</span>{' '}
                {data.postOffice.city}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#86EFAC]">
              <Mail className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
              <span>{data.postOffice.distanceNote}</span>
            </div>
          </div>
        </div>
      )}

      {/* Restaurant Cards */}
      {!isLoading && !error && data?.validGermany && data.results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.results.map((item) => {
            const telHref = sanitizePhoneForTel(item.phone);
            const fullAddress = `${item.address}${item.postalCode ? `, ${item.postalCode}` : ''} ${
              item.city || ''
            }`.trim();
            const directionsHref = buildGoogleMapsDirectionsUrl(
              `${item.name}, ${fullAddress}`.trim()
            );

            return (
              <article
                key={item.id || item.name}
                className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-all hover:border-[#22C55E]/50"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-block text-xs font-semibold text-[#4ADE80]">
                        {item.categoryLabel || item.category}
                      </span>
                      <h3 className="mt-1 font-display text-xl font-bold leading-snug text-white">
                        {item.name}
                      </h3>
                    </div>

                    {item.rating ? (
                      <div className="flex shrink-0 flex-col items-end text-right">
                        <span className="inline-flex items-center gap-1 font-mono-tabular text-sm font-bold text-white">
                          <Star className="h-3.5 w-3.5 fill-[#4ADE80] text-[#4ADE80]" aria-hidden="true" />
                          {item.rating.toFixed(1)}
                        </span>
                        {item.reviewCount ? (
                          <span className="font-mono-tabular text-[11px] text-[#94A3B8]">
                            {item.reviewCount.toLocaleString('pl-PL')} opinii
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {item.highlight && (
                    <p className="mt-2.5 text-sm leading-relaxed text-[#CBD5E1]">
                      {item.highlight}
                    </p>
                  )}

                  <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3.5 text-xs">
                    <div className="flex items-start gap-2.5">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
                      <span className="text-sm font-medium text-white">
                        {fullAddress}
                      </span>
                    </div>

                    {item.openingHours && (
                      <div className="flex items-start gap-2.5 text-[#94A3B8]">
                        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
                        <span>{item.openingHours}</span>
                      </div>
                    )}

                    {(telHref || item.priceLevel) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        {telHref && (
                          <div className="flex items-center gap-2.5">
                            <PhoneCall className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                            <span className="font-mono-tabular font-semibold text-white">
                              {telHref}
                            </span>
                          </div>
                        )}
                        {item.priceLevel && (
                          <span className="text-xs font-medium text-[#94A3B8]">
                            Ceny: {item.priceLevel}
                          </span>
                        )}
                      </div>
                    )}

                    {item.nearPostNote && (
                      <div className="flex items-start gap-2.5 pt-0.5 text-[#4ADE80]">
                        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{item.nearPostNote}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
                  {telHref ? (
                    <a
                      href={`tel:${telHref}`}
                      onClick={() =>
                        onOpenDialer({
                          name: item.name,
                          phone: telHref,
                          address: fullAddress,
                        })
                      }
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] transition-colors hover:bg-[#4ADE80] whitespace-nowrap"
                    >
                      <PhoneCall className="h-4 w-4" aria-hidden="true" />
                      <span>Zamów telefonicznie</span>
                    </a>
                  ) : (
                    <span className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-white/[0.07] bg-[#111723] px-3 text-xs text-[#64748B] whitespace-nowrap">
                      Brak numeru telefonu
                    </span>
                  )}

                  <a
                    href={directionsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#22C55E]/35 bg-[#081A10] px-4 text-xs font-semibold text-[#4ADE80] transition-colors hover:border-[#22C55E] hover:bg-[#0D2A19] whitespace-nowrap"
                  >
                    <Route className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                    <span>Dojazd</span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && data && data.validGermany && data.results.length === 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0B1018] p-6 text-center">
          <p className="font-display text-base font-semibold text-white">
            Brak wyników dla „{data.resolvedLocation || locationInput}”
          </p>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Wpisz inny kod pocztowy (np. 10115, 00-001) albo przełącz kategorię na „Wszystkie”.
          </p>
        </div>
      )}
    </div>
  );
};
