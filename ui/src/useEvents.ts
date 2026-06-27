import { useEffect, useState } from "react";
import { api } from "./api";
import type { StreamEvent } from "./types";

const MAX_EVENTS = 80;

export function useEvents(): StreamEvent[] {
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      source = new EventSource(api.eventsUrl());

      source.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as StreamEvent;
          const event: StreamEvent = {
            ...parsed,
            ts: parsed.ts ?? Date.now(),
          };
          setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
        } catch {
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        retry = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);

  return events;
}
