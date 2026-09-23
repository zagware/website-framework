import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

// All infrastructure is configured from the environment so the same image runs
// locally (docker compose), on a VPS, or on a container platform.
const redisUrl = process.env.REDIS_URL
const workerMode = (process.env.MEDUSA_WORKER_MODE || "shared") as
  | "shared"
  | "worker"
  | "server"

// Stripe is optional: without STRIPE_API_KEY the stack still boots and only the
// built-in `pp_system_default` (manual) payment provider is available.
const stripeApiKey = process.env.STRIPE_API_KEY

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Local Postgres has no TLS; managed Postgres (Neon, Supabase, ...) sets DATABASE_SSL=true.
    databaseDriverOptions:
      process.env.DATABASE_SSL === "true"
        ? { ssl: { rejectUnauthorized: false } }
        : { ssl: false, sslmode: "disable" },
    redisUrl,
    workerMode,
    // NODE_ENV=production marks the admin session cookie `Secure`, which browsers drop on
    // plain-HTTP localhost. Only the local compose stack sets MEDUSA_COOKIE_SECURE=false.
    cookieOptions:
      process.env.MEDUSA_COOKIE_SECURE === "false" ? { secure: false } : undefined,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  admin: {
    // The worker instance of a server/worker split never serves the dashboard.
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL || "/",
  },
  modules: [
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: { redisUrl: process.env.CACHE_REDIS_URL || redisUrl },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl } },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl: process.env.LOCKING_REDIS_URL || redisUrl },
          },
        ],
      },
    },
    ...(stripeApiKey
      ? [
          {
            resolve: "@medusajs/medusa/payment",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/payment-stripe",
                  id: "stripe",
                  options: {
                    apiKey: stripeApiKey,
                    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
                  },
                },
              ],
            },
          },
        ]
      : []),
  ],
})
