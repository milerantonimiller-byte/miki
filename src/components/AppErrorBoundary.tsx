import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Nieoczekiwany błąd renderowania.',
    };
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-[#05070B] p-6 text-[#F1F5F9]">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0B1018] p-6 text-center space-y-4 shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#EF4444]/40 bg-[#26090A]">
              <AlertTriangle className="h-6 w-6 text-[#F87171]" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-bold text-white">
                Wystąpił problem z uruchomieniem
              </h1>
              <p className="text-xs leading-relaxed text-[#94A3B8]">
                {this.state.errorMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#22C55E] px-4 text-xs font-semibold text-[#041409] hover:bg-[#4ADE80] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Odśwież aplikację</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
