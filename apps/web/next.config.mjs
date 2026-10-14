const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    // DEPRECATED alias: VerifyAPI is now Agent Gate. Live Stripe Payment Links
    // still return to /verify-api/welcome?plan=...&session_id=...; a permanent
    // redirect keeps those links, bookmarks and docs working. Query strings are
    // forwarded by Next.js, so plan and session_id reach the new route intact.
    return [
      { source: '/verify-api', destination: '/agent-gate', permanent: true },
      { source: '/verify-api/:path*', destination: '/agent-gate/:path*', permanent: true },
    ];
  },
};
export default nextConfig;
