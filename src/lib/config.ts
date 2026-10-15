import { loadRuntimeConfig, saveRuntimeConfig } from './storage';
export const DEFAULT_REMEMBER_MINUTES = 10080;
export const MAX_REMEMBER_MINUTES = 525600;
export interface RuntimeConfig {
  rememberBrowserMinutes: number;
}
export function validateConfig(value: unknown): RuntimeConfig {
  const minutes = (value as RuntimeConfig)?.rememberBrowserMinutes;
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_REMEMBER_MINUTES
  )
    throw new Error('Invalid remembered-browser duration.');
  return { rememberBrowserMinutes: minutes };
}
export async function getConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/web/config.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Configuration unavailable.');
    const config = validateConfig(await response.json());
    await saveRuntimeConfig(config);
    return config;
  } catch {
    const saved = await loadRuntimeConfig().catch(() => undefined);
    return saved
      ? validateConfig(saved)
      : { rememberBrowserMinutes: DEFAULT_REMEMBER_MINUTES };
  }
}
export function formatDuration(minutes: number): string {
  const amount =
    minutes % 1440 === 0
      ? minutes / 1440
      : minutes % 60 === 0
        ? minutes / 60
        : minutes;
  const unit =
    minutes % 1440 === 0 ? 'day' : minutes % 60 === 0 ? 'hour' : 'minute';
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
}
