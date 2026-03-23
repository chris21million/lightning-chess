import { useCallback, useEffect, useRef, useState } from "react";
import { SimplePool, type EventTemplate } from "nostr-tools";
import { randomId } from "../utils/id";
import { shortKey } from "../utils/format";
import { RELAYS, TOPIC_TAG, OFFER_KIND, ACCEPT_KIND } from "./constants";
import { parseOffer, tagValue } from "./tags";
import type { Game, Offer } from "./types";

type UseLobbyGameArgs = {
  pubkey: string | null;
  signEvent: (draft: EventTemplate) => Promise<any>;
  gameRef: React.MutableRefObject<any>;
  lastPlyRef: React.MutableRefObject<number>;
  lastMoveEventIdRef: React.MutableRefObject<string>;
  forceUpdate: () => void;
};

export function useLobbyGame({
  pubkey,
  signEvent,
  gameRef,
  lastPlyRef,
  lastMoveEventIdRef,
  forceUpdate,
}: UseLobbyGameArgs) {
  const poolRef = useRef<SimplePool | null>(null);

  const [relayStatus, setRelayStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerSeconds, setOfferSeconds] = useState(60);
  const [offerInc, setOfferInc] = useState(0);
  const [offerColor, setOfferColor] = useState<Offer["color"]>("random");
  const [game, setGame] = useState<Game | null>(null);

  // 1. Offers subscription
  useEffect(() => {
    if (!pubkey) {
      setOffers([]);
      setRelayStatus("disconnected");
      return;
    }

    const pool = new SimplePool();
    poolRef.current = pool;
    setRelayStatus("connecting");

    console.log(`🔌 Subscribing to offers as ${shortKey(pubkey)}`);

    const sub = pool.subscribeMany(
      RELAYS,
      {
        kinds: [OFFER_KIND],
        "#t": [TOPIC_TAG],
        since: Math.floor(Date.now() / 1000),
        limit: 100,
      },
      {
        onevent(ev) {
          const offer = parseOffer(ev);
          if (!offer) return;
          console.log("🎉 New offer received from", shortKey(ev.pubkey), "id:", ev.id?.slice(0,8));

          setOffers((prev) => {
            if (prev.some((x) => x.id === offer.id)) return prev;
            return [offer, ...prev].sort((a, b) => b.created_at - a.created_at).slice(0, 50);
          });
          setRelayStatus("connected");
        },
        oneose() {
          setRelayStatus("connected");
        },
      }
    );

    return () => {
      try { sub.close(); pool.close(RELAYS); } catch {}
      poolRef.current = null;
      setRelayStatus("disconnected");
    };
  }, [pubkey]);

  // 2. Create Offer
  const createOffer = useCallback(async () => {
    if (!pubkey || !poolRef.current) return alert("Login first");

    const offerId = randomId(12);

    const draft: EventTemplate = {
      kind: OFFER_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", offerId],
        ["t", TOPIC_TAG],
        ["time", String(offerSeconds)],
        ["inc", String(offerInc)],
        ["color", offerColor],
        ["p", pubkey],
      ],
      content: `Lightning Chess ${offerSeconds}s + ${offerInc}s`,
    };

    try {
      const signed = await signEvent(draft);
      const pool = poolRef.current;
      console.log("📤 Publishing offer...");
      await Promise.any(pool.publish(RELAYS, signed));
      alert("Offer published! Check the other tab.");
    } catch (e: any) {
      console.error(e);
      alert(`Failed to publish offer: ${e?.message ?? e}`);
    }
  }, [pubkey, offerSeconds, offerInc, offerColor, signEvent]);

  // 3. Accept Offer - with heavy logging
  const acceptOffer = useCallback(
    async (offer: Offer) => {
      console.log("🔘 Accept button clicked for offer:", offer.id);

      if (!pubkey) return alert("Login first");
      if (pubkey === offer.pubkey) return alert("That is your own offer.");

      const gameId = randomId(14);

      let white = "";
      let black = "";
      if (offer.color === "white") {
        white = offer.pubkey;
        black = pubkey;
      } else if (offer.color === "black") {
        black = offer.pubkey;
        white = pubkey;
      } else {
        white = pubkey;
        black = offer.pubkey;
      }

      const draft: EventTemplate = {
        kind: ACCEPT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", offer.id],
          ["p", offer.pubkey],
          ["d", gameId],
          ["white", white],
          ["black", black],
          ["time", String(offer.time)],
          ["inc", String(offer.inc)],
        ],
        content: "",
      };

      try {
        const signed = await signEvent(draft);
        const pool = poolRef.current;
        if (!pool) throw new Error("No relay pool");

        console.log("📤 Publishing ACCEPT event...");
        await Promise.any(pool.publish(RELAYS, signed));
        console.log("✅ ACCEPT event published successfully");

        // Reset local game
        gameRef.current.reset();
        lastPlyRef.current = 0;
        lastMoveEventIdRef.current = "none";
        forceUpdate();

        setGame({ gameId, offerEventId: offer.id, white, black, time: offer.time, inc: offer.inc });
        alert("Game started! You are now playing.");
      } catch (e: any) {
        console.error("❌ Accept failed:", e);
        alert(`Failed to accept offer: ${e?.message ?? e}`);
      }
    },
    [pubkey, signEvent, forceUpdate, gameRef, lastPlyRef, lastMoveEventIdRef]
  );

  // 4. Listen for ACCEPT events (the receiver side)
  useEffect(() => {
    if (!pubkey || !poolRef.current) return;

    console.log("👂 Starting ACCEPT subscription for", shortKey(pubkey));

    const sub = poolRef.current.subscribeMany(
      RELAYS,
      {
        kinds: [ACCEPT_KIND],
        "#p": [pubkey],
        since: Math.floor(Date.now() / 1000) - 300,
        limit: 20,
      },
      {
        onevent(ev) {
          console.log("📥 RECEIVED ACCEPT EVENT!", ev.id?.slice(0,8));

          const gameId = tagValue(ev, "d");
          const white = tagValue(ev, "white");
          const black = tagValue(ev, "black");
          const time = Number(tagValue(ev, "time") || 0);
          const inc = Number(tagValue(ev, "inc") || 0);

          if (!gameId || !white || !black) {
            console.log("❌ Invalid accept event");
            return;
          }

          if (game) {
            console.log("🛡️ Already in a game, ignoring");
            return;
          }

          console.log("🎉 Starting game from received accept!");

          gameRef.current.reset();
          lastPlyRef.current = 0;
          lastMoveEventIdRef.current = "none";
          forceUpdate();

          setGame({ gameId, offerEventId: tagValue(ev, "e") || "", white, black, time, inc });
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  }, [pubkey, game, forceUpdate, gameRef, lastPlyRef, lastMoveEventIdRef]);

  const leaveGame = useCallback(() => {
    setGame(null);
    gameRef.current.reset();
    lastPlyRef.current = 0;
    lastMoveEventIdRef.current = "none";
    forceUpdate();
  }, [forceUpdate, gameRef, lastPlyRef, lastMoveEventIdRef]);

  return {
    poolRef,
    relayStatus,
    offers,
    offerSeconds,
    setOfferSeconds,
    offerInc,
    setOfferInc,
    offerColor,
    setOfferColor,
    game,
    createOffer,
    acceptOffer,
    leaveGame,
  };
}