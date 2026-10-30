import type { Storage } from "@google-cloud/storage";

type Release = { bucket: string; object: string; generation: string };

export function createDownloadLink(release: Release, storage: Storage, now: () => number = Date.now) {
  return async (): Promise<string> => {
    const filename = release.object.split("/").at(-1)!;
    if (!/^DuckTerm-Code-\d+\.\d+\.\d+-macos-arm64\.zip$/.test(filename) || !/^[1-9]\d*$/.test(release.generation)) throw new Error("Invalid download release");
    // Pin the signed link to an immutable object generation; a later release
    // cannot silently change the bytes behind an already emailed link.
    const [url] = await storage.bucket(release.bucket).file(release.object).getSignedUrl({
      version: "v4", action: "read", expires: now() + 24 * 60 * 60 * 1000,
      queryParams: { generation: release.generation },
      responseDisposition: `attachment; filename="${filename}"`,
      responseType: "application/zip",
    });
    return url;
  };
}
