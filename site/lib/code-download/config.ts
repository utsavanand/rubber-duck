export function readDownloadConfig(env: Record<string, string | undefined>) {
  // Preview deployments and incomplete production configuration never send.
  if (env.VERCEL_ENV !== "production" || env.CODE_DOWNLOAD_ENABLED !== "true") return null;
  const fields = {
    origin: env.CODE_DOWNLOAD_ORIGIN,
    projectId: env.GCP_PROJECT_ID,
    projectNumber: env.GCP_PROJECT_NUMBER,
    serviceAccount: env.GCP_SERVICE_ACCOUNT_EMAIL,
    pool: env.GCP_WORKLOAD_IDENTITY_POOL_ID,
    provider: env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
    database: env.GCP_FIRESTORE_DATABASE,
    bucket: env.CODE_DOWNLOAD_BUCKET,
    object: env.CODE_DOWNLOAD_OBJECT,
    generation: env.CODE_DOWNLOAD_GENERATION,
    rateSecret: env.CODE_DOWNLOAD_RATE_SECRET,
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    from: env.GMAIL_FROM,
  };
  if (Object.values(fields).some(value => !value || value.trim() !== value)) return null;
  const config = fields as { [K in keyof typeof fields]: string };
  if (config.origin !== "https://duckterm.utsava.xyz" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) ||
      !/^\d{6,20}$/.test(config.projectNumber) || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(config.serviceAccount) ||
      !config.serviceAccount.endsWith(`@${config.projectId}.iam.gserviceaccount.com`) ||
      ![config.pool, config.provider, config.database].every(value => /^[a-z][a-z0-9-]{2,62}$/.test(value)) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^(?:[a-zA-Z0-9_-]+\/)*DuckTerm-Code-\d+\.\d+\.\d+-macos-arm64\.zip$/.test(config.object) ||
      !/^[1-9]\d{0,19}$/.test(config.generation) || Buffer.byteLength(config.rateSecret) < 32) return null;
  return config;
}

export type DownloadConfig = NonNullable<ReturnType<typeof readDownloadConfig>>;
