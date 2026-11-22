import React, { useEffect, useRef, useState } from 'react';
import {
  MicOff,
  Square,
  Volume2,
  VolumeX,
  Radio,
  AlarmClock,
  Bell,
  ExternalLink,
  Trash2,
  Camera,
  SwitchCamera,
  MonitorUp,
  VideoOff,
  AlertCircle,
  BookOpen,
  Play,
  Pause,
  Calculator,
  NotebookPen,
  Send,
  Globe,
  Youtube,
  MessageCircle,
  Loader2,
  ChevronDown,
  Check,
  Wrench,
} from 'lucide-react';
import type { StoryPlaybackStatus } from '../utils/audio';
import {
  AlarmItem,
  AssistantLanguage,
  CameraFacingMode,
  ExternalAppLaunch,
  LiveVideoMode,
  ReminderItem,
  VOICE_PROFILES,
  VoiceGender,
} from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface VoiceDockProps {
  language: AssistantLanguage;
  onSelectLanguage: (lang: AssistantLanguage) => void;
  voiceGender: VoiceGender;
  onSelectVoiceGender: (gender: VoiceGender) => void;
  isLiveActive: boolean;
  liveStatus: 'idle' | 'connecting' | 'active' | 'error';
  micLevel: number;
  onToggleLive: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  videoMode: LiveVideoMode;
  cameraFacingMode: CameraFacingMode;
  videoError: string | null;
  videoPreviewRef: React.RefObject<HTMLVideoElement | null>;
  onToggleCamera: () => void;
  onSwitchCameraFacing: () => void;
  onToggleScreenShare: () => void;
  onStopVideo: () => void;
  assistantReply?: string;
  userTranscript?: string;
  voiceError?: string | null;
  isVoiceProcessing?: boolean;
  canFinishUtterance?: boolean;
  onFinishUtterance?: () => void;
  onReplayReply?: () => void;
  isCommandLoading?: boolean;
  onSubmitCommand?: (text: string) => void;
  alarms: AlarmItem[];
  reminders: ReminderItem[];
  onRemoveAlarm: (id: string) => void;
  onRemoveReminder: (id: string) => void;
  lastLaunchedApp: ExternalAppLaunch | null;
  onDismissLaunchedApp: () => void;
  storyStatus?: StoryPlaybackStatus;
  storyProgress?: { currentIndex: number; total: number };
  onPauseStory?: () => void;
  onResumeStory?: () => void;
  onStopStory?: () => void;
  onOpenCalculator?: () => void;
  onOpenNotepad?: () => void;
  onOpenBrowser?: () => void;
  onOpenYoutube?: () => void;
  onOpenWhatsapp?: () => void;
  notesCount?: number;
}

