'use client';

import { signIn, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LocaleSwitcher } from './locale-switcher';
import { t, type Locale } from '@/lib/i18n';

export default function LandingPage({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">⬛ Ink Monitor</div>
        <nav className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#how">How</a>
          <a href="#deploy">Deploy</a>
          <a href="#cli">CLI</a>
          <a href="https://github.com" rel="noreferrer">GitHub</a>
          <LocaleSwitcher current={locale} />
          {status === 'authenticated' ? (
            <button className="btn" onClick={() => router.push('/admin')}>Open dashboard</button>
          ) : (
            <button className="btn primary" onClick={() => signIn()}>Sign in</button>
          )}
        </nav>
      </header>

      <section className="hero">
        <h1>{t(locale, 'tagline')}</h1>
        <p className="lede">{t(locale, 'lede')}</p>
        <div className="hero-cta">
          {status === 'authenticated' ? (
            <button className="btn primary big" onClick={() => router.push('/admin')}>
              {t(locale, 'cta.open')}
            </button>
          ) : (
            <button className="btn primary big" onClick={() => signIn('github')}>
              ⌥  {t(locale, 'cta.signin')}
            </button>
          )}
          <Link className="btn big" href="/display" target="_blank">
            {t(locale, 'cta.demo')} ↗
          </Link>
        </div>
        <div className="hero-meta">{t(locale, 'meta.free')}</div>
      </section>

      <section className="mockup" id="features">
        <div className="device">
          <div className="device-screen">
            <div className="eink-mock">
              <div className="eink-mock-h1">Monitor</div>
              <div className="eink-mock-sub">Updated 14:58:19 · refresh 60s</div>

              <div className="eink-mock-section">
                <div className="eink-mock-sh">
                  <span>Token plans</span><span className="eink-mock-badge solid">2</span>
                </div>
                <div className="eink-mock-grid">
                  <div className="eink-mock-card">
                    <div className="eink-mock-sh"><span>Demo plan</span><span className="eink-mock-badge solid">OK</span></div>
                    <div className="eink-mock-row"><span>Tokens (5h)</span><span className="eink-mock-num">412,304 / 1,000,000</span></div>
                    <div className="eink-mock-bar"><div style={{ width: '41%' }}></div><div className="eink-mock-bar-lbl">41%</div></div>
                    <div className="eink-mock-row"><span>Requests (5h)</span><span className="eink-mock-num">87 / 500</span></div>
                    <div className="eink-mock-bar"><div style={{ width: '17%' }}></div><div className="eink-mock-bar-lbl">17%</div></div>
                  </div>
                  <div className="eink-mock-card">
                    <div className="eink-mock-sh"><span>OpenAI</span><span className="eink-mock-badge solid">OK</span></div>
                    <div className="eink-mock-row"><span>Tokens (24h)</span><span className="eink-mock-num">128,991</span></div>
                    <div className="eink-mock-row"><span>Requests (24h)</span><span className="eink-mock-num">421</span></div>
                  </div>
                </div>
              </div>

              <div className="eink-mock-section">
                <div className="eink-mock-sh"><span>Stocks</span><span className="eink-mock-badge">7</span></div>
                <table className="eink-mock-tbl">
                  <thead><tr><th>Symbol</th><th>Trend</th><th className="num">Price</th><th className="num">%</th></tr></thead>
                  <tbody>
                    <tr><td>AAPL</td><td><SparkUp /></td><td className="num">307.34</td><td className="num">-1.25%</td></tr>
                    <tr><td>MSFT</td><td><SparkDown /></td><td className="num">416.67</td><td className="num">-2.66%</td></tr>
                    <tr><td>00700</td><td><SparkUp /></td><td className="num">453.20</td><td className="num">-1.26%</td></tr>
                    <tr><td>600519</td><td><SparkUp /></td><td className="num">1,272.86</td><td className="num">+0.38%</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="device-foot">Kindle · 300 ppi · 16 grayscale</div>
        </div>
      </section>

      <section className="features" id="how">
        <h2>{t(locale, 'features.h')}</h2>
        <div className="feature-grid">
          <div className="feature">
            <div className="feature-num">01</div>
            <h3>{t(locale, 'features.01.h')}</h3>
            <p>{t(locale, 'features.01.p')}</p>
          </div>
          <div className="feature">
            <div className="feature-num">02</div>
            <h3>{t(locale, 'features.02.h')}</h3>
            <p>{t(locale, 'features.02.p')}</p>
          </div>
          <div className="feature">
            <div className="feature-num">03</div>
            <h3>{t(locale, 'features.03.h')}</h3>
            <p>{t(locale, 'features.03.p')}</p>
          </div>
          <div className="feature">
            <div className="feature-num">04</div>
            <h3>{t(locale, 'features.04.h')}</h3>
            <p>{t(locale, 'features.04.p')}</p>
          </div>
        </div>
      </section>

      <section className="privacy">
        <h2>{t(locale, 'privacy.h')}</h2>
        <div className="privacy-grid">
          <div>
            <h4>{t(locale, 'privacy.1.h')}</h4>
            <p>{t(locale, 'privacy.1.p')}</p>
          </div>
          <div>
            <h4>{t(locale, 'privacy.2.h')}</h4>
            <p>{t(locale, 'privacy.2.p')}</p>
          </div>
          <div>
            <h4>{t(locale, 'privacy.3.h')}</h4>
            <p>{t(locale, 'privacy.3.p')}</p>
          </div>
          <div>
            <h4>{t(locale, 'privacy.4.h')}</h4>
            <p>{t(locale, 'privacy.4.p')}</p>
          </div>
        </div>
      </section>

      <section className="deploy" id="deploy">
        <h2>{t(locale, 'deploy.h')}</h2>
        <p>{t(locale, 'deploy.p')}</p>
        <div className="deploy-grid">
          <div className="deploy-card">
            <h4>Vercel</h4>
            <pre><code>{`vercel --prod`}</code></pre>
            <p>Serverless. SQLite becomes Turso / libSQL.</p>
          </div>
          <div className="deploy-card">
            <h4>Self-host</h4>
            <pre><code>{`pnpm install && pnpm rebuild better-sqlite3
ENCRYPTION_KEY=$(openssl rand -hex 32) pnpm start`}</code></pre>
            <p>One process, one DB file. Forever.</p>
          </div>
          <div className="deploy-card">
            <h4>GitHub Pages</h4>
            <pre><code>{`npx ink-monitor deploy --target=gh-pages`}</code></pre>
            <p>CLI scaffolds a static fork with your data baked in.</p>
          </div>
        </div>
      </section>

      <section className="cli" id="cli">
        <h2>{t(locale, 'cli.h')}</h2>
        <p>{t(locale, 'cli.p')}</p>
        <pre className="cli-block"><code>{`# one-time login
npx ink-monitor login

# add providers and stocks from your terminal
npx ink-monitor provider add openai sk-...
npx ink-monitor stock add AAPL us
npx ink-monitor stock add 600519 cn
npx ink-monitor stock add 00700 hk

# one-shot deploy
npx ink-monitor deploy`}</code></pre>
        <p className="hint">The CLI ships a copy of your encrypted config to the cloud, then prints the URL of your new <code>/display</code>.</p>
      </section>

      <section className="cta">
        <h2>{t(locale, 'cta.h')}</h2>
        <div className="hero-cta" style={{ justifyContent: 'center' }}>
          <button className="btn primary big" onClick={() => signIn('github')}>
            ⌥  {t(locale, 'cta.signin')}
          </button>
          <Link className="btn big" href="/display" target="_blank">{t(locale, 'cta.demo')} ↗</Link>
        </div>
      </section>

      <footer className="footer">
        <div>{t(locale, 'footer.copy')}</div>
        <div className="footer-links">
          <a href="#features">Features</a>
          <a href="#deploy">Deploy</a>
          <a href="/display">Demo</a>
        </div>
      </footer>
    </div>
  );
}

function SparkUp() {
  return (
    <svg width="60" height="20" viewBox="0 0 60 20">
      <path d="M2,18 L10,12 L18,14 L26,8 L34,10 L42,4 L50,6 L58,2" fill="none" stroke="#000" strokeWidth="1.4" />
    </svg>
  );
}
function SparkDown() {
  return (
    <svg width="60" height="20" viewBox="0 0 60 20">
      <path d="M2,4 L10,8 L18,6 L26,12 L34,10 L42,16 L50,12 L58,18" fill="none" stroke="#000" strokeWidth="1.4" />
    </svg>
  );
}
