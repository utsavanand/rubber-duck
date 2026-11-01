import { checkBotId } from "botid/server";

export async function verifyDownloadVisitor() {
  // BotID reads edge headers from Vercel's request context. Use that same
  // source: its missing-challenge warning otherwise includes an untrusted
  // method header. Do not call the SDK for a request with no challenge.
  const context = Reflect.get(globalThis, Symbol.for("@vercel/request-context")) as
    { get?: () => { headers?: Record<string, unknown> } } | undefined;
  const challenge = context?.get?.()?.headers?.["x-is-human"];
  if (typeof challenge !== "string" || challenge.length === 0) {
    return { isHuman: false, isBot: true, bypassed: false };
  }
  return checkBotId({ advancedOptions: { checkLevel: "basic" } });
}
