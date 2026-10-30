"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

const sentMessage = "Check your inbox for the download link. It expires in 24 hours. If it hasn’t arrived, check your spam folder.";
const unavailableMessage = "We couldn’t send the download link. Please try again shortly.";

export default function CodeDownloadForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const website = useRef<HTMLInputElement>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setState("sending");
    setMessage("Sending your download link…");
    setInvalid(false);
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/code-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website: website.current?.value ?? "" }),
        signal: controller.signal,
        cache: "no-store",
      });
      const result = await response.json();
      if (response.ok && result?.ok === true) {
        setState("sent");
        setMessage(sentMessage);
      } else {
        setState("error");
        setInvalid(response.status === 400);
        setMessage(response.status === 400 ? "Enter a valid email address." : response.status === 429 ? "Too many requests. Please try again later." : unavailableMessage);
      }
    } catch {
      setState("error");
      setMessage(unavailableMessage);
    } finally {
      clearTimeout(timeout);
      inFlight.current = null;
    }
  }

  return <form className="ed-code-form" onSubmit={submit} aria-busy={state === "sending"}>
    <label htmlFor="code-email">Email address</label>
    <div className="ed-code-fields">
      <input id="code-email" type="email" name="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={event => { setEmail(event.target.value); setState("idle"); setMessage(""); setInvalid(false); }} readOnly={state === "sending"} required maxLength={254} aria-invalid={invalid || undefined} aria-describedby="code-email-note code-email-status"/>
      <button className="ed-primary" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email download link"}</button>
    </div>
    <div className="ed-code-honeypot" aria-hidden="true"><label htmlFor="code-website">Leave this field empty</label><input id="code-website" name="website" type="text" autoComplete="off" tabIndex={-1} ref={website}/></div>
    <p id="code-email-note" className="ed-availability">macOS 13+ · Apple silicon<br/>We’ll email a download link valid for 24 hours. No newsletter signup.</p>
    <p id="code-email-status" className="ed-code-status" role={state === "error" ? "alert" : "status"}>{message}</p>
  </form>;
}
