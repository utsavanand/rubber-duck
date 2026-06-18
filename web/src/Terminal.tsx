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
    // Focus xterm's hidden input directly. term.focus() alone proved unreliable
    // on mount (after selecting an agent, focus stayed on <body>, so keystrokes
    // went nowhere and you had to click the terminal first). Targeting the
    // helper textarea after the row-click settles makes the terminal typeable
    // the moment you select an agent.
    const focusTerm = () => {
      const ta = host.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
      if (ta && document.activeElement !== ta) ta.focus();
    };
    // Keep the terminal focused so you can type the moment you select an agent.
    // Two things fight us: (1) selecting an agent is a row click that settles
    // focus on <body> after this remounts; (2) xterm re-renders on every output
    // write, which blurs the helper textarea. So: focus now, and refocus whenever
    // focus leaves the terminal back to <body>/the pane (but NOT when it moves to
    // a real input, e.g. a modal — then leave it alone).
    focusTerm();
    const refocusOnBlur = (e: FocusEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      const leftToNowhere = !to || to === document.body || host.contains(to);
      if (leftToNowhere) setTimeout(focusTerm, 0);
    };
    host.addEventListener("focusout", refocusOnBlur);
    const focusOnClick = () => focusTerm();
    host.addEventListener("mousedown", focusOnClick);

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
      focusTerm();
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
      host.removeEventListener("focusout", refocusOnBlur);
      host.removeEventListener("mousedown", focusOnClick);
      onData.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionKey]);

  // height:0 + flex:1 makes the host fill the pane with a DEFINITE height, so
  // xterm scrolls its buffer internally instead of growing the page. (A
  // min-height here would let it expand and scroll the whole dashboard.)
  return (
    <div
      ref={hostRef}
      style={{ flex: 1, height: 0, minHeight: 0, background: "#0c0f16" }}
    />
  );
}
