import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bola-manager:menu-motion';
const CHANGE_EVENT = 'bola-manager:menu-motion-change';

/** On unless the player turned it off in Configurações (older "on"/"auto" values count as on). */
function readEnabled(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

/**
 * Menu scenery motion. Starts on, whatever the Windows "Animation effects" setting says;
 * the only switch is in Configurações › Interface and the choice persists on this computer.
 */
export function useMenuMotion() {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    setEnabledState(readEnabled());
    // The switch lives in Configurações; the menu backdrop listens so it follows at once.
    const onChange = () => setEnabledState(readEnabled());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      if (next) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, 'off');
    } catch { /* preference is only a convenience */ }
    try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch { /* no window */ }
  }, []);

  return { enabled, setEnabled };
}
