import React, { useState } from 'react';
import {
  AlarmClock,
  AlertCircle,
  Bell,
  Calculator,
  Camera,
  ExternalLink,
  Globe,
  MessageCircle,
  MonitorUp,
  NotebookPen,
  Plus,
  SwitchCamera,
  Trash2,
  VideoOff,
  Wrench,
  Youtube,
} from 'lucide-react';
import {
  AlarmItem,
  AssistantLanguage,
  CameraFacingMode,
  ExternalAppLaunch,
  LiveVideoMode,
  ReminderItem,
} from '../types';

interface ToolsTabProps {
  language: AssistantLanguage;
  videoMode: LiveVideoMode;
  cameraFacingMode: CameraFacingMode;
  videoError: string | null;
  videoPreviewRef: React.RefObject<HTMLVideoElement | null>;
  onToggleCamera: () => void;
  onSwitchCameraFacing: () => void;
  onToggleScreenShare: () => void;
  onStopVideo: () => void;
  alarms: AlarmItem[];
  reminders: ReminderItem[];
  onAddAlarm: (time: string, label: string) => void;
  onRemoveAlarm: (id: string) => void;
  onAddReminder: (minutes: number, text: string) => void;
  onRemoveReminder: (id: string) => void;
  lastLaunchedApp: ExternalAppLaunch | null;
  onDismissLaunchedApp: () => void;
  onOpenCalculator: () => void;
  onOpenNotepad: () => void;
  onOpenYoutube: () => void;
  onOpenWhatsapp: () => void;
  onOpenBrowser?: () => void;
  notesCount: number;
}

