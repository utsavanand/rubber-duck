import { landingHtml } from "./landing";
import DemoPlayback from "./DemoPlayback";

// Refresh the wheel URL after releases without hardcoding another version.
export const revalidate = 300;

async function cliInstallCommand(): Promise<string> {
  try {
    const response = await fetch("https://api.github.com/repos/utsavanand/duckterm/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Release lookup failed");
    const release = await response.json();
    const asset = release.assets?.find((item: { browser_download_url?: string }) =>
      /^https:\/\/github\.com\/utsavanand\/duckterm\/releases\/download\/v[0-9A-Za-z.-]+\/duckterm-[0-9A-Za-z_.-]+\.whl$/.test(item.browser_download_url ?? ""));
    if (asset) return `pipx install ${asset.browser_download_url}`;
  } catch { /* Keep the release link usable when GitHub is unavailable. */ }
  return "# Open Download the latest release and download its .whl file.\n# Install that file with pipx install followed by its path.";
}

export default async function Home() {
  return <><main dangerouslySetInnerHTML={{ __html: landingHtml.replace("{{CLI_INSTALL}}", await cliInstallCommand()) }} /><DemoPlayback /></>;
}
