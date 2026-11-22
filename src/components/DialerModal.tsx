import React from 'react';
import { PhoneCall, X, Copy, Check } from 'lucide-react';
import { DialTarget } from '../types';
import { sanitizePhoneForTel } from '../utils/location';

interface DialerModalProps {
  target: DialTarget | null;
  onClose: () => void;
}

export const DialerModal: React.FC<DialerModalProps> = ({ target, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!target) return null;

  const telNumber = sanitizePhoneForTel(target.phone);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(telNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Wybieranie numeru na Androidzie"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#4ADE80]">
              Dialer telefonu Android
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-white">
              {target.name}
            </h2>
            {target.address && (
              <p className="mt-1 text-xs text-[#8B95A1]">{target.address}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno wybierania numeru"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[#262D36] bg-[#12161B] text-[#9CA6B2] hover:border-[#3A4350] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-[#262D36] bg-[#12161B] p-4 text-center">
          <p className="text-xs text-[#8B95A1]">Numer gotowy do wybrania</p>
          <p className="mt-1 font-mono-tabular text-2xl font-semibold tracking-wide text-white">
            {telNumber}
          </p>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          <a
            href={`tel:${telNumber}`}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-5 text-sm font-semibold text-[#041409] transition-colors hover:bg-[#16A34A]"
          >
            <PhoneCall className="h-4 w-4" aria-hidden="true" />
            <span>Połącz teraz (Android)</span>
          </a>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#262D36] bg-[#12161B] px-4 text-xs font-semibold text-white hover:border-[#22C55E] cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
                <span>Skopiowano</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden="true" />
                <span>Kopiuj numer</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
