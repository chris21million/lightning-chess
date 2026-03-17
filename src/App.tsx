import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import ChessgroundBoard from "./ChessgroundBoard";

import {
  finalizeEvent,
  getPublicKey,
  nip19,
  type EventTemplate,
  SimplePool,
  type Event as NostrEvent,
} from "nostr-tools";

type Signer =
  | { type: "nip07"; pubkey: string }
  | { type: "nsec"; pubkey: string; sk: Uint8Array }
  | null;

type Offer = {
  id: string;
  pubkey: string;
  created_at: number;
  offerId: string;
  time: number;
  inc: number;
  color: "white" | "black" | "random";
};

type Game = {
  gameId: string;
  offerEventId: string;
  white: string;
  black: string;
  time: number;
  inc: number;
};

declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>;
      signEvent: (event: EventTemplate) => Promise<any>;
    };
  }
}

const RELAYS = ["wss://relay.damus.io", "wss://relay.snort.social", "wss://nos.lol"];
const TOPIC_TAG = "lightning-chess";

const OFFER_KIND = 30078;
const ACCEPT_KIND = 30079;
const MOVE_KIND = 30080;

function tagValue(ev: NostrEvent, name: string): string | null {
  const t = ev.tags.find((x) => x[0] === name);
  return t?.[1] ?? null;
}

function tagValues(ev: NostrEvent, name: string): string[] {
  return ev.tags.filter((x) => x[0] === name).map((x) => x[1]).filter(Boolean);
}

