import React from 'react';
import type { OcrStatus } from '../types/electron';

interface StatusBarProps {
  status: OcrStatus;
}

const STATUS_CONFIG: Record<OcrStatus['status'], { dot: string; text: string }> = {
  ok: {
    dot: 'bg-emerald-400',
    text: 'text-dark-400',
  },
  loading: {
    dot: 'bg-amber-400 animate-pulse',
    text: 'text-amber-400',
  },
  error: {
    dot: 'bg-red-400',
    text: 'text-red-400',
  },
  stopped: {
    dot: 'bg-dark-600',
    text: 'text-dark-500',
  },
};

export function StatusBar({ status }: StatusBarProps) {
  const config = STATUS_CONFIG[status.status];

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
      <span className={`truncate ${config.text}`}>{status.message}</span>
    </div>
  );
}
