export const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_CHAIN_VERIFY_API_BASE?.replace(/\/$/, '') ??
  'https://chain-verify-api.onrender.com';
