export interface EnvVarInfo {
  name: string;
  source: string;
  defaultValue?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  requiredEnvVars: string[];
  envVarInfo?: EnvVarInfo[];
  config: unknown;
  required?: boolean;
  isCustom?: boolean;
  customRedirectPath?: string;
}

export const customProviders: ProviderConfig[] = [
  {
    id: 'imap',
    name: 'IMAP / SMTP',
    requiredEnvVars: [],
    config: {},
    isCustom: true,
    customRedirectPath: '/zero/login',
  },
];

export const authProviders = (_env: Record<string, string>): ProviderConfig[] => [];

export function isProviderEnabled(provider: ProviderConfig, env: Record<string, string>): boolean {
  if (provider.isCustom) return true;

  const hasEnvVars = provider.requiredEnvVars.every((envVar) => !!env[envVar]);

  if (provider.required && !hasEnvVars) {
    console.error(`Required provider "${provider.id}" is not configured properly.`);
    console.error(
      `Missing environment variables: ${provider.requiredEnvVars.filter((envVar) => !env[envVar]).join(', ')}`,
    );
  }

  return hasEnvVars;
}
