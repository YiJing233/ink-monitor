import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Ink Monitor — E-ink dashboard for token plans & stocks',
  description:
    'A B&W monitoring dashboard tuned for Kindle and Xiaomi e-readers. Tracks your token-plan usage and a stock watchlist on a screen that barely uses power.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
