'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const SpatialProofHorizon = dynamic(
  () => import('@/components/proof/SpatialProofHorizon').then((mod) => mod.SpatialProofHorizon),
  { ssr: false },
);

const WIDE_QUERY = '(min-width: 768px)';
const MOTION_QUERY = '(prefers-reduced-motion: no-preference)';

/**
 * Mounts the WebGL engine only on viewports >= 768px for visitors who have not
 * asked for reduced motion. Everywhere else (and until the check runs) nothing
 * loads, so the static pipeline image above is the experience. The Three.js
 * bundle is code-split and is unmounted if either condition stops holding.
 */
export function LiveEngineGate() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia(WIDE_QUERY);
    const motion = window.matchMedia(MOTION_QUERY);
    const update = () => setEnabled(wide.matches && motion.matches);

    update();
    wide.addEventListener('change', update);
    motion.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      motion.removeEventListener('change', update);
    };
  }, []);

  return enabled ? <SpatialProofHorizon /> : null;
}
