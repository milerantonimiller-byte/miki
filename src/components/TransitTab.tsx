import React, { useMemo, useRef, useState } from 'react';
import {
  Train,
  Bus,
  Fuel,
  Car,
  Search,
  ExternalLink,
  MapPin,
  Clock,
  AlertCircle,
  Route,
  Navigation,
  X,
} from 'lucide-react';
import { TransitMode, TransitSearchResponse } from '../types';
import { FuelPriceChart, parseFuelPriceEur } from './FuelPriceChart';
import { buildGoogleMapsDrivingRouteUrl } from '../utils/location';
import transitBannerImg from '../assets/images/transit_train_banner_1795279672995.jpg';

interface TransitTabProps {
  mode: TransitMode;
  onSelectMode: (mode: TransitMode) => void;
  fromInput: string;
  toInput: string;
  onChangeFrom: (val: string) => void;
  onChangeTo: (val: string) => void;
  onSearch: () => void;
  data: TransitSearchResponse | null;
  isLoading: boolean;
  error: string | null;
  coordinates?: { lat: number; lng: number };
  globalLocationInput: string;
  hasMapsProvider: boolean;
  onUseMyLocation?: () => void;
  onQuickFuelNearby?: () => void;
  isLocating?: boolean;
  onOpenDetached?: () => void;
}

const TRANSIT_MODES: { id: TransitMode; label: string; icon: React.ReactNode }[] = [
  { id: 'trains', label: 'Pociągi', icon: <Train className="h-3.5 w-3.5" /> },
  { id: 'sbahn', label: 'S-Bahn', icon: <Train className="h-3.5 w-3.5" /> },
  { id: 'buses', label: 'Autobusy', icon: <Bus className="h-3.5 w-3.5" /> },
  { id: 'car', label: 'Jazda samochodem', icon: <Car className="h-3.5 w-3.5" /> },
  { id: 'fuel', label: 'Ceny paliw', icon: <Fuel className="h-3.5 w-3.5" /> },
];

