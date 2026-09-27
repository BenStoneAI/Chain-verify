'use client';

import { useEffect } from 'react';

export function AmbientMotion() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;

    const onPointerMove = (event: PointerEvent) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--mx', `${(event.clientX / window.innerWidth) * 100}%`);
        root.style.setProperty('--my', `${(event.clientY / window.innerHeight) * 100}%`);
      });
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return <div className="scroll-progress" aria-hidden="true" />;
}