export const ToolsTab: React.FC<ToolsTabProps> = ({
  language,
  videoMode,
  cameraFacingMode,
  videoError,
  videoPreviewRef,
  onToggleCamera,
  onSwitchCameraFacing,
  onToggleScreenShare,
  onStopVideo,
  alarms,
  reminders,
  onAddAlarm,
  onRemoveAlarm,
  onAddReminder,
  onRemoveReminder,
  lastLaunchedApp,
  onDismissLaunchedApp,
  onOpenCalculator,
  onOpenNotepad,
  onOpenYoutube,
  onOpenWhatsapp,
  onOpenBrowser,
  notesCount,
}) => {
  const isDe = language === 'de';
  const [alarmTime, setAlarmTime] = useState('07:00');
  const [alarmLabel, setAlarmLabel] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState('15');
  const [reminderText, setReminderText] = useState('');

  const handleAlarmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!alarmTime) return;
    onAddAlarm(alarmTime, alarmLabel.trim() || (isDe ? 'Wecker' : 'Budzik'));
    setAlarmLabel('');
  };

  const handleReminderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Math.max(1, Number.parseInt(reminderMinutes, 10) || 15);
    if (!reminderText.trim()) return;
    onAddReminder(mins, reminderText.trim());
    setReminderText('');
  };

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

  return (
    <div className="space-y-5">
      {/* Header card */}
      <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#0F1520] to-[#0A0E16] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2.5">
          <Wrench className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
          <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
            {isDe ? 'Werkzeuge & Anwendungen' : 'Narzędzia i aplikacje'}
          </h1>
        </div>
        <p className="mt-1 text-xs text-[#94A3B8]">
          {isDe
            ? 'Kamera, Bildschirmfreigabe, YouTube, WhatsApp, Rechner, Notizen und Wecker.'
            : 'Kamera, udostępnianie ekranu, YouTube, WhatsApp, kalkulator, notatnik oraz budziki i przypomnienia.'}
        </p>
      </section>

      {/* Main 2-column tools grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Card 1: Applications */}
        <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-white">
            {isDe ? 'Anwendungen' : 'Aplikacje i komunikacja'}
          </h2>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onOpenYoutube}
              className="flex min-h-[52px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:border-[#EF4444]/60 hover:bg-[#172030] cursor-pointer"
            >
              <Youtube className="h-4 w-4 shrink-0 text-[#F87171]" aria-hidden="true" />
              <span>YouTube</span>
            </button>

            <button
              type="button"
              onClick={onOpenWhatsapp}
              className="flex min-h-[52px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:border-[#22C55E]/60 hover:bg-[#172030] cursor-pointer"
            >
              <MessageCircle className="h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
              <span>WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={onOpenCalculator}
              className="flex min-h-[52px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:border-[#22C55E]/60 hover:bg-[#172030] cursor-pointer"
            >
              <Calculator className="h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
              <span>{isDe ? 'Rechner' : 'Kalkulator'}</span>
            </button>

            <button
              type="button"
              onClick={onOpenNotepad}
              className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:border-[#22C55E]/60 hover:bg-[#172030] cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <NotebookPen className="h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
                <span>{isDe ? 'Notizen' : 'Notatnik'}</span>
              </span>
              {notesCount > 0 && (
                <span className="font-mono-tabular text-[11px] font-bold text-[#4ADE80]">
                  {notesCount}
                </span>
              )}
            </button>

            {onOpenBrowser && (
              <button
                type="button"
                onClick={onOpenBrowser}
                className="col-span-2 flex min-h-[50px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 py-2.5 text-left text-xs font-semibold text-white transition-colors hover:border-[#22C55E]/60 hover:bg-[#172030] cursor-pointer"
              >
                <Globe className="h-4 w-4 shrink-0 text-[#4ADE80]" aria-hidden="true" />
                <span>{isDe ? 'Browser' : 'Przeglądarka'}</span>
              </button>
            )}
          </div>
        </section>

        {/* Card 2: Camera & Screen Share */}
        <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-white">
            {isDe ? 'Kamera & Bildschirm' : 'Kamera i ekran'}
          </h2>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleCamera}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                videoMode === 'camera'
                  ? 'border-[#22C55E] bg-[#081A10] text-[#4ADE80]'
                  : 'border-white/[0.08] bg-[#111723] text-[#E2E8F0] hover:border-[#22C55E]'
              }`}
            >
              <Camera className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#111723] px-3.5 text-xs font-semibold text-[#E2E8F0] transition-colors hover:border-[#22C55E] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SwitchCamera className="h-3.5 w-3.5 text-[#4ADE80]" aria-hidden="true" />
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
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                videoMode === 'screen'
                  ? 'border-[#38BDF8] bg-[#082032] text-[#7DD3FC]'
                  : 'border-white/[0.08] bg-[#111723] text-[#E2E8F0] hover:border-[#38BDF8]'
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
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#EF4444]/40 bg-[#26090A] px-3.5 text-xs font-medium text-[#FCA5A5] hover:bg-[#380E10] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isDe ? 'Bild aus' : 'Wyłącz obraz'}</span>
              </button>
            )}
          </div>

          {videoError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#EF4444]/40 bg-[#26090A] px-3.5 py-2.5 text-xs text-[#FCA5A5]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#F87171]" aria-hidden="true" />
              <span>{videoError}</span>
            </div>
          )}

          {videoMode !== 'none' && (
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2 text-xs">
                <span className="font-semibold text-[#4ADE80]">{activeVideoLabel}</span>
                <span className="text-[11px] text-[#94A3B8]">
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
        </section>
      </div>

      {/* External App Launch Notice */}
      {lastLaunchedApp && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#22C55E]/30 bg-[#081A10] p-4 text-xs">
          <div>
            <span className="font-semibold text-[#4ADE80]">
              {isDe ? 'Gestartet' : 'Uruchomiono'} ({lastLaunchedApp.appLabel}):
            </span>{' '}
            <span className="text-[#E2E8F0]">{lastLaunchedApp.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={lastLaunchedApp.fallbackUrl || lastLaunchedApp.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80]"
            >
              <span>
                {isDe ? 'Öffnen' : 'Otwórz'} {lastLaunchedApp.appLabel}
              </span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={onDismissLaunchedApp}
              className="min-h-[38px] rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs text-[#94A3B8] hover:text-white cursor-pointer"
            >
              {isDe ? 'Schließen' : 'Zamknij'}
            </button>
          </div>
        </div>
      )}

      {/* Alarms & Reminders Section */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Alarms */}
        <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 space-y-3.5">
          <div className="flex items-center gap-2">
            <AlarmClock className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-white">
              {isDe ? 'Wecker' : 'Budziki'}
            </h2>
          </div>

          <form onSubmit={handleAlarmSubmit} className="flex flex-wrap gap-2">
            <input
              type="time"
              value={alarmTime}
              onChange={(e) => setAlarmTime(e.target.value)}
              aria-label={isDe ? 'Uhrzeit' : 'Godzina budzika'}
              className="min-h-[42px] rounded-xl border border-white/[0.08] bg-[#111723] px-3 font-mono-tabular text-xs text-white focus:border-[#22C55E] focus:outline-none [color-scheme:dark]"
            />
            <input
              type="text"
              value={alarmLabel}
              onChange={(e) => setAlarmLabel(e.target.value)}
              placeholder={isDe ? 'Bezeichnung...' : 'Opis budzika...'}
              className="min-h-[42px] flex-1 min-w-[130px] rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs text-white placeholder-[#64748B] focus:border-[#22C55E] focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3.5 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isDe ? 'Hinzufügen' : 'Dodaj'}</span>
            </button>
          </form>

          {alarms.length > 0 ? (
            <div className="space-y-2">
              {alarms.map((alarm) => (
                <div
                  key={alarm.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                    alarm.triggered
                      ? 'border-[#22C55E]/60 bg-[#081A10] text-[#86EFAC]'
                      : 'border-white/[0.07] bg-[#111723] text-[#E2E8F0]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlarmClock className="h-3.5 w-3.5 shrink-0 text-[#4ADE80]" />
                    <span className="font-mono-tabular font-semibold">{alarm.time}</span>
                    <span className="truncate">{alarm.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveAlarm(alarm.id)}
                    aria-label="Usuń budzik"
                    className="p-1 text-[#94A3B8] hover:text-[#F87171] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#64748B]">
              {isDe
                ? 'Keine aktiven Wecker.'
                : 'Brak ustawionych budzików.'}
            </p>
          )}
        </section>

        {/* Reminders */}
        <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#0E141F] to-[#0A0E16] p-5 space-y-3.5">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#4ADE80]" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-white">
              {isDe ? 'Erinnerungen' : 'Przypomnienia'}
            </h2>
          </div>

          <form onSubmit={handleReminderSubmit} className="flex flex-wrap gap-2">
            <div className="flex items-center rounded-xl border border-white/[0.08] bg-[#111723] px-3">
              <input
                type="number"
                min={1}
                max={1440}
                value={reminderMinutes}
                onChange={(e) => setReminderMinutes(e.target.value)}
                aria-label={isDe ? 'Minuten' : 'Za ile minut'}
                className="min-h-[40px] w-12 bg-transparent font-mono-tabular text-xs text-white focus:outline-none"
              />
              <span className="text-[11px] text-[#94A3B8]">min</span>
            </div>
            <input
              type="text"
              value={reminderText}
              onChange={(e) => setReminderText(e.target.value)}
              placeholder={isDe ? 'Erinnerungstext...' : 'Treść przypomnienia...'}
              className="min-h-[42px] flex-1 min-w-[140px] rounded-xl border border-white/[0.08] bg-[#111723] px-3 text-xs text-white placeholder-[#64748B] focus:border-[#22C55E] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!reminderText.trim()}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#22C55E] px-3.5 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] disabled:opacity-40 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isDe ? 'Merken' : 'Ustaw'}</span>
            </button>
          </form>

          {reminders.length > 0 ? (
            <div className="space-y-2">
              {reminders.map((rem) => (
                <div
                  key={rem.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                    rem.triggered
                      ? 'border-[#22C55E]/60 bg-[#081A10] text-[#86EFAC]'
                      : 'border-white/[0.07] bg-[#111723] text-[#E2E8F0]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Bell className="h-3.5 w-3.5 shrink-0 text-[#4ADE80]" />
                    <span className="font-mono-tabular font-semibold">{rem.displayTime}</span>
                    <span className="truncate">{rem.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveReminder(rem.id)}
                    aria-label="Usuń powiadomienie"
                    className="p-1 text-[#94A3B8] hover:text-[#F87171] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#64748B]">
              {isDe
                ? 'Keine aktiven Erinnerungen.'
                : 'Brak ustawionych przypomnień.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
};
