import type {Request, Response} from "express";

export interface ServiceEvent {
  ts: number;
  source: string;
  type: string;
  message: string;
  data?: unknown;
}

export class EventHub {
  private clients = new Set<Response>();
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  handler = (req: Request, res: Response): void => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.flushHeaders();
    res.write(": connected\n\n");
    this.clients.add(res);
    req.on("close", () => this.clients.delete(res));
  };

  emit(type: string, message: string, data?: unknown): ServiceEvent {
    return this.relay({ts: Date.now(), source: this.source, type, message, data});
  }

  relay(event: ServiceEvent): ServiceEvent {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(frame);
    return event;
  }
}
