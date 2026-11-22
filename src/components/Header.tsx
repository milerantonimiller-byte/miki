import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Mic, MicOff } from 'lucide-react';
import { AssistantLanguage, TabId } from '../types';
import ogorekIconImg from '../assets/images/miekiszon_ogorek_icon_1795031756766.jpg';

interface HeaderProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  language: AssistantLanguage;
  onSelectLanguage: (lang: AssistantLanguage) => void;
  isLiveActive: boolean;
  liveStatus?: 'idle' | 'connecting' | 'active' | 'error';
  onToggleLive: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  language,
  onSelectLanguage,
  isLiveActive,
  liveStatus = 'idle',
  onToggleLive,
}) => {
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLangMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setIsLangMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLangMenuOpen]);

  const navItems: { id: TabId; label: string }[] = [
    { id: 'assistant', label: 'Asystent' },
    { id: 'food', label: 'Jedzenie' },
    { id: 'stays', label: 'Noclegi' },
    { id: 'transit', label: 'Przejazdy' },
    { id: 'tools', label: 'Narzędzia' },
  ];

  const isListeningOrConnecting = isLiveActive || liveStatus === 'connecting';
  const showHeaderLiveCta = activeTab !== 'assistant' || isListeningOrConnecting;

  return (
    <header className="relative sm:sticky sm:top-0 z-30 border-b border-white/[0.08] bg-[#06090F]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-15 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
        {/* Zone 1: Brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('assistant')}
          className="inline-flex min-h-[44px] items-center gap-2.5 font-display text-xl font-bold tracking-tight text-white transition-colors hover:text-[#4ADE80] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] rounded-lg"
        >
          <img
            src={ogorekIconImg}
            alt="Ogórek Miękiszon"
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-full border border-[#22C55E]/50 bg-[#0A160E] object-cover object-center shadow-sm shadow-[#22C55E]/20 shrink-0"
          />
          <span>Miękiszon</span>
        </button>

        {/* Zone 2: Desktop Segmented Dark Dock Navigation */}
        <nav
          aria-label="Nawigacja główna"
          className="hidden sm:flex items-center gap-1 rounded-2xl border border-white/[0.07] bg-[#0B1018] p-1 text-xs font-semibold"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`min-h-[36px] rounded-xl px-3.5 transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] ${
                  isActive
                    ? 'bg-[#22C55E] text-[#041409] shadow-sm shadow-[#22C55E]/25'
                    : 'text-[#94A3B8] hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Right Language Selector + Contextual Agent Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {showHeaderLiveCta && (
            <button
              type="button"
              onClick={onToggleLive}
              title={
                isListeningOrConnecting
                  ? 'Wyłącz agenta — zatrzymaj nasłuchiwanie mikrofonu'
                  : 'Włącz agenta do rozmowy na żywo'
              }
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] ${
                isListeningOrConnecting
                  ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]'
                  : 'bg-[#22C55E] text-[#041409] hover:bg-[#4ADE80] shadow-sm shadow-[#22C55E]/25'
              }`}
            >
              {isListeningOrConnecting ? (
                <>
                  <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Wyłącz agenta</span>
                  <span className="sm:hidden">Wyłącz</span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Włącz agenta</span>
                </>
              )}
            </button>
          )}

          <div ref={langMenuRef} className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isLangMenuOpen}
              aria-label="Wybór języka: Polski lub Niemiecki"
              title="Wybierz język: Polski / Deutsch"
              onClick={() => setIsLangMenuOpen((prev) => !prev)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#0D121B] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:border-[#22C55E]/60 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E]"
            >
              <Globe className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
              <span>{language === 'pl' ? 'PL' : 'DE'}</span>
              <ChevronDown
                className={`h-3 w-3 text-[#94A3B8] transition-transform duration-150 ${
                  isLangMenuOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {isLangMenuOpen && (
              <div
                role="listbox"
                aria-label="Język aplikacji"
                className="absolute right-0 z-40 mt-1.5 w-40 overflow-hidden rounded-xl border border-white/[0.1] bg-[#0D131D] p-1 shadow-2xl"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={language === 'pl'}
                  onClick={() => {
                    onSelectLanguage('pl');
                    setIsLangMenuOpen(false);
                  }}
                  className={`flex min-h-[42px] w-full items-center justify-between rounded-lg px-3 text-xs transition-colors cursor-pointer ${
                    language === 'pl'
                      ? 'bg-[#22C55E] font-semibold text-[#041409]'
                      : 'text-[#E2E8F0] hover:bg-white/[0.06]'
                  }`}
                >
                  <span>Polski</span>
                  {language === 'pl' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={language === 'de'}
                  onClick={() => {
                    onSelectLanguage('de');
                    setIsLangMenuOpen(false);
                  }}
                  className={`flex min-h-[42px] w-full items-center justify-between rounded-lg px-3 text-xs transition-colors cursor-pointer ${
                    language === 'de'
                      ? 'bg-[#22C55E] font-semibold text-[#041409]'
                      : 'text-[#E2E8F0] hover:bg-white/[0.06]'
                  }`}
                >
                  <span>Deutsch</span>
                  {language === 'de' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile inline navigation row — crisp 5-column fit */}
      <nav
        aria-label="Nawigacja mobilna"
        className="grid grid-cols-5 sm:hidden border-t border-white/[0.06] bg-[#070B12] px-1.5 py-1 gap-1"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex min-h-[40px] items-center justify-center rounded-xl px-1 text-[11px] font-semibold transition-all whitespace-nowrap truncate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22C55E] ${
                isActive
                  ? 'bg-[#22C55E]/15 text-[#4ADE80] ring-1 ring-[#22C55E]/35'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
