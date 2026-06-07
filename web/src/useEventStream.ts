import { useEffect, useReducer, useState } from "react";
import { applyEvent } from "./sessions";
import {
  PersistedSession,
  RubberduckEvent,
  SessionView,
  viewFromPersisted,
} from "./types";

type InitFrame = { type: "init"; events: RubberduckEvent[] };

type Action =
  | { kind: "seed"; sessions: PersistedSession[] }
  | { kind: "event"; event: RubberduckEvent }
  | { kind: "remove"; keys: string[] };

function isInit(data: unknown): data is InitFrame {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as InitFrame).type === "init"
  );
}

function reduce(
  state: Map<string, SessionView>,
  action: Action,
): Map<string, SessionView> {
  if (action.kind === "seed") {
    const next = new Map(state);
    for (const s of action.sessions) {
      // Persisted history is the baseline; live events already applied win.
      if (!next.has(s.session_key))
        next.set(s.session_key, viewFromPersisted(s));
    }
    return next;
  }
  if (action.kind === "remove") {
    const next = new Map(state);
    for (const key of action.keys) next.delete(key);
    return next;
  }
  return applyEvent(state, action.event);
}

export function useEventStream(): {
  sessions: SessionView[];
  connected: boolean;
  removeSessions: (keys: string[]) => void;
} {
  const [sessions, dispatch] = useReducer(
    reduce,
    new Map<string, SessionView>(),
  );
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/sessions")
      .then((r) => r.json())
      .then((data: { sessions: PersistedSession[] }) => {
        if (!cancelled) dispatch({ kind: "seed", sessions: data.sessions });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      const data: unknown = JSON.parse(msg.data);
      if (isInit(data)) {
        data.events.forEach((event) => dispatch({ kind: "event", event }));
      } else {
        dispatch({ kind: "event", event: data as RubberduckEvent });
      }
    };
    return () => source.close();
  }, []);

  // Stable order: newest session first by START time, which never changes —
  // so cards don't reshuffle (and buttons don't move) as events stream in.
  const list = [...sessions.values()].sort(
    (a, b) => b.startedAt - a.startedAt || a.key.localeCompare(b.key),
  );
  const removeSessions = (keys: string[]) => dispatch({ kind: "remove", keys });
  return { sessions: list, connected, removeSessions };
}
