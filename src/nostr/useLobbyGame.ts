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
  const activeGameIdRef = useRef<string | null>(null);

  const [relayStatus, setRelayStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [offers, setOffers] = useState<Offer[]>([]);

  // Offer creation settings
  const [offerSeconds, setOfferSeconds] = useState(60);
  const [offerInc, setOfferInc] = useState(0);
  const [offerColor, setOfferColor] = useState<Offer["color"]>("random");

  // Challenge specific player
  const [challengeNpub, setChallengeNpub] = useState("");
  const [isChallenging, setIsChallenging] = useState(false);

  const [game, setGame] = useState<Game | null>(null);

  // 1. Offers subscription
  useEffect(() => {
    if (!pubkey) {
      setOffers([]);
      setRelayStatus("disconnected");
      activeGameIdRef.current = null;
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

          console.log("🎉 New offer received from", shortKey(ev.pubkey), "id:", ev.id?.slice(0, 8));

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
      try {
        sub.close();
        pool.close(RELAYS);
      } catch (e) {
        console.warn("Error closing offer subscription", e);
      }
      poolRef.current = null;
      setRelayStatus("disconnected");
    };
  }, [pubkey]);

  // 2. Create public offer (visible to everyone)
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
      await Promise.any(poolRef.current!.publish(RELAYS, signed));
      alert("Offer published to the lobby!");
    } catch (e: any) {
      console.error(e);
      alert(`Failed to publish offer: ${e?.message ?? e}`);
    }
  }, [pubkey, offerSeconds, offerInc, offerColor, signEvent]);

  // 3. Challenge specific npub (new feature inspired by ChessNut)
  const challengePlayer = useCallback(async () => {
    if (!pubkey || !poolRef.current) return alert("Login first");
    if (!challengeNpub.trim()) return alert("Please paste an npub");

    const targetNpub = challengeNpub.trim();
    setIsChallenging(true);

    try {
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
          ["p", targetNpub],           // Target specific player
        ],
        content: `Challenge: Lightning Chess ${offerSeconds}s + ${offerInc}s`,
      };

      const signed = await signEvent(draft);
      await Promise.any(poolRef.current!.publish(RELAYS, signed));

      alert(`Challenge sent to ${shortKey(targetNpub)}!`);
      setChallengeNpub(""); // Clear input after success
    } catch (e: any) {
      console.error("Challenge failed:", e);
      alert(`Failed to send challenge: ${e?.message ?? e}`);
    } finally {
      setIsChallenging(false);
    }
  }, [pubkey, challengeNpub, offerSeconds, offerInc, offerColor, signEvent]);

  // 4. Accept Offer
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
        if (!poolRef.current) throw new Error("No relay pool");

        await Promise.any(poolRef.current.publish(RELAYS, signed));

        // Reset local game state
        gameRef.current?.reset?.();
        lastPlyRef.current = 0;
        lastMoveEventIdRef.current = "none";
        forceUpdate();

        activeGameIdRef.current = gameId;

        setGame({ gameId, offerEventId: offer.id, white, black, time: offer.time, inc: offer.inc });
        alert("Game started! You are now playing.");
      } catch (e: any) {
        console.error("❌ Accept failed:", e);
        alert(`Failed to accept offer: ${e?.message ?? e}`);
      }
    },
    [pubkey, signEvent, forceUpdate, gameRef, lastPlyRef, lastMoveEventIdRef]
  );

  // 5. Listen for ACCEPT events
  useEffect(() => {
    if (!pubkey || !poolRef.current) return;

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
          const gameId = tagValue(ev, "d");
          const white = tagValue(ev, "white");
          const black = tagValue(ev, "black");
          const time = Number(tagValue(ev, "time") || 0);
          const inc = Number(tagValue(ev, "inc") || 0);
          const offerEventId = tagValue(ev, "e") || "";

          if (!gameId || !white || !black) return;

          if (activeGameIdRef.current === gameId) return;

          gameRef.current?.reset?.();
          lastPlyRef.current = 0;
          lastMoveEventIdRef.current = "none";
          forceUpdate();

          activeGameIdRef.current = gameId;
          setGame({ gameId, offerEventId, white, black, time, inc });
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  }, [pubkey]);

  // 6. Leave Game
  const leaveGame = useCallback(() => {
    console.log("🚪 Leaving current game...");

    activeGameIdRef.current = null;
    setGame(null);
    gameRef.current?.reset?.();
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

    // Challenge feature
    challengeNpub,
    setChallengeNpub,
    isChallenging,
    challengePlayer,

    game,
    createOffer,
    acceptOffer,
    leaveGame,
  };
}