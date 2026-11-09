import { useEffect, useRef, useState } from 'react';
import { Music2, X } from 'lucide-react';
import { useMusic } from '../../audio/MusicProvider';
import { ResilientImage } from '../shared/ResilientImage';

const EXIT_DURATION_MS = 220;

export function MusicNotification() {
  const { notice, status, preferences, dismissNotice } = useMusic();
  const [displayedNotice, setDisplayedNotice] = useState(notice);
  const [leaving, setLeaving] = useState(false);
  const popup = useRef<HTMLElement>(null);
  const hasNotice = displayedNotice !== null;

  useEffect(() => {
    if (notice) {
      setDisplayedNotice(notice);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timeout = window.setTimeout(() => setDisplayedNotice(null), EXIT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const element = popup.current;
    const layout = element?.closest<HTMLElement>('.app-with-music-popup');
    if (!element || !layout) return;
    const observed = new Set<HTMLElement>();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);

    function measure() {
      if (!element || !layout) return;
      const blockers = [...layout.querySelectorAll<HTMLElement>('.toast, .bottom-bar')];
      observed.forEach((blocker) => {
        if (!blockers.includes(blocker)) {
          observer?.unobserve(blocker);
          observed.delete(blocker);
        }
      });
      let clearance = 22;
      blockers.forEach((blocker) => {
        if (!observed.has(blocker)) {
          observer?.observe(blocker);
          observed.add(blocker);
        }
        const style = window.getComputedStyle(blocker);
        const rect = blocker.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height) return;
        const bottom = Number.parseFloat(style.bottom);
        clearance = Math.max(clearance, Number.isFinite(bottom) ? bottom + rect.height + 12 : window.innerHeight - rect.top + 12);
      });
      element.style.setProperty('--music-notice-clearance', `${Math.ceil(clearance)}px`);
    }

    measure();
    const mutations = new MutationObserver(measure);
    mutations.observe(layout, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [hasNotice]);

  if (!displayedNotice) return null;
  const { track } = displayedNotice;
  const playing = status === 'playing' && preferences.musicEnabled;

  return (
    <aside ref={popup} className={`music-notification${leaving ? ' is-leaving' : ''}`} aria-label="Música atual" role="status" aria-live="polite" aria-atomic="true">
      <span className="music-notification__cover" aria-hidden="true">
        <ResilientImage src={track.cover} alt="" fallback={<Music2 size={21} />} />
      </span>
      <div className="music-notification__copy">
        <p className="music-notification__label">
          <span className={`music-equalizer${playing ? ' is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span>
          {playing ? 'TOCANDO AGORA' : 'MÚSICA ATUAL'}
        </p>
        <strong title={track.title}>{track.title}</strong>
        <span title={track.artist}>{track.artist}</span>
      </div>
      <button type="button" aria-label="Fechar aviso de música" title="Fechar aviso de música" onClick={dismissNotice} disabled={leaving}>
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
