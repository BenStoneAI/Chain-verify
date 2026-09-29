export function ChainVerifyMark({ className = '' }: { className?: string }) {
  return (
    <img
      src="/chainverify-symbol.png"
      alt="ChainVerify"
      className={className}
      width={36}
      height={36}
      style={{ display: 'inline-block', verticalAlign: 'middle', objectFit: 'contain' }}
    />
  );
}
