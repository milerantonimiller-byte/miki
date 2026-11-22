import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Phone,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import {
  AssistantLanguage,
  BrowserArticleData,
  WebSearchResponse,
  WebSearchResultItem,
} from '../types';

interface BrowserModalProps {
  isOpen: boolean;
  language: AssistantLanguage;
  query: string;
  data: WebSearchResponse | null;
  isLoading: boolean;
  error: string | null;
  article: BrowserArticleData | null;
  isArticleLoading: boolean;
  canGoBack: boolean;
  onSearch: (query: string) => void;
  onSelectArticle: (item: WebSearchResultItem) => void;
  onReadArticleAloud: (text: string) => void;
  onGoBack: () => void;
  onClose: () => void;
}

function isSafeHttpUrl(raw?: string | null): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export const BrowserModal: React.FC<BrowserModalProps> = ({
  isOpen,
  language,
  query,
  data,
  isLoading,
  error,
  article,
  isArticleLoading,
  canGoBack,
  onSearch,
  onSelectArticle,
  onReadArticleAloud,
  onGoBack,
  onClose,
}) => {
  const isDe = language === 'de';
  const [draftQuery, setDraftQuery] = useState(query);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftQuery.trim();
    if (!cleaned) return;
    onSearch(cleaned);
  };

  const externalChromeUrl = draftQuery.trim()
    ? `https://www.google.com/search?q=${encodeURIComponent(draftQuery.trim())}`
    : 'https://www.google.com';

  const articleSafeUrl = isSafeHttpUrl(article?.url);
  const starterTopics = isDe
    ? ['Nachrichten Deutschland', 'Wetter Berlin', 'EUR PLN Kurs']
    : ['Wiadomości Polska i Niemcy', 'Pogoda Berlin', 'Kurs EUR PLN'];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isDe ? 'Sprachbrowser' : 'Przeglądarka sterowana głosem'}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:p-6 backdrop-blur-sm"
    >
      <div className="my-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-[#1E232A] bg-[#0B0D10] shadow-2xl">
        {/* Top Browser Chrome Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#1E232A] bg-[#080B10] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onGoBack}
              title={
                article
                  ? isDe
                    ? 'Zurück zu Suchergebnissen'
                    : 'Cofnij do wyników'
                  : canGoBack
                    ? isDe
                      ? 'Schritt zurück'
                      : 'Cofnij okno'
                    : isDe
                      ? 'Browser schließen'
                      : 'Cofnij / zamknij'
              }
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs font-semibold text-[#E2E8F0] transition-colors hover:border-[#22C55E] hover:text-white cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
              <span>{isDe ? 'Zurück' : 'Cofnij'}</span>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <Globe className="h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="font-display text-sm sm:text-base font-bold text-white truncate">
                  {isDe ? 'Przeglądarka / Browser' : 'Przeglądarka'}
                </h2>
                <p className="text-[11px] text-[#8B95A1] truncate">
                  {isDe
                    ? 'Per Sprache steuerbar — suchen, öffnen, zurückgehen oder schließen'
                    : 'Sterowana głosem — szukaj, otwieraj, cofaj lub zamknij komendą'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={externalChromeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#22C55E] hover:text-white"
            >
              <span>Chrome</span>
              <ExternalLink className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
            </a>

            <button
              type="button"
              onClick={onClose}
              aria-label={isDe ? 'Browser schließen' : 'Zamknij przeglądarkę'}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#EF4444]/40 bg-[#26090A] px-3 text-xs font-semibold text-[#FCA5A5] transition-colors hover:bg-[#380E10] cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span>{isDe ? 'Schließen' : 'Zamknij'}</span>
            </button>
          </div>
        </div>

        {/* Address / Search Bar */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-2 border-b border-[#1E232A] bg-[#0B0F16] px-4 py-3 sm:px-5"
        >
          <div className="relative flex-1 min-w-[200px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder={
                isDe
                  ? 'Suchbegriff, Thema oder Artikel eingeben...'
                  : 'Wpisz hasło, temat artykułu lub adres...'
              }
              aria-label={isDe ? 'Browser-Suche' : 'Wyszukiwarka przeglądarki'}
              className="min-h-[42px] w-full rounded-xl border border-[#262D36] bg-[#12161B] pl-9 pr-3 text-xs sm:text-sm text-white placeholder-[#64748B] focus:border-[#22C55E] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!draftQuery.trim() || isLoading}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] disabled:opacity-45 cursor-pointer"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{isDe ? 'Suchen' : 'Szukaj'}</span>
          </button>
        </form>

        {/* Scrollable Browser Viewport */}
        <div className="max-h-[70vh] overflow-y-auto p-4 sm:p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-[#EF4444]/40 bg-[#26090A] px-4 py-3 text-xs text-[#FCA5A5]">
              {error}
            </div>
          )}

          {(isLoading || isArticleLoading) && (
            <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-white/[0.08] bg-[#0F1520] py-10 text-xs text-[#94A3B8]">
              <Loader2 className="h-4 w-4 animate-spin text-[#4ADE80]" aria-hidden="true" />
              <span>
                {isArticleLoading
                  ? isDe
                    ? 'Artikel wird geladen...'
                    : 'Wczytuję treść artykułu...'
                  : isDe
                    ? 'Suche läuft...'
                    : 'Przeszukuję internet...'}
              </span>
            </div>
          )}

          {/* Article Reader View */}
          {!isArticleLoading && article && (
            <article className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0E141F] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                <div className="space-y-1 min-w-0">
                  <span className="inline-block rounded-lg border border-[#1E5631] bg-[#0D2114] px-2.5 py-0.5 text-[11px] font-medium text-[#4ADE80]">
                    {article.domain}
                  </span>
                  <h3 className="font-display text-base sm:text-lg font-bold text-white">
                    {article.title}
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onReadArticleAloud(article.content)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3.5 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] cursor-pointer"
                  >
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isDe ? 'Vorlesen' : 'Czytaj na głos'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onGoBack}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs font-semibold text-white hover:border-[#22C55E] cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                    <span>{isDe ? 'Zurück' : 'Wróć do wyników'}</span>
                  </button>

                  {articleSafeUrl && (
                    <a
                      href={articleSafeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs font-medium text-[#CBD5E1] hover:border-[#22C55E] hover:text-white"
                    >
                      <span>{isDe ? 'Original' : 'Oryginał'}</span>
                      <ExternalLink className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>

              <div className="space-y-3 text-xs sm:text-sm leading-relaxed text-[#E2E8F0]">
                {article.content
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((para, idx) => (
                    <p key={idx}>{para}</p>
                  ))}
              </div>
            </article>
          )}

          {/* Search Results List */}
          {!isLoading && !isArticleLoading && !article && data && (
            <div className="space-y-3">
              {data.answerSummary && (
                <div className="rounded-2xl border border-[#1E5631]/60 bg-[#081A10] p-4 text-xs sm:text-sm leading-relaxed text-[#DCFCE7]">
                  {data.answerSummary}
                </div>
              )}

              {data.results.length > 0 ? (
                <div className="space-y-2.5">
                  {data.results.map((item, idx) => {
                    const safeWebsiteUrl = isSafeHttpUrl(item.websiteUrl);
                    return (
                      <div
                        key={item.id || `${item.title}-${idx}`}
                        className="rounded-2xl border border-white/[0.08] bg-[#0F1520] p-4 transition-colors hover:border-[#22C55E]/50"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1 min-w-[200px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-md bg-[#121C2B] px-1.5 font-mono-tabular text-[11px] font-bold text-[#4ADE80]">
                                {idx + 1}.
                              </span>
                              <span className="text-[11px] font-medium text-[#94A3B8]">
                                {item.categoryLabel}
                              </span>
                            </div>

                            <h3 className="font-display text-sm font-bold text-white">
                              {item.title}
                            </h3>

                            {item.summary && (
                              <p className="text-xs leading-relaxed text-[#CBD5E1]">
                                {item.summary}
                              </p>
                            )}

                            {(item.address || item.phone) && (
                              <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-[#94A3B8]">
                                {item.address && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="h-3 w-3 text-[#4ADE80]" />
                                    {item.address}
                                  </span>
                                )}
                                {item.phone && (
                                  <span className="inline-flex items-center gap-1 font-mono-tabular">
                                    <Phone className="h-3 w-3 text-[#4ADE80]" />
                                    {item.phone}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {safeWebsiteUrl && (
                              <button
                                type="button"
                                onClick={() => onSelectArticle(item)}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3.5 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] cursor-pointer"
                              >
                                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{isDe ? 'Im Browser öffnen' : 'Otwórz w przeglądarce'}</span>
                              </button>
                            )}

                            {safeWebsiteUrl && (
                              <a
                                href={safeWebsiteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-xs font-medium text-[#CBD5E1] hover:border-[#22C55E] hover:text-white"
                              >
                                <span>{isDe ? 'Original' : 'Oryginał'}</span>
                                <ExternalLink className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-2xl border border-white/[0.08] bg-[#0F1520] p-4 text-xs text-[#94A3B8]">
                  {isDe
                    ? 'Keine Ergebnisse gefunden — versuche einen anderen Suchbegriff.'
                    : 'Brak wyników dla tego zapytania — spróbuj wpisać lub powiedzieć inne hasło.'}
                </p>
              )}
            </div>
          )}

          {/* Empty Starter Screen */}
          {!isLoading && !isArticleLoading && !article && !data && !error && (
            <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#0E141F] p-5">
              <div>
                <h3 className="font-display text-sm font-bold text-white">
                  {isDe ? 'Browser bereit für Sprachbefehle' : 'Przeglądarka gotowa na polecenia głosowe'}
                </h3>
                <p className="mt-1 text-xs text-[#94A3B8]">
                  {isDe
                    ? 'Sage z. B. „Suche Nachrichten über Berlin“, „Öffne Artikel 1“, „Zurück“ oder „Schließe Browser“.'
                    : 'Powiedz np. „wyszukaj artykuł o Berlinie”, „otwórz pierwszy artykuł”, „cofnij okno” albo „zamknij przeglądarkę”.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {starterTopics.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => {
                      setDraftQuery(topic);
                      onSearch(topic);
                    }}
                    className="min-h-[38px] rounded-xl border border-[#262D36] bg-[#12161B] px-3.5 text-xs font-medium text-[#E2E8F0] transition-colors hover:border-[#22C55E] hover:text-white cursor-pointer"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
