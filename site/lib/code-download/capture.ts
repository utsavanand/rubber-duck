import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { validateEmail } from "./email.ts";
import { publicDownload, type DownloadEdition } from "./download-link.ts";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Called only after verified-human and quota checks. A random document ID
// avoids putting an address in paths, URLs or diagnostics. The operator can
// inspect these records in the private Firestore console; there is no read API.
export function createDownloadRecorder(database: Firestore, clock: () => number = Date.now) {
  return async (request: { email: string; edition: DownloadEdition }): Promise<void> => {
    const email = validateEmail(request.email);
    const download = publicDownload(request.edition);
    const now = clock();
    if (!email.valid || !download || !Number.isSafeInteger(now) || now < 0) throw new Error("Download record unavailable");
    await database.collection("ducktermDownloadRequests").doc().create({
      version: 1,
      email: email.email,
      edition: download.edition,
      requestedAt: Timestamp.fromMillis(now),
      expireAt: Timestamp.fromMillis(now + RETENTION_MS),
    });
  };
}
