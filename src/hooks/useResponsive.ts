import { useState, useEffect } from 'react';

export type LayoutMode = 'compact' | 'standard' | 'wide';

/**
 * Detects window width and returns the current layout mode:
 *   compact  — < 768px  (single column)
 *   standard — 768–1279px (two columns)
 *   wide     — >= 1280px  (three columns)
 */
export function useResponsive(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => {
    if (typeof window === 'undefined') return 'standard';
    const w = window.innerWidth;
    if (w < 768) return 'compact';
    if (w < 1280) return 'standard';
    return 'wide';
  });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 768) setMode('compact');
      else if (w < 1280) setMode('standard');
      else setMode('wide');
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return mode;
}
