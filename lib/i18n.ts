/**
 * Lightweight i18n. A dictionary per language, no extra deps. Locales are
 * stored in the `NEXT_LOCALE` cookie and propagated via middleware.
 */
export type Locale = 'en' | 'zh' | 'ja';

export const LOCALES: Array<{ code: Locale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
];

export const DEFAULT_LOCALE: Locale = 'en';

type Dict = Record<string, string>;

const en: Dict = {
  'tagline': 'Your e-reader is a dashboard.',
  'lede': 'A B&W monitoring surface for token plans and stock watchlists. Drop your OpenAI, Anthropic or custom API key — see real-time usage on a Kindle or Xiaomi e-reader. Auto-refreshing, animated-free, account-bound.',
  'cta.signin': 'Sign in with GitHub',
  'cta.open': 'Open my dashboard',
  'cta.demo': 'See a live demo',
  'nav.features': 'Features',
  'nav.how': 'How',
  'nav.deploy': 'Deploy',
  'nav.cli': 'CLI',
  'meta.free': 'Free · 60s setup · self-host or SaaS · Open source',
  'features.h': 'How it works',
  'features.01.h': 'Sign in with GitHub',
  'features.01.p': 'One click. We use your GitHub id only to scope your dashboard — no email access, no repo scope.',
  'features.02.h': 'Paste your API keys',
  'features.02.p': 'OpenAI, Anthropic, or any custom endpoint. Keys are encrypted with AES-256-GCM keyed to your user id. We never see them in plaintext after submission.',
  'features.03.h': 'Bookmark on your e-reader',
  'features.03.p': 'Open /display on a Kindle or Xiaomi reader. The page auto-refreshes every 60s. No app, no install.',
  'features.04.h': 'Or self-host',
  'features.04.p': 'The whole thing is one Next.js app with SQLite. git clone && pnpm install && pnpm dev — yours forever.',
  'privacy.h': 'How your API keys are protected',
  'privacy.1.h': 'Per-user encryption',
  'privacy.1.p': 'Each user\'s keys are encrypted with a key derived from PBKDF2(ENCRYPTION_KEY, user_id) — different per user, never stored.',
  'privacy.2.h': 'Server-side only',
  'privacy.2.p': 'The master key lives in your deployment\'s environment variables. The DB alone is useless to an attacker.',
  'privacy.3.h': 'OAuth, not password',
  'privacy.3.p': 'No passwords to leak. Sign in with GitHub — we never see your email or any private repo.',
  'privacy.4.h': 'Open source',
  'privacy.4.p': 'Every line of this stack is auditable. The repo includes threat-model notes in the README.',
  'deploy.h': 'One-click deploy',
  'deploy.p': 'Push to Vercel, GitHub Pages, or your own server. The data layer is portable SQLite, and we ship a CLI for the rest.',
  'cli.h': 'Or use the CLI',
  'cli.p': 'For power users who\'d rather skip the web UI.',
  'cta.h': 'Get a dashboard on your e-reader in 60 seconds.',
  'footer.copy': '© Ink Monitor · MIT licensed',
};

const zh: Dict = {
  'tagline': '你的电纸书，就是仪表盘。',
  'lede': '为 token 套餐和股票监控而生的黑白面板。粘贴你的 OpenAI、Anthropic 或自定义 API key —— 在 Kindle 或小米电纸书上实时查看用量。自动刷新、无动画、账户绑定。',
  'cta.signin': '使用 GitHub 登录',
  'cta.open': '打开我的仪表盘',
  'cta.demo': '查看实时演示',
  'nav.features': '特性',
  'nav.how': '原理',
  'nav.deploy': '部署',
  'nav.cli': 'CLI',
  'meta.free': '免费 · 60 秒上手 · 自托管或 SaaS · 开源',
  'features.h': '它怎么工作',
  'features.01.h': '用 GitHub 登录',
  'features.01.p': '一点即用。我们只用到你的 GitHub id 来标识你的面板 —— 不读邮箱，不碰仓库。',
  'features.02.h': '粘贴你的 API key',
  'features.02.p': 'OpenAI、Anthropic 或任何自定义端点。Key 用绑定到你 user id 的 AES-256-GCM 加密入库，提交后我们再也不会看到明文。',
  'features.03.h': '在电纸书上收藏',
  'features.03.p': '在 Kindle 或小米电纸书上打开 /display，页面每 60s 自动刷新。无需装 App。',
  'features.04.h': '也可以自托管',
  'features.04.p': '整个项目就是一个 Next.js 应用加 SQLite。git clone && pnpm install && pnpm dev，永远属于你。',
  'privacy.h': '你的 API key 怎么保护',
  'privacy.1.h': '按用户加密',
  'privacy.1.p': '每个用户的 key 都用 PBKDF2(ENCRYPTION_KEY, user_id) 派生的 key 加密 —— 每用户独立，永不存储主 key。',
  'privacy.2.h': '仅服务端持有',
  'privacy.2.p': '主 key 存在部署的环境变量里。光拿到数据库对攻击者没用。',
  'privacy.3.h': 'OAuth 不要密码',
  'privacy.3.p': '没有密码可泄露。GitHub 登录 —— 我们既看不到你的邮箱，也访问不到任何私有仓库。',
  'privacy.4.h': '开源',
  'privacy.4.p': '每一行代码都可审计。仓库的 README 里包含威胁建模说明。',
  'deploy.h': '一键部署',
  'deploy.p': '推送到 Vercel、GitHub Pages 或你自己的服务器。数据层是可移植的 SQLite，CLI 也已就绪。',
  'cli.h': '或使用 CLI',
  'cli.p': '不想用 Web UI？给极客准备的命令行。',
  'cta.h': '60 秒把仪表盘装进你的电纸书。',
  'footer.copy': '© Ink Monitor · MIT 许可证',
};

