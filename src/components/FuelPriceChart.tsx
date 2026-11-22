import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { TrendingDown } from 'lucide-react';
import { FuelStationResult } from '../types';

export type FuelChartFocus = 'all' | 'diesel' | 'e5' | 'e10';

export function parseFuelPriceEur(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(',', '.').replace(/[^\d.]/g, '');
  if (!normalized) return null;
  const val = Number.parseFloat(normalized);
  if (!Number.isFinite(val) || val <= 0 || val > 5) return null;
  return Number(val.toFixed(3));
}

function shortenStationLabel(station: FuelStationResult): string {
  const brand = (station.brand || '').trim();
  const name = (station.stationName || '').trim();
  const base = brand && !name.toLowerCase().startsWith(brand.toLowerCase())
    ? `${brand} · ${name}`
    : name || brand || 'Stacja';
  return base.length > 20 ? `${base.slice(0, 18)}…` : base;
}

interface ChartDatum {
  id: string;
  shortName: string;
  fullName: string;
  address: string;
  distanceInfo: string;
  diesel: number | null;
  e5: number | null;
  e10: number | null;
}

interface FuelPriceChartProps {
  stations: FuelStationResult[];
}

export const FuelPriceChart: React.FC<FuelPriceChartProps> = ({ stations }) => {
  const [focus, setFocus] = useState<FuelChartFocus>('all');

  const parsedData = useMemo<ChartDatum[]>(() => {
    return stations
      .map((s, idx) => ({
        id: s.id || `${s.stationName}-${idx}`,
        shortName: shortenStationLabel(s),
        fullName: s.stationName || s.brand,
        address: s.address,
        distanceInfo: s.distanceInfo,
        diesel: parseFuelPriceEur(s.dieselEur),
        e5: parseFuelPriceEur(s.e5Eur),
        e10: parseFuelPriceEur(s.e10Eur),
      }))
      .filter((d) => d.diesel !== null || d.e5 !== null || d.e10 !== null);
  }, [stations]);

  const cheapestByType = useMemo(() => {
    const findMin = (key: 'diesel' | 'e5' | 'e10') => {
      let best: { station: string; price: number } | null = null;
      for (const item of parsedData) {
        const p = item[key];
        if (p !== null && (!best || p < best.price)) {
          best = { station: item.fullName, price: p };
        }
      }
      return best;
    };
    return {
      diesel: findMin('diesel'),
      e5: findMin('e5'),
      e10: findMin('e10'),
    };
  }, [parsedData]);

  const chartData = useMemo(() => {
    if (focus === 'all') return parsedData;
    return parsedData
      .filter((d) => d[focus] !== null)
      .sort((a, b) => (a[focus] ?? 99) - (b[focus] ?? 99));
  }, [parsedData, focus]);

  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    for (const d of chartData) {
      if (focus === 'all') {
        if (d.diesel !== null) vals.push(d.diesel);
        if (d.e5 !== null) vals.push(d.e5);
        if (d.e10 !== null) vals.push(d.e10);
      } else {
        const v = d[focus];
        if (v !== null) vals.push(v);
      }
    }
    if (vals.length === 0) return [1.4, 2.0];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return [
      Number(Math.max(0, min - 0.04).toFixed(2)),
      Number((max + 0.02).toFixed(2)),
    ];
  }, [chartData, focus]);

  if (parsedData.length === 0) {
    return null;
  }

  const singleMinPrice =
    focus !== 'all' && chartData.length > 0 ? chartData[0][focus] : null;

  return (
    <section
      aria-label="Porównanie cen paliw w okolicy"
      className="space-y-4 rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#4ADE80]">
            <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Porównanie cen paliw (€/L)</span>
          </div>
          <h3 className="mt-0.5 font-display text-base font-semibold text-white">
            Gdzie zatankujesz najtaniej w okolicy
          </h3>
        </div>

        <div
          role="group"
          aria-label="Filtr rodzaju paliwa na wykresie"
          className="flex flex-wrap gap-1.5"
        >
          {(
            [
              { id: 'all', label: 'Wszystkie' },
              { id: 'diesel', label: 'Diesel' },
              { id: 'e5', label: 'Super E5' },
              { id: 'e10', label: 'Super E10' },
            ] as { id: FuelChartFocus; label: string }[]
          ).map((item) => {
            const active = focus === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFocus(item.id)}
                className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#22C55E] text-[#041409]'
                    : 'border border-[#262D36] bg-[#12161B] text-[#9CA6B2] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cheapest summary strip */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-xl border border-[#1E232A] bg-[#12161B] px-3.5 py-2.5">
          <p className="text-[11px] text-[#8B95A1]">Najtańszy Diesel</p>
          <p className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#38BDF8]">
            {cheapestByType.diesel
              ? `${cheapestByType.diesel.price.toFixed(3)} €`
              : '—'}
          </p>
          {cheapestByType.diesel && (
            <p className="truncate text-[11px] text-[#9CA6B2]">
              {cheapestByType.diesel.station}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[#1E232A] bg-[#12161B] px-3.5 py-2.5">
          <p className="text-[11px] text-[#8B95A1]">Najtańsze Super E5</p>
          <p className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#FBBF24]">
            {cheapestByType.e5 ? `${cheapestByType.e5.price.toFixed(3)} €` : '—'}
          </p>
          {cheapestByType.e5 && (
            <p className="truncate text-[11px] text-[#9CA6B2]">
              {cheapestByType.e5.station}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[#1E232A] bg-[#12161B] px-3.5 py-2.5">
          <p className="text-[11px] text-[#8B95A1]">Najtańsze Super E10</p>
          <p className="mt-0.5 font-mono-tabular text-sm font-semibold text-[#4ADE80]">
            {cheapestByType.e10 ? `${cheapestByType.e10.price.toFixed(3)} €` : '—'}
          </p>
          {cheapestByType.e10 && (
            <p className="truncate text-[11px] text-[#9CA6B2]">
              {cheapestByType.e10.station}
            </p>
          )}
        </div>
      </div>

      {/* Recharts BarChart */}
      {chartData.length > 0 ? (
        <div className="h-[270px] w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 12, left: 0, bottom: 24 }}
              barGap={4}
            >
              <CartesianGrid
                stroke="#1E232A"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="shortName"
                tick={{ fill: '#9CA6B2', fontSize: 11 }}
                axisLine={{ stroke: '#262D36' }}
                tickLine={false}
                interval={0}
                angle={-14}
                textAnchor="end"
                height={48}
              />
              <YAxis
                domain={yDomain}
                tick={{ fill: '#8B95A1', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={54}
                tickFormatter={(v: number) => `${v.toFixed(2)}€`}
              />
              <Tooltip
                cursor={{ fill: 'rgba(34, 197, 94, 0.08)' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0].payload as ChartDatum;
                  return (
                    <div className="rounded-xl border border-[#262D36] bg-[#0B0D10] p-3 text-xs shadow-2xl">
                      <p className="font-display font-semibold text-white">
                        {row.fullName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#8B95A1]">
                        {row.address}
                      </p>
                      <div className="mt-2 space-y-1 font-mono-tabular">
                        {row.diesel !== null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#38BDF8]">Diesel</span>
                            <span className="font-semibold text-white">
                              {row.diesel.toFixed(3)} €/L
                            </span>
                          </div>
                        )}
                        {row.e5 !== null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#FBBF24]">Super E5</span>
                            <span className="font-semibold text-white">
                              {row.e5.toFixed(3)} €/L
                            </span>
                          </div>
                        )}
                        {row.e10 !== null && (
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#4ADE80]">Super E10</span>
                            <span className="font-semibold text-white">
                              {row.e10.toFixed(3)} €/L
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }}
              />

              {focus === 'all' ? (
                <>
                  <Bar
                    dataKey="diesel"
                    name="Diesel"
                    fill="#38BDF8"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="e5"
                    name="Super E5"
                    fill="#FBBF24"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="e10"
                    name="Super E10"
                    fill="#22C55E"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={26}
                  />
                </>
              ) : (
                <Bar
                  dataKey={focus}
                  name={
                    focus === 'diesel'
                      ? 'Diesel'
                      : focus === 'e5'
                        ? 'Super E5'
                        : 'Super E10'
                  }
                  radius={[6, 6, 0, 0]}
                  maxBarSize={44}
                >
                  {chartData.map((entry) => {
                    const isCheapest =
                      singleMinPrice !== null && entry[focus] === singleMinPrice;
                    return (
                      <Cell
                        key={entry.id}
                        fill={
                          isCheapest
                            ? '#22C55E'
                            : focus === 'diesel'
                              ? '#38BDF8'
                              : focus === 'e5'
                                ? '#FBBF24'
                                : '#84CC16'
                        }
                      />
                    );
                  })}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-4 text-xs text-[#8B95A1]">
          Brak danych liczbowych dla wybranego rodzaju paliwa na tych stacjach.
        </p>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#1A1F26] pt-3 text-[11px] text-[#8B95A1]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#38BDF8]" />
          Diesel
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#FBBF24]" />
          Super E5
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#22C55E]" />
          {focus === 'all' ? 'Super E10' : 'Najtańsza stacja wyróżniona na zielono'}
        </span>
      </div>
    </section>
  );
};
