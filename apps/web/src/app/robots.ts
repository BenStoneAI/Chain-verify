export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: 'https://chainverify.org/sitemap.xml',
    host: 'https://chainverify.org',
  };
}
