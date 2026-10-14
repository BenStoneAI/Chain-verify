'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CopyButtonProps {
  /** Text placed on the clipboard when clicked. Never logged or stored by this component. */
  text: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyButton({ text, label, copiedLabel = 'Copied', className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    let next: CopyState = 'copied';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'failed';
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 4000);
  }, [text]);

  return (
    <>
      <button type="button" className={className ?? 'pm-btn pm-btn-secondary'} onClick={copy}>
        {state === 'copied' ? copiedLabel : label}
      </button>
      <span className="ag-sr-only" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard.' : ''}
      </span>
      {state === 'failed' ? (
        <span className="ag-note ag-warn" role="alert">
          Copy failed. Select the text and copy it manually.
        </span>
      ) : null}
    </>
  );
}

export default CopyButton;
