import { domainToASCII } from "node:url";

// A deliberately small denylist, not a claim to detect every disposable inbox.
const DISPOSABLE_DOMAINS = [
  "mailinator.com", "guerrillamail.com", "sharklasers.com", "10minutemail.com", "yopmail.com",
];
const RESERVED_DOMAINS = [
  "example.com", "example.net", "example.org", "example", "test", "invalid", "localhost", "local",
];
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type EmailValidation = { valid: true; email: string; domain: string } | { valid: false };

export function validateEmail(input: unknown): EmailValidation {
  if (typeof input !== "string" || input.length > 512 || /[\r\n\0]/.test(input)) return { valid: false };
  const value = input.trim();
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return { valid: false };
  const local = value.slice(0, at);
  if (local.length > 64 || !LOCAL_PART.test(local)) return { valid: false };
  const rawDomain = value.slice(at + 1);
  // domainToASCII also parses URL hosts; forbid URL delimiters before conversion.
  if (!rawDomain || /[\s/:\\?#@%\[\]]/.test(rawDomain)) return { valid: false };
  const domain = domainToASCII(rawDomain).toLowerCase();
  const labels = domain.split(".");
  if (domain.length > 253 || labels.length < 2 || !labels.every(label => LABEL.test(label)) || /^\d+$/.test(labels.at(-1)!)) return { valid: false };
  if ([...RESERVED_DOMAINS, ...DISPOSABLE_DOMAINS].some(blocked => domain === blocked || domain.endsWith(`.${blocked}`))) return { valid: false };
  const email = `${local}@${domain}`;
  return email.length <= 254 ? { valid: true, email, domain } : { valid: false };
}
