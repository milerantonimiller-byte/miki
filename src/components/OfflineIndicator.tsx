import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-[#F59E0B]/40 bg-[#1A1405] px-3.5 py-2 text-xs font-medium text-[#FCD34D] shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 text-[#FBBF24]" aria-hidden="true" />
      <span>Tryb offline — brak połączenia z internetem</span>
    </div>
  );
};