export const VoiceDock: React.FC<VoiceDockProps> = ({
  language,
  onSelectLanguage,
  voiceGender,
  onSelectVoiceGender,
  isLiveActive,
  liveStatus,
  micLevel,
  onToggleLive,
  isMuted,
  onToggleMute,
  videoMode,
  cameraFacingMode,
  videoError,
  videoPreviewRef,
  onToggleCamera,
  onSwitchCameraFacing,
  onToggleScreenShare,
  onStopVideo,
  assistantReply = '',
  userTranscript = '',
  voiceError = null,
  isVoiceProcessing = false,
  canFinishUtterance = false,
  onFinishUtterance,
  onReplayReply,
  isCommandLoading = false,
  onSubmitCommand,
  alarms,
  reminders,
  onRemoveAlarm,
  onRemoveReminder,
  lastLaunchedApp,
  onDismissLaunchedApp,
  storyStatus = 'idle',
  storyProgress = { currentIndex: 0, total: 0 },
  onPauseStory,
  onResumeStory,
  onStopStory,
  onOpenCalculator,
  onOpenNotepad,
  onOpenBrowser,
  onOpenYoutube,
  onOpenWhatsapp,
  notesCount = 0,
}) => {
  const [commandDraft, setCommandDraft] = useState('');
  const [isVoiceMenuOpen, setIsVoiceMenuOpen] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(true);
  const voiceDropdownRef = useRef<HTMLDivElement | null>(null);

  const activeProfile =
    VOICE_PROFILES.find((v) => v.id === voiceGender) || VOICE_PROFILES[0];
  const femaleVoices = VOICE_PROFILES.filter((v) => v.gender === 'female');
  const maleVoices = VOICE_PROFILES.filter((v) => v.gender === 'male');

  const isDe = language === 'de';
  const isListeningOrConnecting = isLiveActive || liveStatus === 'connecting';

  useEffect(() => {
    if (!isVoiceMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        voiceDropdownRef.current &&
        !voiceDropdownRef.current.contains(e.target as Node)
      ) {
        setIsVoiceMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsVoiceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVoiceMenuOpen]);

  const activeVideoLabel =
    videoMode === 'screen'
      ? isDe
        ? 'Bildschirm wird geteilt'
        : 'Udostępniany ekran telefonu'
      : cameraFacingMode === 'environment'
        ? isDe
          ? 'Rückkamera aktiv'
          : 'Kamera tylna aktywna'
        : isDe
          ? 'Frontkamera aktiv'
          : 'Kamera przednia aktywna';

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandDraft.trim();
    if (!trimmed || !onSubmitCommand || isCommandLoading) return;
    setCommandDraft('');
    onSubmitCommand(trimmed);
  };

  return (
    <section
      aria-label={isDe ? 'Gespräch mit dem Assistenten' : 'Rozmowa z asystentem'}
      className="flex flex-col gap-5"
    >
      {/* Foreground Top Controls: Languages + Phone Download + Live Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1B221A] bg-[#0A0C0A] p-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label={isDe ? 'Sprache' : 'Język rozmowy'}
            className="flex items-center rounded-xl border border-[#232B21] bg-[#050605] p-1"
          >
            <button
              type="button"
              onClick={() => onSelectLanguage('pl')}
              className={`min-h-[38px] rounded-lg px-4 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] ${
                language === 'pl'
                  ? 'bg-[#84CC16] text-[#050505]'
                  : 'text-[#9CA69A] hover:text-white'
              }`}
            >
              Polski
            </button>
            <button
              type="button"
              onClick={() => onSelectLanguage('de')}
              className={`min-h-[38px] rounded-lg px-4 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] ${
                language === 'de'
                  ? 'bg-[#84CC16] text-[#050505]'
                  : 'text-[#9CA69A] hover:text-white'
              }`}
            >
              Deutsch
            </button>
          </div>

          <PWAInstallButton />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isListeningOrConnecting && (
            <button
              type="button"
              onClick={onToggleMute}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-4 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] ${
                isMuted
                  ? 'border-[#54401B] bg-[#1E170B] text-[#FDE68A]'
                  : 'border-[#252D24] bg-[#121612] text-[#D1D7D0] hover:border-[#84CC16]'
              }`}
            >
              {isMuted ? (
                <>
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                  <span>{isDe ? 'Stumm' : 'Wyciszony'}</span>
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4 text-[#84CC16]" aria-hidden="true" />
                  <span>{isDe ? 'Mikrofon stumm' : 'Wycisz mikrofon'}</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleLive}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] ${
              isListeningOrConnecting
                ? 'bg-[#DC2626] text-white hover:bg-[#EF4444]'
                : 'bg-[#84CC16] text-[#050505] hover:bg-[#9BE12E]'
            }`}
          >
            {isListeningOrConnecting ? (
              <>
                <MicOff className="h-4 w-4" aria-hidden="true" />
                <span>{isDe ? 'Agent ausschalten' : 'Wyłącz agenta'}</span>
              </>
            ) : (
              <>
                <Radio className="h-4 w-4" aria-hidden="true" />
                <span>{isDe ? 'Live-Gespräch starten' : 'Włącz rozmowę na żywo'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Response Field + Text Command Input + Voice Dropdown */}
      <div
        className={`space-y-5 rounded-2xl border p-5 sm:p-6 transition-colors ${
          liveStatus === 'error'
            ? 'border-[#3B1D1D] bg-[#110808]'
            : liveStatus === 'active'
              ? 'border-[#2D3E25] bg-[#0B100A]'
              : 'border-[#1B221A] bg-[#0A0C0A]'
        }`}
      >
        {/* Clean Assistant Response Area */}
        <div role="status" aria-live="polite" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-[#84CC16]">
                {isDe ? 'Antwort' : 'Odpowiedź'}
              </span>
              {isVoiceProcessing && (
                <span className="inline-flex items-center gap-1.5 text-xs text-[#A3E635]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>{isDe ? 'Verarbeite...' : 'Przetwarzam...'}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {liveStatus === 'active' && canFinishUtterance && onFinishUtterance && !isVoiceProcessing && (
                <button
                  type="button"
                  onClick={onFinishUtterance}
                  className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-[#354A2A] bg-[#141E10] px-2.5 text-[11px] font-semibold text-[#D9F99D] transition-colors hover:border-[#84CC16] cursor-pointer"
                >
                  <Send className="h-3 w-3" aria-hidden="true" />
                  <span>{isDe ? 'Senden' : 'Wyślij wypowiedź'}</span>
                </button>
              )}

              {liveStatus === 'active' && !isMuted && (
                <div className="flex items-center gap-2">
                  <div
                    aria-hidden="true"
                    className="h-1.5 w-24 overflow-hidden rounded-full bg-[#192117]"
                  >
                    <div
                      className="h-full origin-left bg-[#84CC16] transition-transform duration-75"
                      style={{ transform: `scaleX(${Math.max(0.08, micLevel)})` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {userTranscript && (
            <div className="rounded-xl border border-[#1E271C] bg-[#060906] px-3.5 py-2 text-xs text-[#AEB8AC]">
              <span className="font-semibold text-[#84CC16]">
                {isDe ? 'Du:' : 'Ty:'}{' '}
              </span>
              <span>{userTranscript}</span>
            </div>
          )}

          <div className="flex items-start gap-2.5">
            {liveStatus === 'error' && (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" aria-hidden="true" />
            )}
            <p
              className={`text-[15px] leading-relaxed ${
                liveStatus === 'error' ? 'text-[#FCA5A5]' : 'text-[#EEF2EC]'
              }`}
            >
              {assistantReply ||
                (isDe
                  ? 'Bereit. Live-Gespräch starten oder Befehl eingeben.'
                  : 'Gotowy. Uruchom rozmowę na żywo lub wpisz polecenie.')}
            </p>
          </div>

          {voiceError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#4C2222] bg-[#180B0B] px-3.5 py-2.5 text-xs text-[#FCA5A5]"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" aria-hidden="true" />
                <span>{voiceError}</span>
              </div>
              {onReplayReply && assistantReply && !isMuted && (
                <button
                  type="button"
                  onClick={onReplayReply}
                  className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[#5B2B2B] bg-[#261111] px-3 text-xs font-semibold text-[#FECACA] hover:bg-[#341616] cursor-pointer shrink-0"
                >
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isDe ? 'Erneut abspielen' : 'Odtwórz głos'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Text Command Input Bar */}
        {onSubmitCommand && (
          <form
            onSubmit={handleCommandSubmit}
            className="flex flex-col gap-2.5 border-t border-[#161C15] pt-4 sm:flex-row"
          >
            <input
              type="text"
              value={commandDraft}
              onChange={(e) => setCommandDraft(e.target.value)}
              disabled={isCommandLoading}
              placeholder={
                isDe
                  ? 'Befehl oder Frage eingeben...'
                  : 'Wpisz polecenie lub pytanie...'
              }
              aria-label={isDe ? 'Textbefehl eingeben' : 'Wpisz polecenie tekstowe'}
              className="min-h-[46px] flex-1 rounded-xl border border-[#232A22] bg-[#050605] px-4 text-sm text-[#F3F5F2] placeholder-[#6B7369] focus:border-[#84CC16] focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isCommandLoading || !commandDraft.trim()}
              className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#84CC16] px-6 text-xs font-semibold text-[#050505] transition-colors hover:bg-[#9BE12E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16]"
            >
              {isCommandLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isCommandLoading ? (isDe ? 'Sende...' : 'Wysyłam...') : isDe ? 'Senden' : 'Wyślij'}</span>
            </button>
          </form>
        )}

        {/* Voice Selector Dropdown ("z listy otwieranej") */}
        <div
          ref={voiceDropdownRef}
          className="relative flex flex-col gap-2 border-t border-[#161C15] pt-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-xs font-medium text-[#9CA69A]">
            {isDe ? 'Stimme des Assistenten' : 'Wybór głosu asystenta'}
          </span>

          <div className="relative w-full sm:w-80">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isVoiceMenuOpen}
              onClick={() => setIsVoiceMenuOpen((prev) => !prev)}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-[#242D22] bg-[#060806] px-3.5 py-2 text-left text-xs text-[#F3F5F2] transition-colors hover:border-[#84CC16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] cursor-pointer"
            >
              <span className="truncate font-semibold">
                {isDe ? activeProfile.labelDe : activeProfile.labelPl}
                <span className="ml-1.5 font-normal text-[#8C948A]">
                  ·{' '}
                  {activeProfile.gender === 'male'
                    ? isDe
                      ? 'männlich'
                      : 'męski'
                    : isDe
                      ? 'weiblich'
                      : 'damski'}{' '}
                  ({isDe ? activeProfile.styleNoteDe : activeProfile.styleNotePl})
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#84CC16] transition-transform duration-150 ${
                  isVoiceMenuOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {isVoiceMenuOpen && (
              <div
                role="listbox"
                aria-label={isDe ? 'Stimme auswählen' : 'Lista głosów asystenta'}
                className="absolute right-0 z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-[#263124] bg-[#0A0D0A] p-1.5 shadow-2xl"
              >
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[#8C948A]">
                  {isDe ? 'Weibliche Stimmen' : 'Głosy kobiece'}
                </div>
                {femaleVoices.map((voice) => {
                  const selected = voiceGender === voice.id;
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onSelectVoiceGender(voice.id);
                        setIsVoiceMenuOpen(false);
                      }}
                      className={`flex min-h-[42px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#84CC16] font-semibold text-[#050505]'
                          : 'text-[#E2E7E0] hover:bg-[#141A13]'
                      }`}
                    >
                      <span className="truncate">
                        {isDe ? voice.labelDe : voice.labelPl}{' '}
                        <span
                          className={
                            selected ? 'font-normal text-[#18220A]' : 'font-normal text-[#8C948A]'
                          }
                        >
                          — {isDe ? voice.styleNoteDe : voice.styleNotePl}
                        </span>
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}

                <div className="mt-1 border-t border-[#181E17] px-2.5 pt-2 pb-1.5 text-[11px] font-semibold text-[#8C948A]">
                  {isDe ? 'Männliche Stimmen' : 'Głosy męskie'}
                </div>
                {maleVoices.map((voice) => {
                  const selected = voiceGender === voice.id;
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onSelectVoiceGender(voice.id);
                        setIsVoiceMenuOpen(false);
                      }}
                      className={`flex min-h-[42px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#84CC16] font-semibold text-[#050505]'
                          : 'text-[#E2E7E0] hover:bg-[#141A13]'
                      }`}
                    >
                      <span className="truncate">
                        {isDe ? voice.labelDe : voice.labelPl}{' '}
                        <span
                          className={
                            selected ? 'font-normal text-[#18220A]' : 'font-normal text-[#8C948A]'
                          }
                        >
                          — {isDe ? voice.styleNoteDe : voice.styleNotePl}
                        </span>
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Separate Category: Tools ("Narzędzia") */}
      <div className="rounded-2xl border border-[#1B221A] bg-[#0A0C0A] p-4 sm:px-6 sm:py-5">
        <button
          type="button"
          aria-expanded={isToolsOpen}
          onClick={() => setIsToolsOpen((prev) => !prev)}
          className="flex min-h-[42px] w-full items-center justify-between gap-2 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] rounded-lg"
        >
          <div className="flex items-center gap-2.5">
            <Wrench className="h-4 w-4 text-[#84CC16]" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold tracking-tight text-[#F3F5F2]">
              {isDe ? 'Werkzeuge' : 'Narzędzia'}
            </h2>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-[#8C948A] transition-transform duration-150 ${
              isToolsOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>

        {isToolsOpen && (
          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[#161C15] pt-4 md:grid-cols-2">
            <div className="space-y-2.5">
              <div className="text-xs font-medium text-[#8C948A]">
                {isDe ? 'Kamera & Bildschirm' : 'Kamera i ekran'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleCamera}
                  className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16] ${
                    videoMode === 'camera'
                      ? 'border-[#84CC16] bg-[#162212] text-[#D9F99D]'
                      : 'border-[#232B21] bg-[#0F130F] text-[#E2E7E0] hover:border-[#84CC16]'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5 text-[#84CC16]" aria-hidden="true" />
                  <span>
                    {videoMode === 'camera'
                      ? cameraFacingMode === 'environment'
                        ? isDe
                          ? 'Rückkamera (an)'
                          : 'Kamera tylna (wł.)'
                        : isDe
                          ? 'Frontkamera (an)'
                          : 'Kamera przednia (wł.)'
                      : 'Kamera'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onSwitchCameraFacing}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#232B21] bg-[#0F130F] px-3.5 text-xs font-semibold text-[#E2E7E0] transition-colors hover:border-[#84CC16] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16]"
                >
                  <SwitchCamera className="h-3.5 w-3.5 text-[#84CC16]" aria-hidden="true" />
                  <span>
                    {cameraFacingMode === 'environment'
                      ? isDe
                        ? 'Frontkamera'
                        : 'Przednia'
                      : isDe
                        ? 'Rückkamera'
                        : 'Tylna'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onToggleScreenShare}
                  className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8] ${
                    videoMode === 'screen'
                      ? 'border-[#38BDF8] bg-[#0D1B24] text-[#BAE6FD]'
                      : 'border-[#232B21] bg-[#0F130F] text-[#E2E7E0] hover:border-[#38BDF8]'
                  }`}
                >
                  <MonitorUp className="h-3.5 w-3.5 text-[#38BDF8]" aria-hidden="true" />
                  <span>
                    {videoMode === 'screen'
                      ? isDe
                        ? 'Freigabe aus'
                        : 'Zatrzymaj ekran'
                      : isDe
                        ? 'Bildschirm'
                        : 'Ekran'}
                  </span>
                </button>

                {videoMode !== 'none' && (
                  <button
                    type="button"
                    onClick={onStopVideo}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#4C2424] bg-[#1A0D0D] px-3.5 text-xs font-medium text-[#FCA5A5] hover:bg-[#261212] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isDe ? 'Bild aus' : 'Wyłącz obraz'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2.5 border-t border-[#141914] pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-5">
              <div className="text-xs font-medium text-[#8C948A]">
                {isDe ? 'Anwendungen' : 'Aplikacje'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenBrowser && (
                  <button
                    type="button"
                    onClick={onOpenBrowser}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#232B21] bg-[#0F130F] px-3.5 text-xs font-semibold text-[#E2E7E0] transition-colors hover:border-[#84CC16] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16]"
                  >
                    <Globe className="h-3.5 w-3.5 text-[#84CC16]" aria-hidden="true" />
                    <span>{isDe ? 'Browser' : 'Przeglądarka'}</span>
                  </button>
                )}

                {onOpenYoutube && (
                  <button
                    type="button"
                    onClick={onOpenYoutube}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#232B21] bg-[#0F130F] px-3.5 text-xs font-semibold text-[#E2E7E0] transition-colors hover:border-[#EF4444] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EF4444]"
                  >
                    <Youtube className="h-3.5 w-3.5 text-[#EF4444]" aria-hidden="true" />
                    <span>YouTube</span>
                  </button>
                )}

                {onOpenWhatsapp && (
                  <button
                    type="button"
                    onClick={onOpenWhatsapp}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#232B21] bg-[#0F130F] px-3.5 text-xs font-semibold text-[#E2E7E0] transition-colors hover:border-[#84CC16] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16]"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-[#84CC16]" aria-hidden="true" />
                    <span>WhatsApp</span>
                  </button>
                )}

                {onOpenCalculator && (
                  <button
                    type="button"
                    onClick={onOpenCalculator}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#232B21] bg-[#0F130F] px-3.5 text-xs font-semibold text-[#E2E7E0] transition-colors hover:border-[#84CC16] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16]"
                  >
                    <Calculator className="h-3.5 w-3.5 text-[#84CC16]" aria-hidden="true" />
                    <span>{isDe ? 'Rechner' : 'Kalkulator'}</span>
                  </button>
                )}

                {onOpenNotepad && (
                  <button
                    type="button"
                    onClick={onOpenNotepad}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#232B21] bg-[#0F130F] px-3.5 text-xs font-semibold text-[#E2E7E0] transition-colors hover:border-[#84CC16] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#84CC16]"
                  >
                    <NotebookPen className="h-3.5 w-3.5 text-[#84CC16]" aria-hidden="true" />
                    <span>
                      {isDe ? 'Notizen' : 'Notatnik'}
                      {notesCount > 0 ? ` (${notesCount})` : ''}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Story Narration Status & Interruption Resume Controls */}
      {(storyStatus === 'loading' || storyStatus === 'playing' || storyStatus === 'paused') && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[#2B3925] bg-[#0D130B] px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-[#D9F99D]">
            <BookOpen className="h-4 w-4 text-[#84CC16]" aria-hidden="true" />
            <span className="font-semibold">
              {storyStatus === 'paused'
                ? isDe
                  ? 'Märchen pausiert'
                  : 'Bajka wstrzymana — powiedz „kontynuuj”'
                : storyStatus === 'loading'
                  ? isDe
                    ? 'Lade Märchen...'
                    : 'Przygotowuję płynną narrację bajki...'
                  : isDe
                    ? 'Märchen wird vorgelesen'
                    : 'Opowiadam bajkę od A do Z'}
            </span>
            {storyProgress.total > 0 && (
              <span className="font-mono-tabular text-[11px] text-[#95A391]">
                ({Math.min(storyProgress.currentIndex + 1, storyProgress.total)}/{storyProgress.total})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {storyStatus === 'paused' ? (
              <button
                type="button"
                onClick={onResumeStory}
                className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-[#84CC16] px-2.5 text-xs font-semibold text-[#050505] hover:bg-[#9BE12E] cursor-pointer"
              >
                <Play className="h-3 w-3" />
                <span>{isDe ? 'Weiter' : 'Kontynuuj'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPauseStory}
                className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-[#354430] bg-[#141B12] px-2.5 text-xs font-medium text-[#E2E7E0] hover:border-[#84CC16] cursor-pointer"
              >
                <Pause className="h-3 w-3" />
                <span>{isDe ? 'Pause' : 'Wstrzymaj'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onStopStory}
              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-[#442222] bg-[#170C0C] px-2.5 text-xs font-medium text-[#FCA5A5] hover:bg-[#231010] cursor-pointer"
            >
              <Square className="h-3 w-3" />
              <span>{isDe ? 'Stopp' : 'Zakończ'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Inline Video/Screen Share Error */}
      {videoError && (
        <div className="flex shrink-0 items-start gap-2.5 rounded-xl border border-[#3B1D1D] bg-[#130A0A] px-3.5 py-2.5 text-xs text-[#FCA5A5]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" aria-hidden="true" />
          <span>{videoError}</span>
        </div>
      )}

      {/* Active Camera / Screen Share Live Preview */}
      {videoMode !== 'none' && (
        <div className="shrink-0 overflow-hidden rounded-xl border border-[#243021] bg-[#050605]">
          <div className="flex items-center justify-between border-b border-[#192017] px-3.5 py-1.5 text-xs">
            <span className="font-semibold text-[#84CC16]">{activeVideoLabel}</span>
            <span className="text-[11px] text-[#8C948A]">
              {isDe ? 'Live-Übertragung' : 'Obraz przesyłany na żywo'}
            </span>
          </div>
          <div className="relative flex max-h-48 w-full items-center justify-center bg-black">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className="max-h-48 w-full object-contain"
            />
          </div>
        </div>
      )}

      {/* External App Launch Fallback Notice */}
      {lastLaunchedApp && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2B3726] bg-[#0D130B] p-3 text-xs">
          <div>
            <span className="font-semibold text-[#84CC16]">
              {isDe ? 'Gestartet' : 'Uruchomiono'} ({lastLaunchedApp.appLabel}):
            </span>{' '}
            <span className="text-[#E2E7E0]">{lastLaunchedApp.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={lastLaunchedApp.fallbackUrl || lastLaunchedApp.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#84CC16] px-3 text-xs font-semibold text-[#050505] hover:bg-[#9BE12E]"
            >
              <span>
                {isDe ? 'Öffnen' : 'Otwórz'} {lastLaunchedApp.appLabel}
              </span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={onDismissLaunchedApp}
              className="min-h-[36px] rounded-lg border border-[#232B21] px-2.5 text-xs text-[#969F94] hover:text-white cursor-pointer"
            >
              {isDe ? 'Schließen' : 'Zamknij'}
            </button>
          </div>
        </div>
      )}

      {/* Active Alarms & Reminders */}
      {(alarms.length > 0 || reminders.length > 0) && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {alarms.map((alarm) => (
            <div
              key={alarm.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                alarm.triggered
                  ? 'border-[#84CC16] bg-[#162010] text-[#D9F99D]'
                  : 'border-[#20271F] bg-[#070907] text-[#D1D7D0]'
              }`}
            >
              <AlarmClock className="h-3.5 w-3.5 text-[#84CC16]" />
              <span className="font-mono-tabular font-semibold">{alarm.time}</span>
              <span>{alarm.label}</span>
              <button
                type="button"
                onClick={() => onRemoveAlarm(alarm.id)}
                aria-label="Usuń budzik"
                className="ml-1 text-[#7D857B] hover:text-[#FCA5A5] cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {reminders.map((rem) => (
            <div
              key={rem.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                rem.triggered
                  ? 'border-[#84CC16] bg-[#162010] text-[#D9F99D]'
                  : 'border-[#20271F] bg-[#070907] text-[#D1D7D0]'
              }`}
            >
              <Bell className="h-3.5 w-3.5 text-[#84CC16]" />
              <span className="font-mono-tabular font-semibold">{rem.displayTime}</span>
              <span>{rem.text}</span>
              <button
                type="button"
                onClick={() => onRemoveReminder(rem.id)}
                aria-label="Usuń powiadomienie"
                className="ml-1 text-[#7D857B] hover:text-[#FCA5A5] cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
