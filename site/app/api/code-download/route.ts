import { Resolver } from "node:dns/promises";
import { verifyDownloadVisitor } from "../../../lib/code-download/bot.ts";
import { readDownloadConfig, readDownloadOrigin } from "../../../lib/code-download/config.ts";
import { createGoogleServices } from "../../../lib/code-download/google.ts";
import { createCodeDownloadHandler } from "../../../lib/code-download/handler.ts";
import { createMailboxLookup } from "../../../lib/code-download/mailbox.ts";
import { createRateLimiter } from "../../../lib/code-download/rate-limit.ts";
import { createDownloadRecorder } from "../../../lib/code-download/capture.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const config = readDownloadConfig(process.env);
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  let database: ReturnType<typeof createGoogleServices>["database"] | undefined;
  try {
    return await createCodeDownloadHandler({ allowedOrigin: readDownloadOrigin(process.env) ?? "" }, {
      verifyBot: verifyDownloadVisitor,
      rateLimit: async (incoming, email) => {
        if (!config) return { allowed: false };
        database = createGoogleServices(config).database;
        return createRateLimiter({ hmacSecret: config.rateSecret }, database)(incoming, email);
      },
      lookupMailbox: createMailboxLookup(resolver),
      recordDownload: async details => {
        if (!database) throw new Error("Download recording unavailable");
        await createDownloadRecorder(database)(details);
      },
    })(request);
  } finally {
    resolver.cancel();
    if (database) void database.terminate().catch(() => {});
  }
}
