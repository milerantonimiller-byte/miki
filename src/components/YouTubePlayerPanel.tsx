import React from 'react';
import { ExternalLink, Loader2, Play, Shuffle, Youtube, X } from 'lucide-react';
import { AssistantLanguage, YoutubeVideoItem } from '../types';

interface YouTubePlayerPanelProps {
  language: AssistantLanguage;
  query: string;
  results: YoutubeVideoItem[];
  activeVideo: YoutubeVideoItem | null;
  isLoading: boolean;
  error: string | null;
  onSelectVideo: (video: YoutubeVideoItem) => void;
  onPlayAnother?: () => void;
  onClose: () => void;
}

export const YouTubePlayerPanel: React.FC<YouTubePlayerPanelProps> = ({
  language,
  query,
  results,
  activeVideo,
  isLoading,
  error,
  onSelectVideo,
  onPlayAnother,
  onClose,
}) => {
  const isDe = language === 'de';
  if (!isLoading && !error && results.length === 0 && !activeVideo) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Youtube className="h-4 w-4 shrink-0 text-[#EF4444]" />
          <h3 className="truncate text-sm font-semibold text-white">
            YouTube {query ? `· ${query}` : ''}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onPlayAnother && results.length > 1 && (
            <button
              type="button"
              onClick={onPlayAnother}
              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[#1E5631] bg-[#0D2114] px-2.5 text-xs font-medium text-[#4ADE80] hover:border-[#22C55E] cursor-pointer"
            >
              <Shuffle className="h-3 w-3" />
              <span>{isDe ? 'Anderer Titel' : 'Inny kawałek'}</span>
            </button>
          )}
          {activeVideo && (
            <a
              href={activeVideo.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[#262D36] bg-[#12161B] px-2.5 text-xs font-medium text-[#E4E8EC] hover:border-[#22C55E]"
            >
              <span>{isDe ? 'App öffnen' : 'Otwórz w YouTube'}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={isDe ? 'YouTube schließen' : 'Zamknij YouTube'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#262D36] bg-[#12161B] text-[#9CA6B2] hover:border-[#3A4350] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-xs text-[#9CA6B2]">
          <Loader2 className="h-4 w-4 animate-spin text-[#4ADE80]" />
          <span>{isDe ? 'Suche auf YouTube...' : 'Szukam utworów na YouTube...'}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#5C1D22] bg-[#1F0B0D] px-3 py-2 text-xs text-[#FCA5A5]">
          {error}
        </div>
      )}

      {activeVideo && (
        <div className="mb-3 overflow-hidden rounded-xl border border-[#1E232A] bg-black">
          <div className="aspect-video w-full max-h-56">
            <iframe
              key={activeVideo.videoId}
              src={`https://www.youtube.com/embed/${activeVideo.videoId}?autoplay=1&rel=0`}
              title={activeVideo.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-[#1E232A] bg-[#12161B] px-3 py-2 text-xs">
            <span className="truncate font-semibold text-white">{activeVideo.title}</span>
            <span className="shrink-0 font-mono-tabular text-[#8B95A1]">
              {activeVideo.channel} {activeVideo.duration ? `· ${activeVideo.duration}` : ''}
            </span>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {results.slice(0, 6).map((item, idx) => {
            const isPlaying = activeVideo?.videoId === item.videoId;
            return (
              <button
                key={item.videoId}
                type="button"
                onClick={() => onSelectVideo(item)}
                className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                  isPlaying
                    ? 'border-[#22C55E] bg-[#0D2114] text-white'
                    : 'border-[#1E232A] bg-[#12161B] text-[#E4E8EC] hover:border-[#22C55E] hover:bg-[#171C22]'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-mono-tabular text-xs font-bold ${
                    isPlaying
                      ? 'bg-[#22C55E] text-[#041409]'
                      : 'bg-[#1D222A] text-[#9CA6B2]'
                  }`}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{item.title}</div>
                  <div className="truncate text-[11px] text-[#8B95A1]">
                    {item.channel} {item.duration ? `· ${item.duration}` : ''}
                  </div>
                </div>
                <Play
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isPlaying ? 'text-[#4ADE80]' : 'text-[#8B95A1]'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
