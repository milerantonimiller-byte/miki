import React, { useEffect, useState } from 'react';
import { Calculator, Delete, X } from 'lucide-react';
import { AssistantLanguage } from '../types';

interface CalculatorModalProps {
  isOpen: boolean;
  language: AssistantLanguage;
  initialExpression?: string;
  onClose: () => void;
}

export function evaluateMathExpression(raw: string): string {
  const sanitized = raw
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.')
    .replace(/[^0-9+\-*/().%\s]/g, '')
    .trim();

  if (!sanitized) return '';

  const normalized = sanitized.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');

  try {
    const tokens: string[] = [];
    let i = 0;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (ch === ' ') {
        i++;
        continue;
      }
      if ('+-*/()'.includes(ch)) {
        const prev = tokens[tokens.length - 1];
        if (
          ch === '-' &&
          (tokens.length === 0 || ['+', '-', '*', '/', '('].includes(prev))
        ) {
          let numStr = '-';
          i++;
          while (i < normalized.length && /[\d.]/.test(normalized[i])) {
            numStr += normalized[i++];
          }
          if (numStr !== '-') {
            tokens.push(numStr);
            continue;
          }
        }
        tokens.push(ch);
        i++;
      } else if (/[\d.]/.test(ch)) {
        let numStr = '';
        while (i < normalized.length && /[\d.]/.test(normalized[i])) {
          numStr += normalized[i++];
        }
        tokens.push(numStr);
      } else {
        i++;
      }
    }

    let pos = 0;
    const parseExpr = (): number => {
      let left = parseTerm();
      while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
        const op = tokens[pos++];
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };

    const parseTerm = (): number => {
      let left = parseFactor();
      while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
        const op = tokens[pos++];
        const right = parseFactor();
        left = op === '*' ? left * right : right === 0 ? NaN : left / right;
      }
      return left;
    };

    const parseFactor = (): number => {
      const tok = tokens[pos];
      if (tok === '(') {
        pos++;
        const val = parseExpr();
        if (tokens[pos] === ')') pos++;
        return val;
      }
      pos++;
      return Number(tok);
    };

    const res = parseExpr();
    if (!Number.isFinite(res)) return 'Błąd';
    const rounded = Math.round(res * 1e9) / 1e9;
    return String(rounded);
  } catch {
    return 'Błąd';
  }
}

export const CalculatorModal: React.FC<CalculatorModalProps> = ({
  isOpen,
  language,
  initialExpression,
  onClose,
}) => {
  const isDe = language === 'de';
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (initialExpression && initialExpression.trim()) {
      setExpression(initialExpression.trim());
      const computed = evaluateMathExpression(initialExpression.trim());
      setResult(computed);
    }
  }, [isOpen, initialExpression]);

  if (!isOpen) return null;

  const appendToken = (tok: string) => {
    setExpression((prev) => `${prev}${tok}`);
  };

  const handleEquals = () => {
    if (!expression.trim()) return;
    const computed = evaluateMathExpression(expression);
    setResult(computed);
  };

  const handleClear = () => {
    setExpression('');
    setResult('');
  };

  const handleBackspace = () => {
    setExpression((prev) => prev.slice(0, -1));
  };

  const buttons = [
    ['C', '(', ')', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '%', '='],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-[#1E232A] bg-[#0B0D10] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between border-b border-[#1E232A] pb-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Calculator className="h-4 w-4 text-[#4ADE80]" />
            <span>{isDe ? 'Taschenrechner' : 'Kalkulator'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isDe ? 'Rechner schließen' : 'Zamknij kalkulator'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#262D36] bg-[#12161B] text-[#9CA6B2] hover:border-[#3A4350] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-[#262D36] bg-[#12161B] p-3 text-right">
          <input
            type="text"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleEquals();
              }
            }}
            placeholder="0"
            className="w-full bg-transparent text-right font-mono-tabular text-base text-[#9CA6B2] placeholder-[#5B6470] focus:outline-none"
          />
          <div className="mt-1 min-h-[2rem] font-mono-tabular text-2xl font-bold text-[#4ADE80]">
            {result || '0'}
          </div>
        </div>

        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={handleBackspace}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262D36] bg-[#12161B] px-3 py-1.5 text-xs text-[#9CA6B2] hover:border-[#22C55E] hover:text-white cursor-pointer"
          >
            <Delete className="h-3.5 w-3.5" />
            <span>{isDe ? 'Löschen' : 'Cofnij'}</span>
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {buttons.flat().map((btn) => {
            const isEquals = btn === '=';
            const isClear = btn === 'C';
            const isOp = ['÷', '×', '-', '+', '%'].includes(btn);
            return (
              <button
                key={btn}
                type="button"
                onClick={() => {
                  if (isEquals) handleEquals();
                  else if (isClear) handleClear();
                  else appendToken(btn);
                }}
                className={`min-h-[46px] rounded-xl border text-base font-semibold transition-colors cursor-pointer ${
                  isEquals
                    ? 'border-[#22C55E] bg-[#22C55E] text-[#041409] hover:bg-[#16A34A]'
                    : isClear
                      ? 'border-[#5C1D22] bg-[#1F0B0D] text-[#FCA5A5] hover:border-[#EF4444]'
                      : isOp
                        ? 'border-[#1E5631] bg-[#0D2114] text-[#4ADE80] hover:border-[#22C55E]'
                        : 'border-[#262D36] bg-[#12161B] text-white hover:border-[#22C55E] hover:bg-[#171C22]'
                }`}
              >
                {btn}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
