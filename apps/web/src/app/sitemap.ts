export default function sitemap() {
  return [
    { url: 'https://chainverify.org/', changeFrequency: 'weekly', priority: 1 },
    { url: 'https://chainverify.org/verify-api', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://chainverify.org/audit-proof', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://chainverify.org/invoice-proof', changeFrequency: 'weekly', priority: 0.9 },
  ];
}