const ja: Dict = {
  'tagline': 'あなたの電子書籍リーダーが、ダッシュボードになる。',
  'lede': 'トークンプランと株価ウォッチリストのための白黒モニタリング画面。OpenAI、Anthropic、または任意のカスタム API キーを貼り付けるだけで、Kindle や Xiaomi の電子書籍リーダーでリアルタイムの消費量を表示。自動更新、アニメーションなし、アカウント紐付け。',
  'cta.signin': 'GitHub でサインイン',
  'cta.open': 'ダッシュボードを開く',
  'cta.demo': 'ライブデモを見る',
  'nav.features': '機能',
  'nav.how': '仕組み',
  'nav.deploy': 'デプロイ',
  'nav.cli': 'CLI',
  'meta.free': '無料 · 60秒セットアップ · セルフホスト or SaaS · オープンソース',
  'features.h': '使い方',
  'features.01.h': 'GitHub でサインイン',
  'features.01.p': 'ワンクリック。GitHub ID をお客様のダッシュボード識別のためにだけ使用します。メールやリポジトリへのアクセス権は要求しません。',
  'features.02.h': 'API キーを貼り付け',
  'features.02.p': 'OpenAI、Anthropic、または任意のカスタムエンドポイント。キーはユーザー ID に紐づいた AES-256-GCM で暗号化されて保存され、送信後に平文で見ることはありません。',
  'features.03.h': '電子書籍リーダーでブックマーク',
  'features.03.p': 'Kindle や Xiaomi のリーダーで /display を開けば、60秒ごとに自動更新。アプリ不要、インストール不要。',
  'features.04.h': 'セルフホストも可能',
  'features.04.p': 'Next.js アプリと SQLite だけのシンプルな構成。git clone && pnpm install && pnpm dev でずっと自分のもの。',
  'privacy.h': 'API キーの保護方法',
  'privacy.1.h': 'ユーザーごとに暗号化',
  'privacy.1.p': 'PBKDF2(ENCRYPTION_KEY, user_id) で派生した鍵でユーザーごとに別々に暗号化。マスター鍵は保存しません。',
  'privacy.2.h': 'サーバー側のみ',
  'privacy.2.p': 'マスター鍵はデプロイ先の環境変数にあります。データベースだけ流出しても攻撃者には解読できません。',
  'privacy.3.h': 'パスワードは使いません',
  'privacy.3.p': '漏洩するパスワードが存在しません。GitHub ログインで、私たちはメールも見られず、プライベートリポジトリにもアクセスできません。',
  'privacy.4.h': 'オープンソース',
  'privacy.4.p': 'コードのすべての行が監査可能。README に脅威モデルを含めています。',
  'deploy.h': 'ワンクリックデプロイ',
  'deploy.p': 'Vercel、GitHub Pages、または自分のサーバーへ。データ層は可搬な SQLite で、CLI も用意しています。',
  'cli.h': 'CLI を使う',
  'cli.p': 'Web UI をスキップしたいパワーユーザー向け。',
  'cta.h': '60秒で電子書籍リーダーにダッシュボードを。',
  'footer.copy': '© Ink Monitor · MIT ライセンス',
};

const dicts: Record<Locale, Dict> = { en, zh, ja };

export function t(locale: Locale, key: string): string {
  return dicts[locale]?.[key] || dicts.en[key] || key;
}

export function getLocaleFromCookie(cookieValue: string | null | undefined): Locale {
  if (!cookieValue) return DEFAULT_LOCALE;
  if (cookieValue === 'en' || cookieValue === 'zh' || cookieValue === 'ja') return cookieValue as Locale;
  return DEFAULT_LOCALE;
}
