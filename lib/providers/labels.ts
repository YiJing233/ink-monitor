// Client-safe constants only — no Node-only imports here.
export const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI / Codex',
  anthropic: 'Anthropic Claude',
  custom: 'Custom API',
  demo: 'Demo (sample)',
  groq: 'Groq',
  mistral: 'Mistral AI',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot (月之暗面)',
  zhipu: 'Zhipu GLM (智谱)',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (local)',
};

export const PROVIDER_TYPES = [
  'openai', 'anthropic', 'custom', 'demo',
  'groq', 'mistral', 'deepseek', 'moonshot', 'zhipu', 'openrouter', 'ollama',
] as const;
export type ProviderTypeKey = (typeof PROVIDER_TYPES)[number];

/**
 * Pre-fill defaults for each provider type (base URL + endpoint). The actual
 * fetch is openai-compatible for all of these, except ollama which has a
 * slightly different path. We re-use the openai fetcher.
 */
export const PROVIDER_DEFAULTS: Record<ProviderTypeKey, { base_url: string; endpoint: string; json_path: string }> = {
  openai: { base_url: 'https://api.openai.com', endpoint: '/v1/usage', json_path: '' },
  anthropic: { base_url: 'https://api.anthropic.com', endpoint: '/v1/messages', json_path: '' },
  custom: { base_url: '', endpoint: '/v1/usage', json_path: 'data.used' },
  demo: { base_url: '', endpoint: '', json_path: '' },
  groq: { base_url: 'https://api.groq.com', endpoint: '/openai/v1/usage', json_path: '' },
  mistral: { base_url: 'https://api.mistral.ai', endpoint: '/v1/usage', json_path: '' },
  deepseek: { base_url: 'https://api.deepseek.com', endpoint: '/v1/usage', json_path: '' },
  moonshot: { base_url: 'https://api.moonshot.cn', endpoint: '/v1/usage', json_path: '' },
  zhipu: { base_url: 'https://open.bigmodel.cn', endpoint: '/api/paas/v4/usage', json_path: '' },
  openrouter: { base_url: 'https://openrouter.ai', endpoint: '/api/v1/usage', json_path: '' },
  ollama: { base_url: 'http://localhost:11434', endpoint: '/api/usage', json_path: '' },
};
