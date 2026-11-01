import type { Metadata } from "next";
import DownloadPolicyPage from "../DownloadPolicyPage";

const title = "Download privacy — DuckTerm";
const description = "How DuckTerm handles download requests and abuse-prevention data.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/download-privacy" },
  openGraph: { title, description, type: "website", url: "https://duckterm.utsava.xyz/download-privacy", siteName: "DuckTerm" },
  twitter: { card: "summary_large_image", title, description },
};

export default function Page() {
  return <DownloadPolicyPage title="Download privacy">
    <p className="policy-intro">DuckTerm’s download form is operated by Utsav. It shows public DuckTerm Code and DuckTerm Full download links on this website. This policy covers the website’s download form, not the desktop apps.</p>
    <h2>What we collect</h2>
    <p>When a request passes validation and abuse checks, we store the email address you enter, the edition you select, and the request time in Google Cloud Firestore. We use these records to keep a record of download requests and prevent abuse. We do not use them for a newsletter.</p>
    <p>We check email syntax and the mail domain using DNS. These checks do not verify that you own the address. The form does not create an account, send email, or request access to your Google account, inbox, or contacts.</p>
    <p>The form does not collect your desktop sessions, terminal content, source code, or AI conversations.</p>
    <h2>Download request retention</h2>
    <p>Each saved request is marked to expire 30 days after the request. Google Cloud Firestore’s automatic deletion runs asynchronously, so removal can happen after that expiry time. If you submit again, data saved for that request is subject to a new 30-day expiry.</p>
    <h2>Abuse prevention</h2>
    <p>The service processes your IP address for rate limiting. Separate Google Cloud Firestore records hold keyed hashes (HMACs) of email addresses and IP addresses, request timestamps, and expiry times. Those quota records do not contain the raw email address or IP address. They are pseudonymous, not anonymous.</p>
    <p>Quota windows last up to 24 hours. Quota records are marked to expire up to 24 hours after the latest counted request; automatic deletion is asynchronous and can happen later. Further counted requests can extend that expiry.</p>
    <p>Vercel hosts the website. Vercel and its BotID protection process request and browser metadata to operate the site and distinguish automated traffic, including IP address, browser information, request time, path, and response status. Google and Vercel have their own retention practices. See <a href="https://policies.google.com/privacy">Google’s privacy policy</a> and <a href="https://vercel.com/legal/privacy-notice">Vercel’s privacy notice</a>.</p>
    <h2>Your download and your choices</h2>
    <p>The download links are public GitHub release links, not personal access tokens. A download link can still be shown if a valid request is not saved, including when abuse checks, quota limits, or service availability prevent collection. A ready link does not confirm that an email address was saved.</p>
    <p>You can also download from <a href="https://github.com/utsavanand/duckterm/releases">GitHub releases</a> without using the form. For questions or to request deletion of records held by the operator, contact <a href="mailto:getutsava@gmail.com">getutsava@gmail.com</a>.</p>
    <h2>Earlier email pilot</h2>
    <p>Gmail delivery is paused. Any test messages sent during the earlier email pilot, including their recipient addresses, remain in the sender’s Gmail mailbox until deleted; there is no automatic deletion schedule for those copies. Recipients’ email providers may retain their own copies. The earlier pilot used send-only permission and did not read inboxes or contacts.</p>
    <p>Updates to this policy will appear here with a revised date.</p>
  </DownloadPolicyPage>;
}
