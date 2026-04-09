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

  const [relayStatus, setRelayStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  const [offers, setOffers] = useState<Offer[]>([]);

  const [offerSeconds, setOfferSeconds] = useState(60);
  const [offerInc, setOfferInc] = useState(0);
  const [offerColor, setOfferColor] = useState<Offer["color"]>("random");

  const [challengeNpub, setChallengeNpub] = useState("");
  const [isChallenging, setIsChallenging] = useState(false);

  const [game, setGame] = useState<Game | null>(null);
  const [myOfferEventId, setMyOfferEventId] = useState<string | null>(null);

  // ==================== SUBSCRIPTIONS ====================
  useEffect(() => {
    setOffers([]);

    if (!pubkey) {
      if (poolRef.current) {
        try { poolRef.current.close(RELAYS); } catch {}
        poolRef.current = null;
      }
      setRelayStatus("disconnected");
      activeGameIdRef.current = null;
      return;
    }

    const pool = new SimplePool();
    poolRef.current = pool;

    setRelayStatus("connecting");
    console.log(`🔌 Subscribing as ${shortKey(pubkey)}`);

    const since = Math.floor(Date.now() / 1000) - 3600;

    // ===== OFFERS =====
    const offerSub = pool.subscribeMany(
      RELAYS,
      [
        {
          kinds: [OFFER_KIND],
          "#t": [TOPIC_TAG],
          since,
        },
      ],
      {
        onevent(ev) {
          console.log("📨 Raw offer event:", ev);
          const offer = parseOffer(ev);
          console.log("📋 Parsed offer:", offer);
          if (!offer) return;

          setOffers(prev => {
            if (prev.find(o => o.id === offer.id)) return prev;
            return [offer, ...prev];
          });
        },
        oneose() {
          console.log("✅ Offers EOSE");
          setRelayStatus("connected");
        },
      }
    );

    // ===== ACCEPTS =====
    const acceptSub = pool.subscribeMany(
      RELAYS,
      [
        {
          kinds: [ACCEPT_KIND],
          "#p": [pubkey],
          since: Math.floor(Date.now() / 1000) - 30, // ← only last 30 seconds
        },
      ],
      {
        onevent(ev) {
          console.log("📨 Accept received!", ev);
          console.log("activeGameId:", activeGameIdRef.current);
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

          setGame({
            gameId,
            offerEventId,
            white,
            black,
            time,
            inc,
          });

          alert("Your offer was accepted! Game started.");
        },
      }
    );

    return () => {
      try { offerSub.close(); } catch {}
      try { acceptSub.close(); } catch {}
      try { pool.close(RELAYS); } catch {}
      poolRef.current = null;
      setRelayStatus("disconnected");
    };
  }, [pubkey, forceUpdate, gameRef, lastPlyRef, lastMoveEventIdRef]);

  // ==================== PUBLISH HELPER ====================
  const publish = async (pool: SimplePool, event: any) => {
    try {
      await Promise.any(pool.publish(RELAYS, event));
      console.log("✅ published");
    } catch (e) {
      console.log("❌ publish error", e);
      throw e;
    }
  };

  // ==================== CREATE OFFER ====================
  const createOffer = useCallback(async () => {
    if (!pubkey) return alert("Login first");

    const pool = poolRef.current;
    if (!pool) return alert("Not connected yet");

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
      await publish(pool, signed);
      setMyOfferEventId(signed.id);

      alert("Offer published!");
    } catch (e: any) {
      console.error(e);
      alert(e.message);
    }
  }, [pubkey, offerSeconds, offerInc, offerColor, signEvent]);

  // ==================== CANCEL OFFER ====================
const cancelOffer = useCallback(async (offerEventId: string) => {
  if (!pubkey) return;
  const pool = poolRef.current;
  if (!pool) return;

  const draft: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["e", offerEventId]],
    content: "offer cancelled",
  };

  try {
    const signed = await signEvent(draft);
    await publish(pool, signed);
    setMyOfferEventId(null);
    // remove from local list immediately so UI updates right away
    setOffers(prev => prev.filter(o => o.id !== offerEventId));
  } catch (e: any) {
    alert(e.message);
  }
}, [pubkey, signEvent]);

// ==================== CHALLENGE PLAYER ====================
const challengePlayer = useCallback(async () => {
  if (!pubkey) return alert("Login first");
  if (!challengeNpub.trim()) return alert("Paste an npub first");

  const pool = poolRef.current;
  if (!pool) return alert("Not connected");

  // convert npub to hex if needed
  let targetPubkey = challengeNpub.trim();
  if (targetPubkey.startsWith("npub1")) {
    try {
      const { nip19 } = await import("nostr-tools");
      const decoded = nip19.decode(targetPubkey);
      if (decoded.type !== "npub") return alert("Invalid npub");
      targetPubkey = decoded.data as string;
    } catch {
      return alert("Invalid npub format");
    }
  }

  const offerId = randomId(12);
  setIsChallenging(true);

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
      ["p", targetPubkey],   // ← this targets a specific player
      ["challenge", targetPubkey],
    ],
    content: `Chess challenge ${offerSeconds}s + ${offerInc}s`,
  };

  try {
    const signed = await signEvent(draft);
    await publish(pool, signed);
    setMyOfferEventId(signed.id);
    setChallengeNpub("");
    alert("Challenge sent!");
  } catch (e: any) {
    alert(e.message);
  } finally {
    setIsChallenging(false);
  }
}, [pubkey, challengeNpub, offerSeconds, offerInc, offerColor, signEvent]);

  // ==================== ACCEPT OFFER ====================
  const acceptOffer = useCallback(
    async (offer: Offer) => {
      if (!pubkey) return alert("Login first");
      if (pubkey === offer.pubkey) return;

      const pool = poolRef.current;
      if (!pool) return alert("Not connected");

      const gameId = randomId(14);

      const white =
        offer.color === "black" ? pubkey : offer.pubkey;

      const black =
        offer.color === "black" ? offer.pubkey : pubkey;

      const draft: EventTemplate = {
        kind: ACCEPT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", offer.id],
          ["p", offer.pubkey],
          ["p", pubkey],
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
        await publish(pool, signed);

        gameRef.current?.reset?.();
        lastPlyRef.current = 0;
        lastMoveEventIdRef.current = "none";
        forceUpdate();

        activeGameIdRef.current = gameId;

        setGame({
          gameId,
          offerEventId: offer.id,
          white,
          black,
          time: offer.time,
          inc: offer.inc,
        });

        alert("Game started!");
      } catch (e: any) {
        console.error(e);
        alert(e.message);
      }
    },
    [pubkey, signEvent, forceUpdate, gameRef, lastPlyRef, lastMoveEventIdRef]
  );

  // ==================== LEAVE ====================
  const leaveGame = useCallback(() => {
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
    challengeNpub,
    setChallengeNpub,
    isChallenging,
    game,
    createOffer,
    acceptOffer,
    leaveGame,
    myOfferEventId,
    cancelOffer,
    challengePlayer,
  };
}