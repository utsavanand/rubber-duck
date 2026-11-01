import { isIP } from "node:net";

export type MailboxResult = { status: "valid" | "invalid" | "unavailable" };
export type MailboxResolver = {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
};

function noRecord(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENODATA" || code === "ENOTFOUND";
}

// Checks a mail domain, not the existence or ownership of an individual inbox.
// RFC 5321 section 5.1 permits A/AAAA fallback only when MX records are absent;
// RFC 7505's null MX explicitly disables that fallback.
export function createMailboxLookup(resolver: MailboxResolver): (domain: string) => Promise<MailboxResult> {
  return async domain => {
    let mx: { exchange: string; priority: number }[];
    try {
      mx = await resolver.resolveMx(domain);
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "ENOTFOUND") return { status: "invalid" };
      if (!noRecord(error)) return { status: "unavailable" };
      mx = [];
    }
    if (mx.length) {
      const nullRecords = mx.filter(record => record.exchange === "." || record.exchange === "");
      if (nullRecords.length) return { status: mx.length === 1 && mx[0].priority === 0 ? "invalid" : "unavailable" };
      const valid = mx.every(record => Number.isInteger(record.priority) && record.priority >= 0 && record.priority <= 65535 &&
        record.exchange.length <= 254 && record.exchange.replace(/\.$/, "").split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)));
      return { status: valid ? "valid" : "unavailable" };
    }
    const addresses = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
    if (addresses.some((result, index) => result.status === "fulfilled" && result.value.some(address => isIP(address) === (index === 0 ? 4 : 6)))) return { status: "valid" };
    return { status: addresses.some(result => result.status === "rejected" && !noRecord(result.reason)) ? "unavailable" : "invalid" };
  };
}
