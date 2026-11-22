import React, { useEffect } from 'react';
import { ArrowLeft, BedDouble, Train, X } from 'lucide-react';
import { DetachedWindowTab, TabId } from '../types';

interface DetachedWindowModalProps {
  windowTab: DetachedWindowTab;
  previousTab: TabId | null;
  onClose: () => void;
  onBackToPrevious: () => void;
  children: React.ReactNode;
}

const TAB_LABELS: Record<TabId, string> = {
  assistant: 'Asystent',
  food: 'Jedzenie',
  stays: 'Noclegi',
  transit: 'Przejazdy',
  tools: 'Narzędzia',
};

export const DetachedWindowModal: React.FC<DetachedWindowModalProps> = ({
  windowTab,
  previousTab,
  onClose,
  onBackToPrevious,
  children,
}) => {
  useEffect(() => {
    if (!windowTab) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [windowTab, onClose]);

  if (!windowTab) return null;

  const isStays = windowTab === 'stays';
  const showBackOption = previousTab && previousTab !== windowTab;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isStays ? 'Noclegi — osobne okno' : 'Przejazdy — osobne okno'}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:p-6 backdrop-blur-sm"
    >
      <div className="my-auto w-full max-w-5xl rounded-2xl border border-[#1E232A] bg-black shadow-2xl overflow-hidden">
        {/* Window Title Bar with Both Back to Previous & Close Window Options */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E232A] bg-[#0B0D10] px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            {isStays ? (
              <BedDouble className="h-5 w-5 text-[#4ADE80]" aria-hidden="true" />
            ) : (
              <Train className="h-5 w-5 text-[#4ADE80]" aria-hidden="true" />
            )}
            <div>
              <h2 className="font-display text-base font-bold text-white sm:text-lg">
                {isStays ? 'Noclegi — osobne okno' : 'Przejazdy i Trasy — osobne okno'}
              </h2>
              <p className="text-[11px] text-[#8B95A1]">
                {isStays
                  ? 'Hotele, apartamenty i automatyczna rezerwacja'
                  : 'Pociągi DB, autobusy, trasa jazdy samochodem i ceny paliw'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showBackOption && (
              <button
                type="button"
                onClick={onBackToPrevious}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#1E5631] bg-[#0D2114] px-3.5 text-xs font-semibold text-[#4ADE80] transition-colors hover:border-[#22C55E] cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
                <span>Wróć do: {TAB_LABELS[previousTab]}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3.5 text-xs font-semibold text-white transition-colors hover:border-[#22C55E] cursor-pointer whitespace-nowrap"
            >
              <X className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
              <span>Zamknij okno</span>
            </button>
          </div>
        </div>

        {/* Window Scrollable Content */}
        <div className="max-h-[82vh] overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
};
