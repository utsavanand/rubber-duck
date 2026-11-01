import type { Metadata } from "next";
import DownloadPolicyPage from "../DownloadPolicyPage";

const title = "Download email privacy — DuckTerm";
const description = "How DuckTerm Download Mail handles download requests, sent messages, and abuse-prevention data.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/download-privacy" },
  openGraph: { title, description, type: "website", url: "https://duckterm.utsava.xyz/download-privacy", siteName: "DuckTerm" },
  twitter: { card: "summary_large_image", title, description },
};

export default function Page() {
  return <DownloadPolicyPage title="Download email privacy">
    <p className="policy-intro">DuckTerm Download Mail is operated by Utsav. It emails public DuckTerm Code and DuckTerm Full download links on request. This policy covers that email service, not the desktop apps.</p>
    <h2>What we use</h2>
    <p>We process the email address you enter and the edition you select to check the address format and mail domain, prevent abuse, and send the requested link. Domain checks use DNS; they do not verify who owns an inbox.</p>
    <p>This form does not collect your desktop sessions, terminal content, source code, or AI conversations. Requesting a link does not create an account or subscribe you to a newsletter.</p>
    <h2>Abuse prevention and retention</h2>
    <p>The service processes your IP address for rate limiting. Google Cloud Firestore stores keyed hashes of email addresses and IP addresses, request timestamps, and expiry times. It does not store the raw email address or IP address in those rate-limit records. These identifiers are pseudonymous, not anonymous.</p>
    <p>Rate-limit windows last up to 24 hours. Records are marked to expire up to 24 hours after the latest counted request; automatic deletion is asynchronous and can happen later. Continued requests can extend a record’s expiry.</p>
    <h2>Delivery and hosting</h2>
    <p>The raw email address is handled during the request and sent to Google’s Gmail service to deliver the message. Sent-message copies, including the recipient address and message, remain in the sender’s Gmail mailbox until deleted. This service has no automatic deletion schedule for those mailbox copies. Your email provider also receives and stores the message.</p>
    <p>Vercel hosts the website and processes request metadata such as IP address, browser information, request time, path, and response status. Google, Vercel, and your email provider have their own retention practices. See <a href="https://policies.google.com/privacy">Google’s privacy policy</a> and <a href="https://vercel.com/legal/privacy-notice">Vercel’s privacy notice</a>.</p>
    <h2>Google access</h2>
    <p>Only the operator authorizes the sender’s Gmail account. Visitors do not sign in with Google or grant access to their accounts. The service uses Gmail send-only permission to send these download emails; it does not read the sender’s inbox or contacts. Sender authorization is kept in server-side configuration and can be revoked through the sender’s Google Account permissions.</p>
    <p>Our use of Google API data follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
    <h2>Choices and contact</h2>
    <p>The download links are public GitHub release links, not personal access tokens. You can download directly from <a href="https://github.com/utsavanand/duckterm/releases">GitHub releases</a> without using this email form. If you receive an email you did not request, you can ignore it.</p>
    <p>For questions about this service, or to request deletion of download-related messages or records held by the operator, contact <a href="mailto:getutsava@gmail.com">getutsava@gmail.com</a>. We cannot delete copies held by your email provider. Updates to this policy will appear here with a revised date.</p>
  </DownloadPolicyPage>;
}
