'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import './agent-gate-welcome.css';

export interface StateHeaderProps {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
}

/** Heading block for every welcome state. Receives focus on mount so screen readers announce the new state. */
export function StateHeader({ eyebrow, title, lead }: StateHeaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <header>
      <div className="pm-eyebrow">{eyebrow}</div>
      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      {lead ? <p className="ag-lead">{lead}</p> : null}
    </header>
  );
}

export default StateHeader;
