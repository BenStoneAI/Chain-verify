import type { Metadata } from 'next';
import './site.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://chainverify.org'),
  applicationName: 'ChainVerify',
  icons: { icon: '/chainverify-icon.svg', shortcut: '/chainverify-icon.svg', apple: '/chainverify-icon.svg' },
  title: { default: 'ChainVerify — Independent Proof for AI Work', template: '%s | ChainVerify' },
  description: 'Independent verification for AI outputs, software delivery, agent activity, and invoice risk — with structured proof records you can review and export.',
  alternates: { canonical: '/' },
  keywords: ['AI verification API','AI audit trail','software delivery verification','invoice fraud detection','AI governance evidence','agent audit trail'],
  openGraph: {
    title: 'ChainVerify — Independent Proof for AI Work',
    description: 'Verify AI output, software delivery, agent activity, and invoice risk before people rely on it.',
    url: 'https://chainverify.org',
    siteName: 'ChainVerify',
    type: 'website'
  },
  twitter: { card: 'summary_large_image', title: 'ChainVerify', description: 'Independent proof for AI work.' },
  robots: { index: true, follow: true }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
