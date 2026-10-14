import type { ReactNode } from 'react';

interface SectionHeaderProps {
  badge: string;
  title: string;
  titleId: string;
  children?: ReactNode;
}

export function SectionHeader({ badge, title, titleId, children }: SectionHeaderProps) {
  return (
    <div className="lp-section-head">
      <div className="lp-mono-badge"><i aria-hidden="true" />{badge}</div>
      <h2 id={titleId}>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
