import React, { useState } from 'react';
import { Check, Copy, NotebookPen, Plus, Trash2, X } from 'lucide-react';
import { AssistantLanguage, NotepadNote } from '../types';

interface NotepadModalProps {
  isOpen: boolean;
  language: AssistantLanguage;
  notes: NotepadNote[];
  onAddNote: (text: string) => void;
  onDeleteNote: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export const NotepadModal: React.FC<NotepadModalProps> = ({
  isOpen,
  language,
  notes,
  onAddNote,
  onDeleteNote,
  onClearAll,
  onClose,
}) => {
  const isDe = language === 'de';
  const [draft, setDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddNote(trimmed);
    setDraft('');
  };

  const handleCopy = (note: NotepadNote) => {
    void navigator.clipboard?.writeText(note.text);
    setCopiedId(note.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-4 shadow-2xl">
        <div className="mb-3 flex shrink-0 items-center justify-between border-b border-[#1E232A] pb-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <NotebookPen className="h-4 w-4 text-[#4ADE80]" />
            <span>
              {isDe ? 'Notizblock' : 'Notatnik'} ({notes.length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            {notes.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="rounded-lg border border-[#5C1D22] bg-[#1F0B0D] px-2.5 py-1 text-xs font-medium text-[#FCA5A5] hover:border-[#EF4444] cursor-pointer"
              >
                {isDe ? 'Alle löschen' : 'Wyczyść'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={isDe ? 'Notizblock schließen' : 'Zamknij notatnik'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#262D36] bg-[#12161B] text-[#9CA6B2] hover:border-[#3A4350] hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mb-3 flex shrink-0 gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isDe
                ? 'Notiz schreiben (oder sage: „Wpisz do notatnika ...“)'
                : 'Wpisz notatkę lub powiedz: „Wpisz do notatnika ...”'
            }
            className="min-h-[42px] flex-1 rounded-xl border border-[#262D36] bg-[#12161B] px-3 text-sm text-white placeholder-[#6B7684] focus:border-[#22C55E] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3.5 text-sm font-semibold text-[#041409] hover:bg-[#16A34A] disabled:opacity-40 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>{isDe ? 'Speichern' : 'Zapisz'}</span>
          </button>
        </form>

        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {notes.length === 0 ? (
            <div className="rounded-xl border border-[#1E232A] bg-[#12161B] px-4 py-6 text-center text-xs text-[#8B95A1]">
              {isDe
                ? 'Keine Notizen vorhanden. Sage z. B.: „Wpisz do notatnika mleko i chleb“.'
                : 'Brak zapisanych notatek. Powiedz np. „Wpisz do notatnika kup mleko i chleb”.'}
            </div>
          ) : (
            notes.map((note, idx) => (
              <div
                key={note.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-[#1E232A] bg-[#12161B] px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2 text-[11px] text-[#8B95A1]">
                    <span className="font-mono-tabular font-semibold text-[#4ADE80]">
                      #{idx + 1}
                    </span>
                    <span className="font-mono-tabular">{note.createdAt}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-[#E4E8EC] whitespace-pre-wrap break-words">
                    {note.text}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(note)}
                    aria-label="Kopiuj"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#262D36] bg-[#0B0D10] text-[#9CA6B2] hover:border-[#22C55E] hover:text-white cursor-pointer"
                  >
                    {copiedId === note.id ? (
                      <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteNote(note.id)}
                    aria-label="Usuń notatkę"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#262D36] bg-[#0B0D10] text-[#9CA6B2] hover:border-[#5C1D22] hover:text-[#FCA5A5] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
