import { Firestore } from "@google-cloud/firestore";
import { ExternalAccountClient, GoogleAuth } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import type { DownloadConfig } from "./config.ts";

export function createGoogleServices(config: DownloadConfig) {
  const audience = `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.pool}/providers/${config.provider}`;
  // The pool's IAM binding must restrict this to this Vercel project's
  // production subject. No service-account key or ambient local auth fallback.
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccount}:generateAccessToken`,
    // This is Google's exchange audience. The provider's allowed audience must
    // separately match the platform-issued token: https://vercel.com/TEAM_SLUG.
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    transporterOptions: { timeout: 4000, retry: false },
  });
  if (!client) throw new Error("Download authentication is unavailable");
  const auth = new GoogleAuth({ authClient: client, projectId: config.projectId });
  return {
    database: new Firestore({ projectId: config.projectId, databaseId: config.database, auth, preferRest: true }),
  };
}
