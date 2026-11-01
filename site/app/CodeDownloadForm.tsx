"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { publicDownload, type DownloadEdition } from "../lib/code-download/download-link.ts";

export default function DownloadForm({ edition }: { edition: DownloadEdition }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "ready" | "error" | "fallback">("idle");
  const [message, setMessage] = useState("");
  const inFlight = useRef<AbortController | null>(null);
  const website = useRef<HTMLInputElement>(null);
  const download = publicDownload(edition)!;
  useEffect(() => () => inFlight.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setState("saving"); setMessage("Preparing your download link…");
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/code-download", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website: website.current?.value ?? "", edition }), signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (response.ok && result?.ok === true) { setState("ready"); setMessage("Your download is ready."); }
      else if (response.status === 400) { setState("error"); setMessage("Enter a valid email address."); }
      else { setState("fallback"); setMessage("We couldn’t save your request. You can still download below."); }
    } catch { setState("fallback"); setMessage("We couldn’t save your request. You can still download below."); }
    finally { clearTimeout(timeout); inFlight.current = null; }
  }

  return <form className="ed-code-form" onSubmit={submit} aria-busy={state === "saving"}>
    {state !== "ready" && <>
      <label htmlFor={`${edition}-email`}>Email address</label>
      <div className="ed-code-fields">
        <input id={`${edition}-email`} type="email" name="email" autoComplete="email" placeholder="you@company.com" value={email}
          onChange={event => { setEmail(event.target.value); setState("idle"); setMessage(""); }}
          readOnly={state === "saving"} required maxLength={254} aria-invalid={state === "error" || undefined} aria-describedby={`${edition}-email-note ${edition}-email-status`}/>
        <button className="ed-primary" type="submit" disabled={state === "saving"}>{state === "saving" ? "Preparing…" : "Get download link"}</button>
      </div>
    </>}
    <div className="ed-code-honeypot" aria-hidden="true"><label htmlFor={`${edition}-website`}>Leave this field empty</label><input id={`${edition}-website`} name="website" type="text" autoComplete="off" tabIndex={-1} ref={website}/></div>
    <p id={`${edition}-email-status`} className="ed-code-status" role={state === "error" || state === "fallback" ? "alert" : "status"}>{message}</p>
    {(state === "ready" || state === "fallback") && <a className="ed-primary ed-download-result" href={download.url}>Download {download.name} for Mac <span aria-hidden="true">↙</span></a>}
    <p id={`${edition}-email-note`} className="ed-availability">macOS 13+ · Apple silicon{state !== "ready" && state !== "fallback" && <><br/>We keep your email for 30 days after each request.</>}</p>
  </form>;
}
