export function ChainVerifyMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 44 44"
      role="img"
      aria-label="ChainVerify"
    >
      <defs>
        <linearGradient id="cv-mark-a" x1="5" y1="4" x2="38" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A855F7" />
          <stop offset=".48" stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <linearGradient id="cv-mark-b" x1="36" y1="5" x2="8" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFB45C" />
          <stop offset=".58" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <path d="M22 2.8 38.8 12.5v19L22 41.2 5.2 31.5v-19L22 2.8Z" fill="#0B0E14" stroke="rgba(255,255,255,.18)" />
      <path d="M22 5.8 34.8 13.2 22 20.6 9.2 13.2 22 5.8Z" fill="url(#cv-mark-a)" />
      <path d="M9.2 14.9 20.6 21.5v14.8L9.2 29.7V14.9Z" fill="url(#cv-mark-b)" />
      <path d="M34.8 14.9 23.4 21.5v14.8l11.4-6.6V14.9Z" fill="url(#cv-mark-a)" />
      <path d="m16.3 22.3 3.8 3.8 7.8-8" fill="none" stroke="#F8FAFC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
