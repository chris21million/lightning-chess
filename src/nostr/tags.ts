import type { Event as NostrEvent } from "nostr-tools";
import { TOPIC_TAG } from "./constants";

type Offer = {
  id: string;
  pubkey: string;
  created_at: number;
  offerId: string;
  time: number;
  inc: number;
  color: "white" | "black" | "random";
};

export function tagValue(ev: NostrEvent, name: string): string | null {
  const t = ev.tags.find((x) => x[0] === name);
  return t?.[1] ?? null;
}

export function tagValues(ev: NostrEvent, name: string): string[] {
  return ev.tags.filter((x) => x[0] === name).map((x) => x[1]).filter(Boolean);
}

export function parseOffer(ev: NostrEvent): Offer | null {
  const topics = tagValues(ev, "t");
  

  const offerId = tagValue(ev, "d") ?? ev.id;
  const time = Number(tagValue(ev, "time") ?? "60");
  const inc = Number(tagValue(ev, "inc") ?? "0");
  const colorRaw = (tagValue(ev, "color") ?? "random").toLowerCase();

  const color =
    colorRaw === "white" || colorRaw === "black" || colorRaw === "random"
      ? (colorRaw as Offer["color"])
      : "random";

  if (!Number.isFinite(time) || time <= 0) return null;
  if (!Number.isFinite(inc) || inc < 0) return null;

  return { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, offerId, time, inc, color };
}
