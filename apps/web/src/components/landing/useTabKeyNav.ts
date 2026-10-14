'use client';

import { useCallback, type KeyboardEvent } from 'react';

/**
 * Arrow/Home/End keyboard navigation for a WAI-ARIA tablist with automatic
 * activation. Tab buttons must have the id `${idPrefix}-tab-${index}`.
 */
export function useTabKeyNav(count: number, select: (index: number) => void, idPrefix: string) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number) => {
      let next: number;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (index + 1) % count;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (index - 1 + count) % count;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      select(next);
      document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
    },
    [count, select, idPrefix],
  );
}
