export type DownloadEdition = "code" | "full";

// These public aliases are release-managed. A request can select an edition,
// never a host, path, version, or arbitrary URL.
const downloads = {
  code: { edition: "code", name: "DuckTerm Code", bundle: "DuckTerm Code.app", url: "https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-Code-macos-arm64.zip" },
  full: { edition: "full", name: "DuckTerm Full", bundle: "DuckTerm.app", url: "https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-Full-macos-arm64.zip" },
} as const;

export function publicDownload(edition: unknown) {
  return edition === "code" || edition === "full" ? downloads[edition] : null;
}
