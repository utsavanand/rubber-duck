import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// A real terminal for a launched session: xterm.js over the
// /sessions/:key/terminal WebSocket. Raw PTY bytes stream in as binary frames
// and render with full ANSI/cursor support; keystrokes go back as binary
// frames; resize goes back as a text JSON control message. This is the
// terminal-forward surface — the agent's TUI (claude, codex) renders here as
// it would in iTerm.
//
// The WS is a GET, so it rides the same 127.0.0.1 loopback gate as the rest of
// the GET API — no token needed (only state-changing POSTs are token-gated).
export function Terminal({ sessionKey }: { sessionKey: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Xterm({
      fontSize: 12,
      fontFamily: "ui-monospace, Menlo, monospace",
      theme: { background: "#0c0f16", foreground: "#d1d5db" },
      cursorBlink: true,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/sessions/${sessionKey}/terminal`,
    );
    ws.binaryType = "arraybuffer";

    const sendResize = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
    };

    ws.onopen = () => {
      fit.fit();
      sendResize();
    };
    ws.onmessage = (ev) => {
      // Raw PTY bytes. xterm's write() takes a Uint8Array and decodes UTF-8
      // itself — passing bytes (not a decoded string) keeps multi-byte
      // sequences split across frames intact.
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };

    // User keystrokes -> agent stdin, verbatim (arrows, ctrl-C, partial input).
    const onData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(new TextEncoder().encode(data));
    });

    // Reflow the agent's TUI when the pane resizes.
    const observer = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      onData.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionKey]);

  return (
    <div
      ref={hostRef}
      style={{ flex: 1, minHeight: 320, background: "#0c0f16" }}
    />
  );
}
