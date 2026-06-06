import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ConsentBanner } from './consent-banner';

export const metadata: Metadata = {
  title: 'Ink Monitor — E-ink dashboard for token plans & stocks',
  description:
    'A B&W monitoring dashboard tuned for Kindle and Xiaomi e-readers. Tracks your token-plan usage and a stock watchlist on a screen that barely uses power.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Ink Monitor — your e-reader is a dashboard',
    description: 'B&W monitoring for AI token plans and stock watchlists, tuned for Kindle.',
    images: ['/og.svg'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og.svg'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <ConsentBanner />
        </Providers>
      </body>
    </html>
  );
}
