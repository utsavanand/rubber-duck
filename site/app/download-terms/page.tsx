import type { Metadata } from "next";
import DownloadPolicyPage from "../DownloadPolicyPage";

const title = "Download email terms — DuckTerm";
const description = "Terms for requesting public DuckTerm download links by email.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/download-terms" },
  openGraph: { title, description, type: "website", url: "https://duckterm.utsava.xyz/download-terms", siteName: "DuckTerm" },
  twitter: { card: "summary_large_image", title, description },
};

export default function Page() {
  return <DownloadPolicyPage title="Download email terms">
    <p className="policy-intro">These terms cover DuckTerm Download Mail, the free email service operated by Utsav for sending public DuckTerm Code and DuckTerm Full download links. They do not replace the desktop software’s license.</p>
    <h2>Requesting a link</h2>
    <p>Submit your own email address, or an address you have permission to use. A request asks us to send the selected download link to that address. It does not create an account, subscribe you to a newsletter, or grant private access. Visitors do not need to connect a Google account.</p>
    <p>Use the form for individual download requests. Do not use it to send unwanted messages, submit addresses in bulk, bypass rate limits, or disrupt the service. We may limit or block requests to prevent abuse.</p>
    <h2>Downloads and software</h2>
    <p>The emailed links point to public GitHub release downloads and may change as new releases are published. The email is a convenience, not a purchase or a promise of support or future features. DuckTerm software remains governed by the license in its repository: <a href="https://github.com/utsavanand/duckterm/blob/main/LICENSE">repository license</a>.</p>
    <h2>Availability</h2>
    <p>Email may be delayed, filtered, or fail to arrive. We do not guarantee delivery or continuous availability of this free email service. The form may be changed, paused, or discontinued. Public releases can also be found at <a href="https://github.com/utsavanand/duckterm/releases">GitHub releases</a>.</p>
    <h2>Privacy and contact</h2>
    <p>The download email privacy policy at <a href="/download-privacy">/download-privacy</a> explains how requests and sent messages are handled. Questions or unwanted download emails can be reported to <a href="mailto:getutsava@gmail.com">getutsava@gmail.com</a>. Updates to these service terms will appear here with a revised date.</p>
  </DownloadPolicyPage>;
}
