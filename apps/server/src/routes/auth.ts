import { authProviders, customProviders, isProviderEnabled } from '../lib/auth-providers';
import { getZeroDB } from '../lib/server-utils';
import { EProviders } from '../types';
import type { HonoContext } from '../ctx';
import { Hono } from 'hono';
import { z } from 'zod';

const publicRouter = new Hono<HonoContext>();

const imapSetupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

publicRouter.get('/providers', async (c) => {
  const env = c.env as unknown as Record<string, string>;
  const isProd = env.NODE_ENV === 'production';

  const authProviderStatus = authProviders(env).map((provider) => {
    const envVarStatus =
      provider.envVarInfo?.map((envVar) => {
        const envVarName = envVar.name as keyof typeof env;
        return {
          name: envVar.name,
          set: !!env[envVarName],
          source: envVar.source,
          defaultValue: envVar.defaultValue,
        };
      }) || [];

    return {
      id: provider.id,
      name: provider.name,
      enabled: isProviderEnabled(provider, env),
      required: provider.required,
      envVarInfo: provider.envVarInfo,
      envVarStatus,
    };
  });

  const customProviderStatus = customProviders.map((provider) => {
    return {
      id: provider.id,
      name: provider.name,
      enabled: true,
      isCustom: provider.isCustom,
      customRedirectPath: provider.customRedirectPath,
      envVarStatus: [],
    };
  });

  const allProviders = [...customProviderStatus, ...authProviderStatus];

  return c.json({
    allProviders,
    isProd,
  });
});

publicRouter.post('/imap/setup', async (c) => {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const parsed = imapSetupSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: 'Invalid payload' }, 400);

  const { email, password } = parsed.data;
  const db = await getZeroDB(session.user.id);
  const [createdConnection] = await db.createConnection(EProviders.imap, email, {
    accessToken: password,
    refreshToken: password,
    name: session.user.name || email,
    picture: session.user.image || '',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    scope: 'imap smtp',
  });

  await db.updateUser({ defaultConnectionId: createdConnection.id });
  return c.json({ success: true, connectionId: createdConnection.id });
});

export { publicRouter };
