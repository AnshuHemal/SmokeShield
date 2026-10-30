import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, CameraState, Label } from "../lib/api";

export interface IncidentEvent {
  seq: number;
  type: "incident";
  incident: { id: number; label: Label; confidence: number; camera_id: number; camera_name: string; created_at: string };
}

interface EventsContextValue {
  states: Record<number, CameraState>;
  connected: boolean;
  /** Subscribe to new-incident events; returns an unsubscribe function. */
  onIncident: (cb: (e: IncidentEvent) => void) => () => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

/** One shared WebSocket to /ws/events: live camera states + incident notifications, auto-reconnecting. */
export function EventsProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<number, CameraState>>({});
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(e: IncidentEvent) => void>());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(api.eventsUrl());
      ws.onopen = () => setConnected(true);
      ws.onmessage = (msg) => {
        const data: { cameras: CameraState[]; events: IncidentEvent[] } = JSON.parse(msg.data);
        setStates(Object.fromEntries(data.cameras.map((c) => [c.id, c])));
        data.events.forEach((e) => listeners.current.forEach((cb) => cb(e)));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const onIncident = useCallback((cb: (e: IncidentEvent) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const value = useMemo(() => ({ states, connected, onIncident }), [states, connected, onIncident]);
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useEvents() {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useEvents must be used inside <EventsProvider>");
  return ctx;
}
