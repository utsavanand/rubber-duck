import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { validateEmail } from "./email.ts";
import { DownloadStageError } from "./diagnostics.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const COLLECTION = "ducktermCodeDownloadLimits";
const POLICIES = [
  { kind: "email", limit: 3, window: DAY },
  { kind: "ip", limit: 5, window: HOUR },
  { kind: "global", limit: 100, window: DAY },
] as const;

type Decision = { allowed: boolean; retryAfterSeconds?: number };

function clientIP(request: Request): string {
  // Only use behind Vercel's trusted edge, which supplies this header. Never
  // fall back to client-controlled Forwarded/X-Forwarded-For values.
  const value = request.headers.get("x-vercel-forwarded-for");
  if (!value || value.includes("%") || !isIP(value)) throw new Error("Trusted client IP unavailable");
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 and plain IPv4 represent the same client address.
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function emailIdentity(email: string): string {
  const checked = validateEmail(email);
  if (!checked.valid) throw new Error("Rate limit identity unavailable");
  let [local, domain] = checked.email.toLowerCase().split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split("+", 1)[0].replaceAll(".", "");
    domain = "gmail.com";
  }
  // This identity is only hashed for limiting. Delivery retains the address
  // supplied by the caller, including case, dots and plus tags.
  return `${local}@${domain}`;
}

function recentReservations(data: Record<string, unknown> | undefined, exists: boolean, limit: number, window: number, now: number): number[] {
  if (!exists) return [];
  const entries = data?.reservations;
  if (data?.version !== 1 || !(data.expireAt instanceof Timestamp) || !Array.isArray(entries) || entries.length > limit ||
      entries.some((entry, index) => !Number.isSafeInteger(entry) || entry < 0 || entry > now || (index > 0 && entry < entries[index - 1]))) {
    throw new Error("Rate limit state unavailable");
  }
  // TTL deletion is asynchronous; enforce expiry here even before deletion.
  return entries.filter(entry => entry > now - window);
}

export function createRateLimiter(config: { hmacSecret: string }, database: Firestore, clock: () => number = Date.now): (request: Request, email: string) => Promise<Decision> {
  if (typeof config?.hmacSecret !== "string" || Buffer.byteLength(config.hmacSecret, "utf8") < 32) throw new Error("Rate limit configuration unavailable");
  const key = (kind: string, value: string) => `${kind}-${createHmac("sha256", config.hmacSecret).update(`${kind}\0${value}`).digest("hex")}`;
  return async (request, email) => {
    const identity = emailIdentity(email);
    let ip: string;
    try { ip = clientIP(request); }
    catch (error) { throw new DownloadStageError("trusted_ip", error); }
    const identities = [identity, ip, "all"];
    const references = POLICIES.map((policy, index) => database.collection(COLLECTION).doc(key(policy.kind, identities[index])));
    return database.runTransaction(async transaction => {
      // Read the complete decision set before staging any writes. Retries repeat
      // this calculation against the newly locked state, not a cached decision.
      const snapshots = await transaction.getAll(...references);
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Rate limit clock unavailable");
      const histories = POLICIES.map((policy, index) => recentReservations(snapshots[index].data(), snapshots[index].exists, policy.limit, policy.window, now));
      let wait = histories[0].length ? histories[0].at(-1)! + 5 * MINUTE - now : 0;
      POLICIES.forEach((policy, index) => {
        if (histories[index].length >= policy.limit) wait = Math.max(wait, histories[index][0] + policy.window - now);
      });
      if (wait > 0) return { allowed: false, retryAfterSeconds: Math.ceil(wait / 1000) };
      // At most 3 + 5 + 100 timestamps: exact rolling limits without unbounded
      // histories or fixed-window boundary bursts. A reservation counts before
      // DNS and delivery; an uncertain mail failure must not be refunded.
      POLICIES.forEach((policy, index) => transaction.set(references[index], {
        version: 1,
        reservations: [...histories[index], now],
        expireAt: Timestamp.fromMillis(now + policy.window),
      }));
      return { allowed: true };
    }, { maxAttempts: 3 });
  };
}
