import { useCallback, useEffect, useRef, useState } from "react";
import { SimplePool, type EventTemplate } from "nostr-tools";
import { randomId } from "../utils/id";
import { shortKey } from "../utils/format";
import { RELAYS, TOPIC_TAG, OFFER_KIND, ACCEPT_KIND, MOVE_KIND } from "./constants";
import type { GameOverState } from "../components/GameOverModal";
import { parseOffer, tagValue } from "./tags";
import type { Game, Offer } from "./types";

type UseLobbyGameArgs = {
  pubkey: string | null;
  signEvent: (draft: EventTemplate) => Promise<any>;
  gameRef: React.MutableRefObject<any>;
  lastPlyRef: React.MutableRefObject<number>;
  lastMoveEventIdRef: React.MutableRefObject<string>;
  forceUpdate: () => void;
  triggerGameOver: (result: GameOverState["result"], reason: GameOverState["reason"], opponentName: string) => void;
  opponentNameRef: React.MutableRefObject<string>;
};

export function useLobbyGame({
  pubkey,
  signEvent,
  gameRef,
  lastPlyRef,
  lastMoveEventIdRef,
  forceUpdate,
  triggerGameOver,
  opponentNameRef,
}: UseLobbyGameArgs) {
  const poolRef = useRef<SimplePool | null>(null);
  const activeGameIdRef = useRef<string | null>(null);

  const [relayStatus, setRelayStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  const [offers, setOffers] = useState<Offer[]>([]);

  const [offerMinutes, setOfferMinutes] = useState(10);
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
      [{ kinds: [OFFER_KIND], "#t": [TOPIC_TAG], since }],
      {
        onevent(ev) {
          const offer = parseOffer(ev);
          if (!offer) return;

          ////////////////////////////////////////
          // CHALLENGE FILTER
          // If offer has a challenge tag it is a direct challenge.
          // Only show it if:
          //   a) I am the challenger (my own offer), OR
          //   b) I am the target (challenge === my pubkey)
          // Hide it from everyone else so random players can't accept.
          ////////////////////////////////////////
          const challengeTarget = tagValue(ev, "challenge");
          if (challengeTarget) {
            const isMyChallenge = ev.pubkey === pubkey;
            const isTargetedAtMe = challengeTarget === pubkey;
            if (!isMyChallenge && !isTargetedAtMe) return;
          }
          ////////////////////////////////////////
          // END CHALLENGE FILTER
          ////////////////////////////////////////

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
          since: Math.floor(Date.now() / 1000) - 30,
        },
      ],
      {
        onevent(ev) {
          console.log("📨 Accept received!", ev);
          const gameId = tagValue(ev, "d");
          const white = tagValue(ev, "white");
          const black = tagValue(ev, "black");
          const time = Number(tagValue(ev, "time") || 0);
          const inc = Number(tagValue(ev, "inc") || 0);
          const offerEventId = tagValue(ev, "e") || "";

          if (!gameId || !white || !black) return;
          if (activeGameIdRef.current) return;

          gameRef.current?.reset?.();
          lastPlyRef.current = 0;
          lastMoveEventIdRef.current = "none";
          forceUpdate();

          activeGameIdRef.current = gameId;

          setGame({ gameId, offerEventId, white, black, time, inc });

          ////////////////////////////////////////
          // AUTO DELETE OFFER from relay when accepted
          // prevents other players accepting the same offer
          ////////////////////////////////////////
          const pool = poolRef.current;
          if (pool && offerEventId) {
            signEvent({
              kind: 5,
              created_at: Math.floor(Date.now() / 1000),
              tags: [["e", offerEventId]],
              content: "offer accepted",
            }).then(signed => {
              pool.publish(RELAYS, signed).catch(() => {});
            }).catch(() => {});
          }
          ////////////////////////////////////////
          // END AUTO DELETE OFFER
          ////////////////////////////////////////

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
  ////////////////////////////////////////
  // SUBSCRIPTION — moves for active game
  // Stable pool means we never miss the checkmate move
  ////////////////////////////////////////
  const gameRef2 = useRef(game);
  useEffect(() => { gameRef2.current = game; }, [game]);

  useEffect(() => {
    if (!game || !pubkey) return;
    const pool = poolRef.current;
    if (!pool) return;

    console.log("🎮 Subscribing to moves for game:", game.gameId);

    const moveSub = pool.subscribeMany(
      RELAYS,
      [
        {
          kinds: [MOVE_KIND],
          "#d": [game.gameId],
          since: Math.floor(Date.now() / 1000) - 600,
          limit: 200,
        },
      ],
      {
        onevent(ev) {
          console.log("♟ Move event received, pubkey:", ev.pubkey.slice(0, 8), "ply:", tagValue(ev, "ply"));

          if (ev.pubkey === pubkey) return;

          const currentGame = gameRef2.current;
          if (!currentGame) return;
          if (tagValue(ev, "d") !== currentGame.gameId) return;

          const plyStr = tagValue(ev, "ply");
          const uci = tagValue(ev, "uci");
          if (!plyStr || !uci) return;

          const ply = Number(plyStr);
          if (!Number.isFinite(ply) || ply !== lastPlyRef.current + 1) return;

          const turn = gameRef.current.turn();
          if (ev.pubkey !== (turn === "w" ? currentGame.white : currentGame.black)) return;

          const move = gameRef.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: "q" });
          if (!move) return;

          lastPlyRef.current = ply;
          lastMoveEventIdRef.current = ev.id || "";

          ////////////////////////////////////////
          // GAME OVER — loser detection
          ////////////////////////////////////////
          if (gameRef.current.isGameOver()) {
            console.log("🏁 Game over detected in move subscription");
            if (gameRef.current.isCheckmate()) {
              triggerGameOver("loss", "checkmate", opponentNameRef.current);
            } else if (gameRef.current.isStalemate()) {
              triggerGameOver("draw", "stalemate", opponentNameRef.current);
            } else if (gameRef.current.isDraw()) {
              triggerGameOver("draw", "draw", opponentNameRef.current);
            }
          }
          ////////////////////////////////////////
          // END GAME OVER — loser detection
          ////////////////////////////////////////

          forceUpdate();
        },
      }
    );

    return () => {
      try { moveSub.close(); } catch {}
    };
  }, [game?.gameId, pubkey]);
  ////////////////////////////////////////
  // END SUBSCRIPTION — moves
  ////////////////////////////////////////

  ////////////////////////////////////////
  // PUBLISH HELPER
  // Uses allSettled so a single relay rejection
  // doesn't throw — only throws if ALL relays fail
  ////////////////////////////////////////
  const publish = async (pool: SimplePool, event: any) => {
    try {
      const results = await Promise.allSettled(pool.publish(RELAYS, event));
      const anyOk = results.some(r => r.status === "fulfilled");
      if (!anyOk) throw new Error("No relays accepted the event.");
      console.log("✅ published");
    } catch (e) {
      console.log("❌ publish error", e);
      throw e;
    }
  };
  ////////////////////////////////////////
  // END PUBLISH HELPER
  ////////////////////////////////////////

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
        ["time", String(offerMinutes * 60)],
        ["inc", String(offerInc)],
        ["color", offerColor],
        ["p", pubkey],
      ],
      content: `Lightning Chess ${offerMinutes}s + ${offerInc}s`,
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
  }, [pubkey, offerMinutes, offerInc, offerColor, signEvent]);

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
        ["time", String(offerMinutes * 60)],
        ["inc", String(offerInc)],
        ["color", offerColor],
        ["p", pubkey],
        ["p", targetPubkey],
        ["challenge", targetPubkey],
      ],
      content: `Chess challenge ${offerMinutes}s + ${offerInc}s`,
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
  }, [pubkey, challengeNpub, offerMinutes, offerInc, offerColor, signEvent]);

  // ==================== ACCEPT OFFER ====================
  const acceptOffer = useCallback(
    async (offer: Offer) => {
      if (!pubkey) return alert("Login first");
      if (pubkey === offer.pubkey) return;

      const pool = poolRef.current;
      if (!pool) return alert("Not connected");

      ////////////////////////////////////////
      // CHECK IF OFFER ALREADY ACCEPTED
      ////////////////////////////////////////
      const alreadyAccepted = await new Promise<boolean>((resolve) => {
        let found = false;
        const checkSub = pool.subscribeMany(
          RELAYS,
          [{ kinds: [ACCEPT_KIND], "#e": [offer.id], limit: 1 }],
          {
            onevent() { found = true; },
            oneose() {
              try { checkSub.close(); } catch {}
              resolve(found);
            },
          }
        );
        setTimeout(() => {
          try { checkSub.close(); } catch {}
          resolve(found);
        }, 2000);
      });

      if (alreadyAccepted) {
        alert("This offer has already been accepted.");
        setOffers(prev => prev.filter(o => o.id !== offer.id));
        return;
      }
      ////////////////////////////////////////
      // END CHECK
      ////////////////////////////////////////

      const gameId = randomId(14);

      const white = offer.color === "black" ? pubkey : offer.pubkey;
      const black = offer.color === "black" ? offer.pubkey : pubkey;

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

        ////////////////////////////////////////
        // REMOVE ACCEPTED OFFER from lobby
        // so other players can't accept the same offer
        ////////////////////////////////////////
        setOffers(prev => prev.filter(o => o.id !== offer.id));
        ////////////////////////////////////////
        // END REMOVE ACCEPTED OFFER
        ////////////////////////////////////////

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
    offerMinutes,
    setOfferMinutes,
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