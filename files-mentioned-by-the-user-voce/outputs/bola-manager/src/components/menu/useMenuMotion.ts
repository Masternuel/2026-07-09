import { useCallback, useEffect, useState } from 'react';

export type MenuMotionMode = 'auto' | 'on' | 'off';
const STORAGE_KEY = 'bola-manager:menu-motion';

function readMode(): MenuMotionMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'on' || value === 'off' ? value : 'auto';
  } catch { return 'auto'; }
}

function systemPrefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Menu scenery motion. "auto" follows the OS (Windows "Animation effects" off = reduced motion);
 * the player can force it on or off, and the choice persists on this computer.
 */
export function useMenuMotion() {
  const [mode, setModeState] = useState<MenuMotionMode>('auto');
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    setModeState(readMode());
    setSystemReduced(systemPrefersReducedMotion());
    let query: MediaQueryList | null = null;
    try { query = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return undefined; }
    const onChange = () => setSystemReduced(query?.matches ?? false);
    query.addEventListener?.('change', onChange);
    return () => query?.removeEventListener?.('change', onChange);
  }, []);

  const enabled = mode === 'on' || (mode === 'auto' && !systemReduced);
  const setEnabled = useCallback((next: boolean) => {
    // Matching the OS again returns to "auto", so a later Windows change is still honoured.
    const nextMode: MenuMotionMode = next === !systemReduced ? 'auto' : next ? 'on' : 'off';
    setModeState(nextMode);
    try {
      if (nextMode === 'auto') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, nextMode);
    } catch { /* preference is only a convenience */ }
  }, [systemReduced]);

  return { enabled, mode, systemReduced, setEnabled };
}
