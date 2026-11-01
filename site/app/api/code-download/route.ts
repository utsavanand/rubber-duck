import { Resolver } from "node:dns/promises";
import { readDownloadConfig } from "../../../lib/code-download/config.ts";
import { createGoogleServices } from "../../../lib/code-download/google.ts";
import { createCodeDownloadHandler } from "../../../lib/code-download/handler.ts";
import { createGmailSender } from "../../../lib/code-download/gmail.ts";
import { createMailboxLookup } from "../../../lib/code-download/mailbox.ts";
import { createRateLimiter } from "../../../lib/code-download/rate-limit.ts";
import { reportDownloadFailure } from "../../../lib/code-download/diagnostics.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const config = readDownloadConfig(process.env);
  if (!config) return Response.json({ ok: false, error: "We couldn't send the download link. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  let database: ReturnType<typeof createGoogleServices>["database"] | undefined;
  try {
    const services = createGoogleServices(config);
    database = services.database;
    return await createCodeDownloadHandler({ allowedOrigin: config.origin }, {
      rateLimit: createRateLimiter({ hmacSecret: config.rateSecret }, database),
      lookupMailbox: createMailboxLookup(resolver),
      sendMail: createGmailSender(config),
    })(request);
  } catch (error) {
    reportDownloadFailure("rate_limit", error);
    return Response.json({ ok: false, error: "We couldn't send the download link. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  } finally {
    resolver.cancel();
    // No persistent client streams should outlive a serverless request.
    if (database) void database.terminate().catch(() => {});
  }
}