export const TransitTab: React.FC<TransitTabProps> = ({
  mode,
  onSelectMode,
  fromInput,
  toInput,
  onChangeFrom,
  onChangeTo,
  onSearch,
  data,
  isLoading,
  error,
  globalLocationInput,
  onUseMyLocation,
  isLocating,
}) => {
  const [bannerError, setBannerError] = useState(false);
  const fromInputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch();
  };

  const cheapestStationKey = useMemo(() => {
    if (!data || data.mode !== 'fuel' || data.fuelStations.length === 0) return null;
    let bestKey: string | null = null;
    let bestPrice = Infinity;
    for (const s of data.fuelStations) {
      const prices = [
        parseFuelPriceEur(s.e10Eur),
        parseFuelPriceEur(s.dieselEur),
        parseFuelPriceEur(s.e5Eur),
      ].filter((v): v is number => v !== null);
      if (prices.length === 0) continue;
      const minForStation = Math.min(...prices);
      if (minForStation < bestPrice) {
        bestPrice = minForStation;
        bestKey = s.id || s.stationName;
      }
    }
    return bestKey;
  }, [data]);

  const effectiveMapQuery = fromInput.trim() || globalLocationInput.trim() || '10115 Berlin';
  const directCarMapsUrl = buildGoogleMapsDrivingRouteUrl(
    effectiveMapQuery,
    toInput.trim() || 'Berlin'
  );

  return (
    <div className="space-y-5">
      {/* 1. Cinematic Dark Banner */}
      <section
        aria-label="Baner Przejazdy i Paliwo"
        className="relative h-28 sm:h-32 w-full overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0B1018] shadow-xl shadow-black/40"
      >
        {!bannerError ? (
          <img
            src={transitBannerImg}
            alt="Pociągi, trasy samochodowe i ceny paliw po kodzie pocztowym"
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
            Pociągi, trasy i ceny paliw
          </h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Wpisz kod pocztowy lub miasto albo wyszukaj przez GPS.
          </p>
        </div>
      </section>

      {/* 2. Postal Code Search Bar + Single GPS Search Button */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2.5 sm:flex-row sm:items-center rounded-2xl border border-white/[0.08] bg-[#0B1018]/90 p-2.5 shadow-lg shadow-black/30"
      >
        <div className="relative flex flex-1 items-center">
          <MapPin
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4ADE80]"
            aria-hidden="true"
          />
          <input
            ref={fromInputRef}
            type="text"
            enterKeyHint="search"
            value={fromInput}
            onChange={(e) => onChangeFrom(e.target.value)}
            placeholder={
              mode === 'fuel'
                ? 'Kod pocztowy lub miasto (np. 10115, 00-001)'
                : 'Z: kod pocztowy lub miasto (np. 10115, Berlin)'
            }
            aria-label={mode === 'fuel' ? 'Kod pocztowy stacji paliw' : 'Kod pocztowy lub punkt początkowy'}
            className={`min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-[#111723] pl-10 text-xs sm:text-sm text-white placeholder-[#64748B] focus:border-[#22C55E] focus:bg-[#070A10] focus:outline-none ${
              fromInput.trim() ? 'pr-18' : 'pr-11'
            }`}
          />
          {fromInput.trim() && (
            <button
              type="button"
              onClick={() => {
                onChangeFrom('');
                fromInputRef.current?.focus();
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

        {mode !== 'fuel' && (
          <div className="relative flex flex-1 items-center">
            <span className="pointer-events-none absolute left-3.5 text-xs font-semibold text-[#38BDF8]">
              do
            </span>
            <input
              type="text"
              enterKeyHint="search"
              value={toInput}
              onChange={(e) => onChangeTo(e.target.value)}
              placeholder={
                mode === 'sbahn'
                  ? 'Cel S-Bahn (opcjonalnie, np. Alexanderplatz)'
                  : mode === 'car'
                    ? 'Cel jazdy (np. Monachium, Warszawa)'
                    : 'Cel podróży (opcjonalnie)'
              }
              aria-label="Punkt docelowy do"
              className="min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-[#111723] pl-9 pr-11 text-xs sm:text-sm text-white placeholder-[#64748B] focus:border-[#22C55E] focus:bg-[#070A10] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLoading}
              aria-label="Wyznacz trasę"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#4ADE80] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {onUseMyLocation && (
          <button
            type="button"
            onClick={onUseMyLocation}
            disabled={isLocating || isLoading}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-5 text-xs font-semibold text-[#041409] transition-all hover:bg-[#4ADE80] shadow-sm shadow-[#22C55E]/25 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
            <span>{isLocating ? 'Namierzam...' : 'Szukaj po GPS'}</span>
          </button>
        )}
      </form>

      {/* Mode Tabs */}
      <div
        role="tablist"
        aria-label="Tryb przejazdów i tras"
        className="flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.07] bg-[#0B1018] p-1.5"
      >
        {TRANSIT_MODES.map((m) => {
          const isActive = mode === m.id;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => onSelectMode(m.id)}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[#22C55E] text-[#041409] shadow-sm shadow-[#22C55E]/20'
                  : 'text-[#94A3B8] hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. Immediate Results / Loading / Error */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-44 animate-pulse rounded-2xl border border-white/[0.07] bg-[#0B1018] p-5"
            >
              <div className="h-4 w-1/2 rounded bg-[#161E2C]" />
              <div className="mt-3 h-3 w-2/3 rounded bg-[#121926]" />
              <div className="mt-6 h-10 w-full rounded bg-[#0F1520]" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-2xl border border-[#EF4444]/40 bg-[#26090A] p-5 text-sm text-[#FCA5A5]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#F87171]" />
            <div>
              <p className="font-semibold text-white">Błąd pobierania danych na żywo</p>
              <p className="mt-1 text-xs text-[#FCA5A5]">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Car Driving Routes Results */}
      {!isLoading && !error && data && data.mode === 'car' && (
        <div className="space-y-4">
          {data.carRoutes && data.carRoutes.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.carRoutes.map((route) => (
                <article
                  key={route.id || route.routeName}
                  className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[#4ADE80]">
                          Trasa samochodowa · {route.highways}
                        </p>
                        <h3 className="mt-1 font-display text-lg font-bold text-white">
                          {route.routeName}
                        </h3>
                      </div>
                      <span className="font-mono-tabular text-sm font-bold text-[#4ADE80] whitespace-nowrap">
                        {route.distanceKm}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
                      <span className="inline-flex items-center gap-1 font-semibold text-white">
                        <Clock className="h-3.5 w-3.5 text-[#4ADE80]" />
                        {route.durationText}
                      </span>
                      {route.estimatedFuelCostEur && (
                        <span>Paliwo ok. {route.estimatedFuelCostEur}</span>
                      )}
                    </div>

                    {route.trafficNote && (
                      <p className="mt-2 rounded-xl border border-[#22C55E]/30 bg-[#081A10] px-3 py-1.5 text-xs text-[#86EFAC]">
                        Ruch na trasie: {route.trafficNote}
                      </p>
                    )}

                    <p className="mt-3 text-sm leading-relaxed text-[#CBD5E1]">
                      {route.stepsSummary}
                    </p>
                  </div>

                  <div className="mt-4 flex justify-end border-t border-white/[0.06] pt-3">
                    <a
                      href={route.directionsUrl || directCarMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80]"
                    >
                      <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Uruchom nawigację</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0B1018] p-5 text-sm text-[#94A3B8]">
              <span>Wyznacz bezpośrednią trasę samochodową.</span>
              <a
                href={directCarMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80]"
              >
                <Route className="h-3.5 w-3.5" />
                <span>Wyznacz trasę</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* Fuel Stations Results + Recharts Comparison Chart */}
      {!isLoading && !error && data && data.mode === 'fuel' && (
        <div className="space-y-4">
          {data.fuelStations.length > 0 ? (
            <>
              <FuelPriceChart stations={data.fuelStations} />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {data.fuelStations.map((station) => {
                  const key = station.id || station.stationName;
                  const isCheapest = cheapestStationKey === key;
                  return (
                    <article
                      key={key}
                      className={`flex flex-col justify-between rounded-2xl border bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 ${
                        isCheapest ? 'border-[#22C55E] ring-1 ring-[#22C55E]/25' : 'border-white/[0.08]'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-[#4ADE80]">
                              {station.brand}
                              {isCheapest && (
                                <span className="text-[#86EFAC]"> · Najtaniej w okolicy</span>
                              )}
                            </p>
                            <h3 className="mt-0.5 font-display text-lg font-semibold text-white">
                              {station.stationName}
                            </h3>
                          </div>
                          <span className="text-xs text-[#94A3B8]">
                            {station.distanceInfo}
                          </span>
                        </div>

                        <div className="mt-3 flex items-start gap-2 text-xs text-[#94A3B8]">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4ADE80]" />
                          <span>{station.address}</span>
                        </div>

                        <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.06] border-y border-white/[0.06] py-3 text-center">
                          <div>
                            <p className="text-[11px] text-[#94A3B8]">Diesel</p>
                            <p className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#38BDF8]">
                              {station.dieselEur || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[#94A3B8]">Super E5</p>
                            <p className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#FBBF24]">
                              {station.e5Eur || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[#94A3B8]">Super E10</p>
                            <p className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#4ADE80]">
                              {station.e10Eur || '—'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-2 pt-1 text-xs">
                        <span className="text-[#94A3B8]">{station.updatedNote}</span>
                        <a
                          href={station.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 font-medium text-[#E2E8F0] hover:border-[#22C55E]"
                        >
                          <span>Nawiguj</span>
                          <ExternalLink className="h-3 w-3 text-[#4ADE80]" />
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-white/[0.08] bg-[#0B1018] p-6 text-sm text-[#94A3B8]">
              Brak aktualnych danych ze stacji paliw dla tego zapytania.
            </div>
          )}
        </div>
      )}

      {/* Trains, S-Bahn & Buses Results */}
      {!isLoading &&
        !error &&
        data &&
        (data.mode === 'trains' || data.mode === 'sbahn' || data.mode === 'buses') && (
          <div className="space-y-4">
            {data.connections.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {data.connections.map((conn) => (
                  <article
                    key={conn.id || `${conn.lineOrTrain}-${conn.departure}`}
                    className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#4ADE80]">
                            {conn.operator} · {conn.lineOrTrain}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono-tabular text-base sm:text-lg font-semibold leading-snug text-white">
                            <span>{conn.departure}</span>
                            <span aria-hidden="true" className="text-[#64748B]">
                              →
                            </span>
                            <span>{conn.arrival}</span>
                          </div>
                        </div>
                        {conn.priceInfo && (
                          <span className="font-mono-tabular text-xs font-bold text-[#4ADE80] whitespace-nowrap shrink-0">
                            {conn.priceInfo}
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#94A3B8]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-[#4ADE80]" />
                          {conn.duration}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{conn.statusNote}</span>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-[#CBD5E1]">
                        {conn.details}
                      </p>
                    </div>

                    <div className="mt-4 flex justify-end border-t border-white/[0.06] pt-3">
                      <a
                        href={conn.bookingOrScheduleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80]"
                      >
                        <span>Sprawdź na żywo / Bilet</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.08] bg-[#0B1018] p-6 text-sm text-[#94A3B8]">
                Brak znalezionych połączeń dla podanej trasy.
              </div>
            )}
          </div>
        )}
    </div>
  );
};