function parseOffer(ev: NostrEvent): Offer | null {
  const topics = tagValues(ev, "t");
  if (!topics.includes(TOPIC_TAG)) return null;

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

function randomId(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function shortKey(pk: string) {
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`;
}

function uciFromTo(from: string, to: string) {
  return `${from}${to}`; // promotion omitted for now (we always promote to queen in board)
}

export default function App() {
  // chess
  const gameRef = useRef(new Chess());
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);
  const reset = () => {
    gameRef.current.reset();
    setTick(0);
    // reset move sync counters too
    lastPlyRef.current = 0;
    lastMoveEventIdRef.current = "none";
  };

  // auth
  const [signer, setSigner] = useState<Signer>(null);
  const [nsecInput, setNsecInput] = useState("");
  const pubkey = signer?.pubkey ?? null;

  const hasNip07 = typeof window !== "undefined" && !!window.nostr;

  const loginWithExtension = async () => {
    if (!window.nostr) {
      alert("No NIP-07 extension found. Install Alby or nos2x.");
      return;
    }
    const pk = await window.nostr.getPublicKey();
    setSigner({ type: "nip07", pubkey: pk });
  };

  const loginWithNsec = () => {
    try {
      const decoded = nip19.decode(nsecInput.trim());
      if (decoded.type !== "nsec") throw new Error("Not an nsec");
      const sk = decoded.data as Uint8Array;
      const pk = getPublicKey(sk);
      setSigner({ type: "nsec", pubkey: pk, sk });
    } catch {
      alert("Invalid nsec.");
    }
  };

  const logout = () => {
    setSigner(null);
    setNsecInput("");
  };

  const signEvent = useCallback(
    async (draft: EventTemplate) => {
      if (!signer) throw new Error("Not logged in");
      if (signer.type === "nip07") {
        if (!window.nostr) throw new Error("No NIP-07 extension found");
        return await window.nostr.signEvent(draft);
      }
      return finalizeEvent(draft, signer.sk);
    },
    [signer]
  );

  // pool (used for both lobby + game)
  const poolRef = useRef<SimplePool | null>(null);

  // lobby
  const [relayStatus, setRelayStatus] = useState<"disconnected" | "connecting" | "connected">(
    "disconnected"
  );
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerSeconds, setOfferSeconds] = useState(60);
  const [offerInc, setOfferInc] = useState(0);
  const [offerColor, setOfferColor] = useState<Offer["color"]>("random");
  const [game, setGame] = useState<Game | null>(null);

  // move sync state (refs so they persist without re-render)
  const lastPlyRef = useRef(0); // number of half-moves accepted
  const lastMoveEventIdRef = useRef<string>("none");

  useEffect(() => {
    const pool = new SimplePool();
    poolRef.current = pool;
    setRelayStatus("connecting");

    const sub = pool.subscribeMany(
      RELAYS,
      [{ kinds: [OFFER_KIND], "#t": [TOPIC_TAG], limit: 50, since: Math.floor(Date.now() / 1000) - 86400 }],
      {
        onevent(ev) {
          const offer = parseOffer(ev);
          if (!offer) return;
          setOffers((prev) => {
            if (prev.some((x) => x.id === offer.id)) return prev;
            const next = [offer, ...prev].sort((a, b) => b.created_at - a.created_at);
            return next.slice(0, 50);
          });
          setRelayStatus("connected");
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
      try { pool.close(RELAYS); } catch {}
      poolRef.current = null;
      setRelayStatus("disconnected");
    };
  }, []);

  const createOffer = useCallback(async () => {
    try {
      if (!pubkey) return alert("Login first");

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
        ],
        content: "",
      };

      const signed = await signEvent(draft);
      const pool = poolRef.current;
      if (!pool) throw new Error("No relay pool");
      await Promise.any(pool.publish(RELAYS, signed));
      alert("Offer published.");
    } catch (e: any) {
      console.error(e);
      alert(`Failed to publish offer: ${e?.message ?? e}`);
    }
  }, [offerColor, offerInc, offerSeconds, pubkey, signEvent]);

  const acceptOffer = useCallback(
    async (offer: Offer) => {
      try {
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

        const signed = await signEvent(draft);
        const pool = poolRef.current;
        if (!pool) throw new Error("No relay pool");
        await Promise.any(pool.publish(RELAYS, signed));

        // reset local board + sync counters when entering a game
        gameRef.current.reset();
        lastPlyRef.current = 0;
        lastMoveEventIdRef.current = "none";
        forceUpdate();

        setGame({ gameId, offerEventId: offer.id, white, black, time: offer.time, inc: offer.inc });
        alert("Accepted! Now try making a move.");
      } catch (e: any) {
        console.error(e);
        alert(`Failed to accept offer: ${e?.message ?? e}`);
      }
    },
    [pubkey, signEvent, forceUpdate]
  );

  const leaveGame = () => {
    setGame(null);
    reset();
  };

  // Subscribe to moves for current game
  useEffect(() => {
    if (!game) return;
    const pool = poolRef.current;
    if (!pool) return;

    const sub = pool.subscribeMany(
      RELAYS,
      [
        {
          kinds: [MOVE_KIND],
          "#d": [game.gameId],
          since: Math.floor(Date.now() / 1000) - 60 * 10,
          limit: 200,
        },
      ],
      {
        onevent(ev) {
          // ignore our own events (we already applied move locally)
          if (pubkey && ev.pubkey === pubkey) return;

          const gameId = tagValue(ev, "d");
          if (gameId !== game.gameId) return;

          const plyStr = tagValue(ev, "ply");
          const uci = tagValue(ev, "uci");
          if (!plyStr || !uci) return;

          const ply = Number(plyStr);
          if (!Number.isFinite(ply)) return;

          // simple ordering rule: only accept next ply
          if (ply !== lastPlyRef.current + 1) return;

          // verify correct player
          const turn = gameRef.current.turn(); // "w" or "b"
          const expectedPubkey = turn === "w" ? game.white : game.black;
          if (ev.pubkey !== expectedPubkey) return;

          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);

          const move = gameRef.current.move({ from, to, promotion: "q" });
          if (!move) return;

          lastPlyRef.current = ply;
          lastMoveEventIdRef.current = ev.id;
          forceUpdate();
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  }, [game, pubkey, forceUpdate]);

  // publish local move
  const publishMove = useCallback(
    async (from: string, to: string) => {
      if (!game) return; // local-only if not in a game
      if (!pubkey) return;

      // only publish if it's our turn for our color
      const turn = gameRef.current.turn(); // after move already applied by board
      // Board already applied the move, so turn has switched.
      // The mover was the opposite:
      const moverColor = turn === "w" ? "b" : "w";
      const moverPubkey = moverColor === "w" ? game.white : game.black;
      if (moverPubkey !== pubkey) return;

      try {
        const ply = lastPlyRef.current + 1;
        const uci = uciFromTo(from, to);

        const draft: EventTemplate = {
          kind: MOVE_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["d", game.gameId],
            ["ply", String(ply)],
            ["uci", uci],
            ["prev", lastMoveEventIdRef.current],
          ],
          content: "",
        };

        const signed = await signEvent(draft);

        const pool = poolRef.current;
        if (!pool) throw new Error("No relay pool");
        await Promise.any(pool.publish(RELAYS, signed));

        lastPlyRef.current = ply;
        lastMoveEventIdRef.current = signed.id;
      } catch (e: any) {
        console.error(e);
        alert(`Failed to publish move: ${e?.message ?? e}`);
      }
    },
    [game, pubkey, signEvent]
  );

  const shortPk = useMemo(() => (pubkey ? shortKey(pubkey) : ""), [pubkey]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#242424",
        color: "#fff",
        padding: 16,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <h1 style={{ margin: 0 }}>Lightning Chess</h1>

      {/* Login */}
      <div
        style={{
          width: "min(92vw, 760px)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {pubkey ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>Logged in as</div>
              <div style={{ fontFamily: "monospace" }}>{shortPk}</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                Method: {signer!.type === "nip07" ? "NIP-07 extension" : "nsec"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={logout}>Logout</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={loginWithExtension} disabled={!hasNip07}>
                Login with Extension (NIP-07)
              </button>
              {!hasNip07 && (
                <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }}>
                  (No extension detected)
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                placeholder="nsec1..."
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.2)",
                  color: "white",
                }}
              />
              <button onClick={loginWithNsec}>Login with nsec</button>
            </div>
          </>
        )}
      </div>

      {/* Lobby / Game */}
      <div
        style={{
          width: "min(92vw, 760px)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {game ? (
          <>
            <div style={{ fontWeight: 600 }}>Current game</div>
            <div style={{ fontSize: 12, opacity: 0.85, fontFamily: "monospace" }}>
              gameId: {game.gameId}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              White: {shortKey(game.white)} • Black: {shortKey(game.black)} • {game.time}s + {game.inc}s
            </div>
            <button onClick={leaveGame}>Leave game</button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Open Lobby</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  Relays: {relayStatus} ({RELAYS.length})
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: 12, opacity: 0.85 }}>
                  Time{" "}
                  <input
                    type="number"
                    value={offerSeconds}
                    min={10}
                    onChange={(e) => setOfferSeconds(Number(e.target.value))}
                    style={{ width: 90, marginLeft: 6 }}
                  />
                </label>

                <label style={{ fontSize: 12, opacity: 0.85 }}>
                  Inc{" "}
                  <input
                    type="number"
                    value={offerInc}
                    min={0}
                    onChange={(e) => setOfferInc(Number(e.target.value))}
                    style={{ width: 70, marginLeft: 6 }}
                  />
                </label>

                <label style={{ fontSize: 12, opacity: 0.85 }}>
                  Host plays{" "}
                  <select
                    value={offerColor}
                    onChange={(e) => setOfferColor(e.target.value as Offer["color"])}
                    style={{ marginLeft: 6 }}
                  >
                    <option value="random">random</option>
                    <option value="white">white</option>
                    <option value="black">black</option>
                  </select>
                </label>

                <button onClick={createOffer} disabled={!pubkey}>
                  Create Offer
                </button>
              </div>
            </div>

            <div style={{ opacity: 0.8, fontSize: 12 }}>Offers found: {offers.length}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {offers.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No offers yet.</div>
              ) : (
                offers.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: "monospace" }}>{shortKey(o.pubkey)}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        {o.time}s + {o.inc}s • host plays: {o.color}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button disabled={!pubkey || pubkey === o.pubkey} onClick={() => acceptOffer(o)}>
                        Accept
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <ChessgroundBoard game={gameRef.current} onChange={forceUpdate} onMove={publishMove} />

      <button onClick={reset}>Reset</button>
    </div>
  );
}
