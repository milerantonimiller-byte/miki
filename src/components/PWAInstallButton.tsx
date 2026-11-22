import React, { useState } from 'react';
import { Check, Copy, Download, ExternalLink, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore clipboard restrictions
    }
  };

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="Pobierz i zainstaluj aplikację Miękiszon na telefonie"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#1E5631] bg-[#0D2114] px-4 py-2 text-xs font-semibold text-[#4ADE80] transition-colors hover:border-[#22C55E] hover:bg-[#122E1C] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Pobierz aplikację</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        title="Pobierz aplikację Miękiszon na telefon"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#262D36] bg-[#12161B] px-4 py-2 text-xs font-semibold text-[#E4E8EC] transition-colors hover:border-[#22C55E] hover:text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
      >
        <Download className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
        <span>Pobierz na telefon</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pobierz aplikację na telefon"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#222831] bg-[#0B0D10] p-5 text-[#F4F6F4] shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#1A1F26] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#22C55E]/35 bg-[#091A0F]">
                  <Smartphone className="h-4 w-4 text-[#4ADE80]" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-white">
                    Pobierz Miękiszon na telefon
                  </h2>
                  <p className="text-xs text-[#8B95A1]">
                    Zainstaluj aplikację bezpośrednio na ekranie telefonu
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Zamknij okno pobierania"
                className="rounded-lg p-1.5 text-[#8B95A1] hover:bg-[#161B22] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs leading-relaxed text-[#C7D0D9]">
              {isInIframe && (
                <div className="rounded-xl border border-[#22C55E]/30 bg-[#091A0F] p-3.5 space-y-2">
                  <p className="font-semibold text-[#86EFAC]">
                    Aplikacja działa teraz w podglądzie — otwórz ją w przeglądarce telefonu:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={typeof window !== 'undefined' ? window.location.href : '/'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#22C55E] px-3 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80]"
                    >
                      <span>Otwórz w przeglądarce</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleCopyLink()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#262D36] bg-[#12161B] px-3 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E] cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
                          <span>Skopiowano link</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-[#4ADE80]" />
                          <span>Kopiuj link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {isIOS ? (
                <div className="rounded-xl border border-[#1E232A] bg-[#111419] p-3.5 space-y-2">
                  <p className="font-semibold text-[#4ADE80]">iPhone / iPad (Safari):</p>
                  <p className="flex items-center gap-1.5">
                    <span>1. Dotknij ikony</span>
                    <span className="inline-flex items-center gap-1 rounded border border-[#262D36] bg-[#181C22] px-1.5 py-0.5 font-semibold text-white">
                      <Share className="h-3 w-3 text-[#4ADE80]" /> Udostępnij
                    </span>
                    <span>w dolnym pasku Safari.</span>
                  </p>
                  <p>
                    2. Wybierz <strong className="text-white">Do ekranu początkowego</strong> i dotknij <strong className="text-white">Dodaj</strong> — ikona Miękiszon pojawi się na pulpicie telefonu.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-[#1E232A] bg-[#111419] p-3.5 space-y-2">
                  <p className="font-semibold text-[#4ADE80]">Android (Google Chrome / Edge):</p>
                  <p>
                    1. Otwórz aplikację w przeglądarce <strong className="text-white">Google Chrome</strong> na telefonie.
                  </p>
                  <p>
                    2. Dotknij menu <strong className="text-white">⋮</strong> w prawym górnym rogu i wybierz{' '}
                    <strong className="text-white">Zainstaluj aplikację</strong> (lub <strong className="text-white">Dodaj do ekranu głównego</strong>), aby pobrać ją na telefon.
                  </p>
                </div>
              )}

              {!isInIframe && (
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E] cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
                      <span>Skopiowano link aplikacji</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-[#4ADE80]" />
                      <span>Kopiuj link do wysłania na telefon</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-4 w-full min-h-[42px] rounded-xl bg-[#22C55E] py-2 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] cursor-pointer"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </>
  );
};
