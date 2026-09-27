import 'dotenv/config';

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://vigie:vigie@localhost:5432/vigie',
  timezone: process.env.APP_TIMEZONE ?? 'Asia/Jerusalem',
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || '',
  openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
  /** auto = données de démo uniquement là où aucune source réelle n'a encore rien fourni ; on/off forcent. */
  demoMode: (process.env.DEMO_MODE ?? 'auto') as 'auto' | 'on' | 'off',
  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
  reminderTickSeconds: Number(process.env.REMINDER_TICK_SECONDS ?? 15),
  collectTickSeconds: Number(process.env.COLLECT_TICK_SECONDS ?? 60),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() || '',
  vapidSubject: process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.invalid',
  /** Jeton optionnel : si défini, toutes les routes /api exigent Authorization: Bearer <jeton>. */
  appToken: process.env.APP_TOKEN?.trim() || '',
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '',
  httpUserAgent: process.env.HTTP_USER_AGENT?.trim() || 'Vigie/1.0 (veille professionnelle personnelle)',
};
