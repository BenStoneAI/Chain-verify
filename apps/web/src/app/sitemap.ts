export default function sitemap() {
  return [
    { url: 'https://chainverify.org/', changeFrequency: 'weekly', priority: 1 },
    { url: 'https://chainverify.org/verify-api', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://chainverify.org/audit-proof', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://chainverify.org/invoice-proof', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://chainverify.org/contact', changeFrequency: 'monthly', priority: 0.6 },
    { url: 'https://chainverify.org/security', changeFrequency: 'monthly', priority: 0.5 },
    { url: 'https://chainverify.org/privacy', changeFrequency: 'monthly', priority: 0.4 },
  ];
}
