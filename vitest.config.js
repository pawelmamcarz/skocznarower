import { fileURLToPath } from 'node:url';

import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));
      const migrations = await readD1Migrations(migrationsPath);

      return {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_PASSWORD: 'test-admin-password',
            SESSION_SECRET: 'test-session-secret-not-for-production',
            RATE_LIMIT_SECRET: 'test-rate-limit-secret-not-for-production',
            TURNSTILE_SITE_KEY: '',
            TURNSTILE_SECRET_KEY: '',
            SMSAPI_TOKEN: '',
            RESEND_API_KEY: '',
            NOTIFY_EMAIL: '',
            REPLY_TO_EMAIL: '',
            WHATSAPP_TOKEN: '',
            WHATSAPP_PHONE_NUMBER_ID: '',
            WHATSAPP_APP_SECRET: '',
            GOOGLE_SA_EMAIL: '',
            GOOGLE_SA_PRIVATE_KEY: '',
            GOOGLE_CALENDAR_ID: '',
            GOOGLE_PLACES_API_KEY: '',
            GOOGLE_PLACE_ID: '',
            VOICE_API_SECRET: 'test-voice-secret',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./tests/apply-migrations.js'],
    testTimeout: 10_000,
  },
});
