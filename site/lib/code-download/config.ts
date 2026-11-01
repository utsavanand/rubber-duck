export function readDownloadOrigin(env: Record<string, string | undefined>): string | null {
  if (env.CODE_DOWNLOAD_ORIGIN === undefined || env.CODE_DOWNLOAD_ORIGIN === "https://duckterm.utsava.xyz") return "https://duckterm.utsava.xyz";
  if (env.CODE_DOWNLOAD_ORIGIN === "deployment" && env.VERCEL_ENV === "production") {
    const hostname = env.VERCEL_URL;
    if (hostname && hostname.trim() === hostname && /^rubber-duck-[a-z0-9]{9}-utsavs-projects-b9d729c7\.vercel\.app$/.test(hostname)) return `https://${hostname}`;
  }
  return null;
}

export function readDownloadConfig(env: Record<string, string | undefined>) {
  // Capturing addresses is separately enabled. The parked mail flag and Gmail
  // credentials are deliberately absent from this production code path.
  if (env.VERCEL_ENV !== "production" || env.DOWNLOAD_CAPTURE_ENABLED !== "true") return null;
  const fields = {
    origin: readDownloadOrigin(env),
    projectId: env.GCP_PROJECT_ID,
    projectNumber: env.GCP_PROJECT_NUMBER,
    serviceAccount: env.GCP_SERVICE_ACCOUNT_EMAIL,
    pool: env.GCP_WORKLOAD_IDENTITY_POOL_ID,
    provider: env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
    database: env.GCP_FIRESTORE_DATABASE,
    rateSecret: env.CODE_DOWNLOAD_RATE_SECRET,
  };
  if (Object.values(fields).some(value => !value || value.trim() !== value)) return null;
  const config = fields as { [K in keyof typeof fields]: string };
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId) ||
      !/^\d{6,20}$/.test(config.projectNumber) || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(config.serviceAccount) ||
      !config.serviceAccount.endsWith(`@${config.projectId}.iam.gserviceaccount.com`) ||
      ![config.pool, config.provider, config.database].every(value => /^[a-z][a-z0-9-]{2,62}$/.test(value)) ||
      Buffer.byteLength(config.rateSecret) < 32) return null;
  return config;
}

export type DownloadConfig = NonNullable<ReturnType<typeof readDownloadConfig>>;
