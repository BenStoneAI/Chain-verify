'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('cv-theme');
    const nextLight = stored === 'light';
    setLight(nextLight);
    document.documentElement.dataset.theme = nextLight ? 'light' : 'dark';
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? 'light' : 'dark';
    window.localStorage.setItem('cv-theme', next ? 'light' : 'dark');
  }

  return (
    <button className="cv-theme-toggle" type="button" onClick={toggle} aria-label="Toggle color theme" aria-pressed={light}>
      <span className="cv-theme-sun" aria-hidden="true">☀</span>
      <span className="cv-theme-moon" aria-hidden="true">◐</span>
      <i className={light ? 'is-light' : ''} aria-hidden="true" />
    </button>
  );
}
