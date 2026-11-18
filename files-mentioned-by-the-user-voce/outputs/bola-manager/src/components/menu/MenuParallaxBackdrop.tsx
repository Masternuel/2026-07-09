import { useEffect, useRef } from 'react';

const PARTICLES = Array.from({ length: 14 }, (_, index) => ({
  left: `${8 + (index * 67) % 88}%`,
  top: `${40 + (index * 37) % 58}%`,
  animationDelay: `${-(index * 0.7).toFixed(1)}s`,
}));

/**
 * Main-menu scenery: stadium, floodlight glow, drifting particles and the player cut-out move
 * at different depths with the pointer (CSS variables --mx/--my, one rAF per frame, no React
 * re-render). Decorative only; disabled when the system asks for reduced motion.
 */
export function MenuParallaxBackdrop({ showPlayer }: { showPlayer: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      node.style.setProperty('--mx', x.toFixed(3));
      node.style.setProperty('--my', y.toFixed(3));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
    const onMove = (event: PointerEvent) => {
      x = event.clientX / Math.max(1, window.innerWidth) - 0.5;
      y = event.clientY / Math.max(1, window.innerHeight) - 0.5;
      schedule();
    };
    const reset = () => { x = 0; y = 0; schedule(); };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', reset);
    document.documentElement.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', reset);
      document.documentElement.removeEventListener('pointerleave', reset);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={`menu-parallax${showPlayer ? ' menu-parallax--home' : ''}`} aria-hidden="true">
      <div className="menu-parallax__layer menu-parallax__stadium"><div className="menu-parallax__stadium-image" /></div>
      <div className="menu-parallax__layer menu-parallax__lights" />
      <div className="menu-parallax__layer menu-parallax__particles">
        {PARTICLES.map((style, index) => <span key={index} style={style} />)}
      </div>
      {showPlayer && <div className="menu-parallax__layer menu-parallax__player"><img src="/assets/menu/player.webp" alt="" decoding="async" /></div>}
      <div className="menu-parallax__shade" />
      <div className="menu-parallax__streak" />
    </div>
  );
}
