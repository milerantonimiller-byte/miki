import React, { useEffect, useState } from 'react';
import {
  BedDouble,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  PhoneCall,
  User,
  Users,
  X,
} from 'lucide-react';
import { StayResult } from '../types';
import {
  addDaysToIso,
  buildAirbnbDeepLink,
  buildBookingDeepLink,
  clampStayDate,
  getMaxStayIsoDate,
  getTodayIsoDate,
} from '../utils/location';

interface AutoBookingModalProps {
  stay: StayResult | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    stay: StayResult;
    checkIn: string;
    checkOut: string;
    guests: number;
    guestName: string;
    guestEmail: string;
  }) => void;
}

export const AutoBookingModal: React.FC<AutoBookingModalProps> = ({
  stay,
  checkIn: initialCheckIn,
  checkOut: initialCheckOut,
  guests: initialGuests,
  isSubmitting,
  onClose,
  onConfirm,
}) => {
  const [guestName, setGuestName] = useState('Gość Miękiszon');
  const [guestEmail, setGuestEmail] = useState('Morfi28@gmx.de');
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests);

  const todayIso = getTodayIsoDate();
  const maxDateIso = getMaxStayIsoDate();

  useEffect(() => {
    const safeIn = clampStayDate(initialCheckIn, todayIso);
    const safeOut = clampStayDate(initialCheckOut, addDaysToIso(safeIn, 2));
    setCheckIn(safeIn);
    setCheckOut(safeOut <= safeIn ? addDaysToIso(safeIn, 2) : safeOut);
    setGuests(initialGuests);
  }, [initialCheckIn, initialCheckOut, initialGuests, stay, todayIso]);

  useEffect(() => {
    if (!stay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stay, onClose]);

  if (!stay) return null;

  const liveBookingUrl = buildBookingDeepLink(
    stay.name,
    stay.city || 'Deutschland',
    checkIn,
    checkOut,
    guests
  );
  const liveAirbnbUrl = buildAirbnbDeepLink(
    stay.city || 'Deutschland',
    checkIn,
    checkOut,
    guests
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const safeIn = clampStayDate(checkIn, todayIso);
    const rawOut = clampStayDate(checkOut, addDaysToIso(safeIn, 2));
    const safeOut = rawOut <= safeIn ? addDaysToIso(safeIn, 1) : rawOut;
    onConfirm({
      stay,
      checkIn: safeIn,
      checkOut: safeOut,
      guests,
      guestName,
      guestEmail,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Automatyczna rezerwacja noclegu"
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#1E232A] pb-3">
          <div className="flex items-start gap-2.5">
            <BedDouble className="mt-0.5 h-5 w-5 text-[#4ADE80]" aria-hidden="true" />
            <div>
              <h2 className="font-display text-lg font-bold text-white">
                Automatyczna rezerwacja noclegu
              </h2>
              <p className="text-xs text-[#8B95A1]">
                {stay.name} · {stay.city} ({stay.approxPriceEur || 'cena w serwisie'})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij formularz rezerwacji"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border border-[#262D36] bg-[#12161B] text-[#9CA6B2] hover:border-[#3A4350] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-[#9CA6B2]">
            <span className="flex items-center gap-1.5 font-medium">
              <User className="h-3.5 w-3.5 text-[#4ADE80]" />
              Imię i nazwisko gościa
            </span>
            <input
              type="text"
              required
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="min-h-[40px] w-full rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs text-white focus:border-[#22C55E] focus:outline-none"
            />
          </label>

          <label className="space-y-1 text-xs text-[#9CA6B2]">
            <span className="flex items-center gap-1.5 font-medium">
              <Mail className="h-3.5 w-3.5 text-[#4ADE80]" />
              E-mail do potwierdzenia
            </span>
            <input
              type="email"
              required
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              className="min-h-[40px] w-full rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs text-white focus:border-[#22C55E] focus:outline-none"
            />
          </label>

          <label className="space-y-1 text-xs text-[#9CA6B2]">
            <span className="flex items-center gap-1.5 font-medium">
              <Calendar className="h-3.5 w-3.5 text-[#4ADE80]" />
              Zameldowanie
            </span>
            <input
              type="date"
              required
              min={todayIso}
              max={maxDateIso}
              value={checkIn}
              onChange={(e) => {
                const safeIn = clampStayDate(e.target.value, checkIn);
                setCheckIn(safeIn);
                if (checkOut <= safeIn) {
                  setCheckOut(addDaysToIso(safeIn, 2));
                }
              }}
              className="min-h-[40px] w-full rounded-xl border border-[#262D36] bg-[#12161B] px-3 font-mono-tabular text-xs text-white focus:border-[#22C55E] focus:outline-none [color-scheme:dark]"
            />
          </label>

          <label className="space-y-1 text-xs text-[#9CA6B2]">
            <span className="flex items-center gap-1.5 font-medium">
              <Calendar className="h-3.5 w-3.5 text-[#4ADE80]" />
              Wymeldowanie
            </span>
            <input
              type="date"
              required
              min={checkIn || todayIso}
              max={maxDateIso}
              value={checkOut}
              onChange={(e) => {
                const minOut = addDaysToIso(checkIn, 1);
                const safeOut = clampStayDate(e.target.value, minOut);
                setCheckOut(safeOut <= checkIn ? minOut : safeOut);
              }}
              className="min-h-[40px] w-full rounded-xl border border-[#262D36] bg-[#12161B] px-3 font-mono-tabular text-xs text-white focus:border-[#22C55E] focus:outline-none [color-scheme:dark]"
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs text-[#9CA6B2]">
          <span className="flex items-center gap-1.5 font-medium">
            <Users className="h-3.5 w-3.5 text-[#4ADE80]" />
            Liczba gości
          </span>
          <select
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="min-h-[40px] w-full rounded-xl border border-[#262D36] bg-[#12161B] px-3 font-mono-tabular text-xs text-white focus:border-[#22C55E] focus:outline-none"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n} className="bg-[#0B0D10] text-white">
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#1E232A] pt-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#16A34A] disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span>
              {isSubmitting ? 'Rezerwuję automatycznie...' : 'Potwierdź automatyczną rezerwację'}
            </span>
          </button>

          <a
            href={liveBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3.5 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E] whitespace-nowrap"
          >
            <span>Booking.com</span>
            <ExternalLink className="h-3.5 w-3.5 text-[#4ADE80]" />
          </a>

          <a
            href={liveAirbnbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3.5 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E] whitespace-nowrap"
          >
            <span>Airbnb</span>
            <ExternalLink className="h-3.5 w-3.5 text-[#4ADE80]" />
          </a>

          {stay.phone && (
            <a
              href={`tel:${stay.phone}`}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3.5 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E] whitespace-nowrap"
            >
              <PhoneCall className="h-3.5 w-3.5 text-[#4ADE80]" />
              <span>Zadzwoń</span>
            </a>
          )}
        </div>
      </form>
    </div>
  );
};
