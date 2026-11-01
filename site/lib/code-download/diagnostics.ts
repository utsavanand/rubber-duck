export type DownloadFailureStage = "trusted_ip" | "oidc" | "rate_limit" | "mailbox" | "bot" | "record";
type GoogleReason = "IAM_PERMISSION_DENIED" | "ACCESS_TOKEN_SCOPE_INSUFFICIENT" | "SERVICE_DISABLED" | "BILLING_DISABLED" | "RATE_LIMIT_EXCEEDED";
export type DownloadFailureEvent = { stage: DownloadFailureStage; httpStatus?: number; grpcStatus?: number; reason?: GoogleReason };
export type DownloadFailureReporter = (event: DownloadFailureEvent) => void;

const stages = new Set<DownloadFailureStage>(["trusted_ip", "oidc", "rate_limit", "mailbox", "bot", "record"]);
const reasons = new Set<GoogleReason>(["IAM_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "SERVICE_DISABLED", "BILLING_DISABLED", "RATE_LIMIT_EXCEEDED"]);
const logFailure: DownloadFailureReporter = event => console.warn("code_download_failure", event);
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// Preserve a known internal stage through SDK wrappers without exposing the
// original exception message, request configuration or credentials.
export class DownloadStageError extends Error {
  readonly stage: DownloadFailureStage;
  constructor(stage: DownloadFailureStage, cause: unknown) {
    super("Download dependency unavailable", { cause });
    this.stage = stage;
  }
}

export function reportDownloadFailure(stage: DownloadFailureStage, error?: unknown, reporter: DownloadFailureReporter = logFailure): void {
  const event: DownloadFailureEvent = { stage: stages.has(stage) ? stage : "rate_limit" };
  const seen = new Set<object>();
  try {
    let current = record(error);
    for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
      seen.add(current);
      const knownStage = current instanceof DownloadStageError ? current.stage : undefined;
      if (knownStage && stages.has(knownStage)) event.stage = knownStage;
      const response = record(current.response);
      for (const status of [current.httpStatusCode, response?.status, current.status]) {
        if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) event.httpStatus ??= status;
      }
      const code = current.code;
      if (typeof code === "number" && Number.isInteger(code) && code >= 1 && code <= 16) event.grpcStatus ??= code;
      const provider = record(record(response?.data)?.error);
      const details = Array.isArray(provider?.details) ? provider.details.slice(0, 8) : [];
      for (const detail of [current, ...details]) {
        const reason = record(detail)?.reason;
        if (typeof reason === "string" && reasons.has(reason as GoogleReason)) event.reason ??= reason as GoogleReason;
      }
      current = record(current.cause);
    }
  } catch {
    // Even unusual SDK objects/getters cannot affect the request outcome.
  }
  try { reporter(event); } catch { /* Observability must never fail a request. */ }
}
