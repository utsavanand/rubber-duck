import type { Metadata } from "next";
import DownloadPolicyPage from "../DownloadPolicyPage";

const title = "Download terms — DuckTerm";
const description = "Terms for requesting public DuckTerm download links on this website.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/download-terms" },
  openGraph: { title, description, type: "website", url: "https://duckterm.utsava.xyz/download-terms", siteName: "DuckTerm" },
  twitter: { card: "summary_large_image", title, description },
};

export default function Page() {
  return <DownloadPolicyPage title="Download terms">
    <p className="policy-intro">These terms cover DuckTerm’s free download form, operated by Utsav. It shows public DuckTerm Code and DuckTerm Full download links on this website. These terms do not replace the desktop software’s license.</p>
    <h2>Requesting a link</h2>
    <p>Submit your own email address, or one you have permission to use, and select an edition. A valid request shows a download link here. No email is sent and nothing downloads until you select the download button.</p>
    <p>The form does not verify ownership of an email address, create an account, grant private access, or subscribe you to a newsletter. You do not need to connect a Google account.</p>
    <p>Use the form for individual requests. Do not submit addresses in bulk, bypass rate limits, or disrupt the service. We may decline to save a request to prevent abuse. Public downloads remain available.</p>
    <h2>Downloads and software</h2>
    <p>The links point to public GitHub releases and may change as new releases are published. Providing a link is not a purchase or a promise of support or future features. DuckTerm software remains governed by the <a href="https://github.com/utsavanand/duckterm/blob/main/LICENSE">repository license</a>.</p>
    <h2>Availability</h2>
    <p>We do not guarantee continuous availability of this free form or third-party downloads. If we cannot save your request, the form can still offer the public download link. You can also visit <a href="https://github.com/utsavanand/duckterm/releases">GitHub releases</a> directly.</p>
    <h2>Privacy and contact</h2>
    <p><a href="/download-privacy">Download privacy</a> explains the 30-day expiry for saved email addresses, editions and request times, the separate quota records, and asynchronous deletion. Questions can be sent to <a href="mailto:getutsava@gmail.com">getutsava@gmail.com</a>. Updates to these terms will appear here with a revised date.</p>
  </DownloadPolicyPage>;
}
