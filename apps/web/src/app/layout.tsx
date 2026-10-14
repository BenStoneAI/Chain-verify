import type { Metadata } from 'next';
import './site.css';
import './product-marketing.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://chainverify.org'),
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/chainverify-icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  description: 'Independent verification for AI outputs, software delivery, agent activity, and invoice risk — with structured proof records you can review and export.',
  alternates: { canonical: '/' },
  keywords: ['AI verification API','AI audit trail','software delivery verification','invoice fraud detection','AI governance evidence','agent audit trail'],
  openGraph: {
    title: 'ChainVerify — Independent Proof for AI Work',
    description: 'Verify AI output, software delivery, agent activity, and invoice risk before people rely on it.',
    url: 'https://chainverify.org',
    siteName: 'ChainVerify',
    type: 'website',
    images: [{ url: '/assets/og-social-banner.png', width: 1024, height: 576, alt: 'ChainVerify — Independent Proof for AI Work' }]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ChainVerify — Independent Proof for AI Work',
    description: 'Independent proof for AI work.',
    images: ['/assets/og-social-banner.png']
  },
  robots: { index: true, follow: true }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
