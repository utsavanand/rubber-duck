import { randomUUID } from "node:crypto";
import { validateEmail } from "./email.ts";

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
};

type DownloadEmail = { to: string; downloadUrl: string };

// Server-only, send-only OAuth credentials. No mailbox-reading permission is
// needed. Configure the authenticated Gmail address or an authorized send-as.
export function createGmailSender(config: GmailConfig, send: typeof fetch = fetch) {
  return async ({ to, downloadUrl }: DownloadEmail, signal?: AbortSignal): Promise<{ accepted: boolean }> => {
    signal?.throwIfAborted();
    const sender = validateEmail(config.from);
    const recipient = validateEmail(to);
    if (!sender.valid || !recipient.valid || !config.clientId || !config.clientSecret || !config.refreshToken) return { accepted: false };
    const link = new URL(downloadUrl);
    if (link.protocol !== "https:" || link.username || link.password || /\s/.test(downloadUrl) || downloadUrl.length > 8192) return { accepted: false };

    const authorization = await send("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      redirect: "error",
      cache: "no-store",
    });
    if (!authorization.ok) return { accepted: false };
    const token = await authorization.json();
    if (typeof token?.access_token !== "string" || !token.access_token || /[\r\n]/.test(token.access_token)) return { accepted: false };

    const body = [
      "Your DuckTerm Code download",
      "",
      downloadUrl,
      "",
      "This link expires in 24 hours. You can request another at https://duckterm.utsava.xyz/#code.",
      "",
      "For Apple silicon Macs running macOS 13 or later. Unzip the download, move DuckTerm Code.app to Applications, and open it.",
      "",
      "You received this because someone requested a DuckTerm Code download for this address. If that wasn't you, you can ignore this email.",
      "This request does not subscribe you to a newsletter.",
    ].join("\r\n");
    const encodedBody = Buffer.from(body).toString("base64").match(/.{1,76}/g)!.join("\r\n");
    const mime = [
      `From: DuckTerm Downloads <${sender.email}>`,
      `To: ${recipient.email}`,
      "Subject: Your DuckTerm Code download",
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@duckterm.utsava.xyz>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody,
      "",
    ].join("\r\n");

    // Do not retry a send automatically: a timeout can occur after acceptance.
    signal?.throwIfAborted();
    const response = await send("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) return { accepted: false };
    const result = await response.json();
    return { accepted: typeof result?.id === "string" && result.id.length > 0 };
  };
}
