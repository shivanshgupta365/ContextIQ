import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const appEnvSchema = publicEnvSchema.extend({
  APP_BASE_URL: z.url(),
});

const supabaseAdminEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const hydraEnvSchema = z.object({
  HYDRADB_API_KEY: z.string().min(1),
  HYDRADB_BASE_URL: z.url(),
  HYDRADB_TENANT_ID: z
    .string()
    .regex(/^[a-z0-9-_.]+$/i)
    .optional(),
});

const geminiEnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1),
});

const integrationCryptoEnvSchema = z.object({
  INTEGRATION_TOKEN_SECRET: z.string().min(16),
});

const googleOAuthEnvSchema = z.object({
  APP_BASE_URL: z.url(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
});

const linkedInOAuthEnvSchema = z.object({
  APP_BASE_URL: z.url(),
  LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),
});

const microsoftOAuthEnvSchema = z.object({
  APP_BASE_URL: z.url(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
});

const slackOAuthEnvSchema = z.object({
  APP_BASE_URL: z.url(),
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
});

const cronEnvSchema = z.object({
  CRON_SYNC_SECRET: z.string().min(16).optional(),
  CRON_SECRET: z.string().min(16).optional(),
});

const serverEnvSchema = publicEnvSchema
  .merge(appEnvSchema)
  .merge(supabaseAdminEnvSchema)
  .merge(hydraEnvSchema)
  .merge(geminiEnvSchema)
  .merge(integrationCryptoEnvSchema)
  .merge(googleOAuthEnvSchema)
  .merge(linkedInOAuthEnvSchema)
  .merge(microsoftOAuthEnvSchema)
  .merge(slackOAuthEnvSchema)
  .extend({
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().min(1).optional(),
  HUBSPOT_CLIENT_ID: z.string().min(1).optional(),
  HUBSPOT_CLIENT_SECRET: z.string().min(1).optional(),
  SALESFORCE_CLIENT_ID: z.string().min(1).optional(),
  SALESFORCE_CLIENT_SECRET: z.string().min(1).optional(),
  INTERCOM_ACCESS_TOKEN: z.string().min(1).optional(),
  NOTION_CLIENT_ID: z.string().min(1).optional(),
  NOTION_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  ZOOM_CLIENT_ID: z.string().min(1).optional(),
  ZOOM_CLIENT_SECRET: z.string().min(1).optional(),
  CRON_SYNC_SECRET: z.string().min(16).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  SEED_REAL_WORKSPACE_ON_SIGNUP: z.enum(["true", "false"]).optional(),
});

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function getAppEnv() {
  return appEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
  });
}

export function getSupabaseAdminEnv() {
  return supabaseAdminEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export function getHydraEnv() {
  return hydraEnvSchema.parse({
    HYDRADB_API_KEY: process.env.HYDRADB_API_KEY,
    HYDRADB_BASE_URL: process.env.HYDRADB_BASE_URL,
    HYDRADB_TENANT_ID: process.env.HYDRADB_TENANT_ID,
  });
}

export function getGeminiEnv() {
  return geminiEnvSchema.parse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  });
}

export function getIntegrationCryptoEnv() {
  return integrationCryptoEnvSchema.parse({
    INTEGRATION_TOKEN_SECRET: process.env.INTEGRATION_TOKEN_SECRET,
  });
}

export function getGoogleOAuthEnv() {
  return googleOAuthEnvSchema.parse({
    APP_BASE_URL: process.env.APP_BASE_URL,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
}

export function getLinkedInOAuthEnv() {
  return linkedInOAuthEnvSchema.parse({
    APP_BASE_URL: process.env.APP_BASE_URL,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
  });
}

export function getMicrosoftOAuthEnv() {
  return microsoftOAuthEnvSchema.parse({
    APP_BASE_URL: process.env.APP_BASE_URL,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
  });
}

export function getSlackOAuthEnv() {
  return slackOAuthEnvSchema.parse({
    APP_BASE_URL: process.env.APP_BASE_URL,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  });
}

export function getCronEnv() {
  return cronEnvSchema.parse({
    CRON_SYNC_SECRET: process.env.CRON_SYNC_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
  });
}

export function getServerEnv() {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    HYDRADB_API_KEY: process.env.HYDRADB_API_KEY,
    HYDRADB_BASE_URL: process.env.HYDRADB_BASE_URL,
    HYDRADB_TENANT_ID: process.env.HYDRADB_TENANT_ID,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    INTEGRATION_TOKEN_SECRET: process.env.INTEGRATION_TOKEN_SECRET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    HUBSPOT_CLIENT_ID: process.env.HUBSPOT_CLIENT_ID,
    HUBSPOT_CLIENT_SECRET: process.env.HUBSPOT_CLIENT_SECRET,
    SALESFORCE_CLIENT_ID: process.env.SALESFORCE_CLIENT_ID,
    SALESFORCE_CLIENT_SECRET: process.env.SALESFORCE_CLIENT_SECRET,
    INTERCOM_ACCESS_TOKEN: process.env.INTERCOM_ACCESS_TOKEN,
    NOTION_CLIENT_ID: process.env.NOTION_CLIENT_ID,
    NOTION_CLIENT_SECRET: process.env.NOTION_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
    CRON_SYNC_SECRET: process.env.CRON_SYNC_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    SEED_REAL_WORKSPACE_ON_SIGNUP: process.env.SEED_REAL_WORKSPACE_ON_SIGNUP,
  });
}
