import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import * as QRCode from "qrcode";
import ChessgroundBoard from "./ChessgroundBoard";
import { uciFromTo } from "./utils/chess";
import { useAuth } from "./nostr/useAuth";
import { useLobbyGame } from "./nostr/useLobbyGame";

import { RELAYS, MOVE_KIND } from "./nostr/constants";
import { tagValue } from "./nostr/tags";
import { type EventTemplate } from "nostr-tools";
import { useProfile } from "./nostr/useProfile";
import ChallengePlayer from "./nostr/ChallengePlayer";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  // chess
  const gameRef = useRef(new Chess());
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);
  // clock tick for offer countdown timers
const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

useEffect(() => {
  const interval = setInterval(() => {
    setNow(Math.floor(Date.now() / 1000));
  }, 1000);
  return () => clearInterval(interval);
}, []);
  const reset = () => {
    gameRef.current.reset();
    setTick(0);
    lastPlyRef.current = 0;
    lastMoveEventIdRef.current = "none";
  };

  // auth
  const auth = useAuth();
  const {
    pubkey,
    nsecInput,
    setNsecInput,
    hasNip07,
    loginWithExtension,
    loginWithNsec,
    logout,
    signEvent,
    displayName,
    avatar,
    lightning,
    refreshMetadata,
    isLoadingMetadata,
  } = auth;

  

  // tipping state
  const [tipRecipient, setTipRecipient] = useState("");
  const [tipSats, setTipSats] = useState(100);
  const [tipBusy, setTipBusy] = useState(false);

  // tip modal state
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const [tipInvoice, setTipInvoice] = useState("");
  const [tipQrDataUrl, setTipQrDataUrl] = useState("");

  // move sync state
  const lastPlyRef = useRef(0);
  const lastMoveEventIdRef = useRef<string>("none");

  // ====================== LOBBY + GAME HOOK ======================
  const {
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
    cancelOffer,
    acceptOffer,
    leaveGame,
    myOfferEventId,
    challengeNpub,
    setChallengeNpub,
    isChallenging,
    challengePlayer,
  } = useLobbyGame({
    pubkey,
    signEvent,
    gameRef,
    lastPlyRef,
    lastMoveEventIdRef,
    forceUpdate,
  });

  const whiteName = useProfile(game?.white ?? null);
  const blackName = useProfile(game?.black ?? null);

  // Subscribe to moves for current game
  useEffect(() => {
    if (!game) return;
    const pool = poolRef.current;
    if (!pool) return;

    // FIX: filter must be wrapped in an array
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
          if (pubkey && ev.pubkey === pubkey) return;

          const gameId = tagValue(ev, "d");
          if (gameId !== game.gameId) return;

          const plyStr = tagValue(ev, "ply");
          const uci = tagValue(ev, "uci");
          if (!plyStr || !uci) return;

          const ply = Number(plyStr);
          if (!Number.isFinite(ply)) return;
          if (ply !== lastPlyRef.current + 1) return;

          const turn = gameRef.current.turn();
          const expectedPubkey = turn === "w" ? game.white : game.black;
          if (ev.pubkey !== expectedPubkey) return;

          const from = uci.slice(0, 2);
          const to = uci.slice(2, 4);

          const move = gameRef.current.move({ from, to, promotion: "q" });
          if (!move) return;

          lastPlyRef.current = ply;
          lastMoveEventIdRef.current = ev.id || "";
          forceUpdate();
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
    };
  }, [game, pubkey, forceUpdate, poolRef]);

  // publish local move
  const publishMove = useCallback(
    async (from: string, to: string) => {
      if (!game || !pubkey) return;

      const turn = gameRef.current.turn();
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
        lastMoveEventIdRef.current = signed.id || "";
      } catch (e: any) {
        console.error(e);
        alert(`Failed to publish move: ${e?.message ?? e}`);
      }
    },
    [game, pubkey, signEvent, poolRef]
  );

  // Create tip QR
  const sendTip = useCallback(async () => {
    try {
      setTipBusy(true);

      const sats = Number(tipSats);
      if (!Number.isFinite(sats) || sats <= 0) {
        throw new Error("Tip amount must be greater than 0 sats.");
      }

      const invoice = await getBolt11FromRecipient(tipRecipient, sats);
      const qr = await QRCode.toDataURL(invoice, { width: 320, margin: 1 });

      setTipInvoice(invoice);
      setTipQrDataUrl(qr);
      setTipModalOpen(true);
    } catch (e: any) {
      console.error(e);
      alert(`Tip failed: ${e?.message ?? e}`);
    } finally {
      setTipBusy(false);
    }
  }, [tipRecipient, tipSats]);

  const payTipWithWebLN = useCallback(async () => {
    try {
      if (!tipInvoice) return;

      const w = (window as any).webln;
      if (w?.enable && w?.sendPayment) {
        await w.enable();
        await w.sendPayment(tipInvoice);
        alert("Tip sent ✅");
        setTipModalOpen(false);
        return;
      }

      await navigator.clipboard.writeText(tipInvoice);
      alert("WebLN not found. Invoice copied.");
    } catch (e: any) {
      console.error(e);
      alert(`Payment failed: ${e?.message ?? e}`);
    }
  }, [tipInvoice]);

  const shortPk = useMemo(() => (pubkey ? shortKey(pubkey) : ""), [pubkey]);
  const shownName = displayName?.trim() || shortPk || "Unknown";

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
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              height: "100%",
              width: 320,
              maxWidth: "85vw",
              background: "#1b1b1b",
              borderLeft: "1px solid rgba(255,255,255,0.15)",
              padding: 16,
              boxSizing: "border-box",
              overflowY: "auto",
            }}
          >
            {/* Profile block */}
            <div style={{ marginBottom: 12 }}>
              {pubkey ? (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: 10,
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt="avatar"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "1px solid rgba(255,255,255,0.2)",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.12)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        opacity: 0.9,
                      }}
                    >
                      {shortPk.slice(0, 2)}
                    </div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{shownName}</div>
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.8,
                        fontFamily: "monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {shortPk}
                    </div>
                    {lightning && (
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                        ⚡ {lightning}
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <button
                        onClick={() => refreshMetadata()}
                        disabled={isLoadingMetadata}
                      >
                        {isLoadingMetadata ? "Refreshing..." : "Refresh profile"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ opacity: 0.85, fontSize: 12 }}>Not logged in</div>
              )}
            </div>

            {/* Tip block */}
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Send a tip ⚡</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={tipRecipient}
                  onChange={(e) => setTipRecipient(e.target.value)}
                  placeholder="name@domain.com or bolt11 invoice"
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.2)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[50, 100, 500].map((amt) => (
                    <button key={amt} type="button" onClick={() => setTipSats(amt)}>
                      {amt} sats
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    value={tipSats}
                    onChange={(e) => setTipSats(Number(e.target.value))}
                    style={{
                      width: 120,
                      padding: 8,
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(0,0,0,0.2)",
                      color: "white",
                    }}
                  />
                  <button
                    onClick={sendTip}
                    disabled={tipBusy || !tipRecipient.trim()}
                  >
                    {tipBusy ? "Creating..." : "Create tip QR"}
                  </button>
                </div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  Purely voluntary tips • Good game / nice move
                </div>
              </div>
            </div>

            {pubkey && (
              <button onClick={logout} style={{ width: "100%" }}>
                Logout
              </button>
            )}

            {!pubkey && (
              <button
                onClick={loginWithExtension}
                disabled={!hasNip07}
                style={{ width: "100%" }}
              >
                Login with Extension (NIP-07)
              </button>
            )}

            {!pubkey && !hasNip07 && (
              <div style={{ opacity: 0.7, fontSize: 12, marginTop: 8 }}>
                No extension detected (install Alby or nos2x)
              </div>
            )}

            {!pubkey && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={nsecInput}
                  onChange={(e) => setNsecInput(e.target.value)}
                  placeholder="nsec1..."
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.2)",
                    color: "white",
                    boxSizing: "border-box",
                  }}
                />
                <button onClick={loginWithNsec} style={{ width: "100%" }}>
                  Login with nsec
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          width: "min(92vw, 760px)",
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            color: "#f7d300",
            fontWeight: 800,
            letterSpacing: 0.5,
            textShadow: "0 0 12px rgba(247, 211, 0, 0.35)",
          }}
        >
          Lightning-chess ⚡
        </h1>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{ position: "absolute", right: 0 }}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
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
              White: {whiteName || shortKey(game.white)} • Black: {blackName || shortKey(game.black)} •{" "}
              {game.time}s + {game.inc}s
            </div>
            <button onClick={leaveGame}>Leave game</button>
          </>
        ) : (
          <>
            <ChallengePlayer
              challengeNpub={challengeNpub}
              setChallengeNpub={setChallengeNpub}
              isChallenging={isChallenging}
              challengePlayer={challengePlayer}
              offerSeconds={offerSeconds}
              offerInc={offerInc}
              offerColor={offerColor}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>Find a Game</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  Relays: {relayStatus} ({RELAYS.length})
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
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
                    onChange={(e) => setOfferColor(e.target.value as any)}
                    style={{ marginLeft: 6 }}
                  >
                    <option value="random">random</option>
                    <option value="white">white</option>
                    <option value="black">black</option>
                  </select>
                </label>

                {myOfferEventId ? (
                  <button onClick={cancelOffer}>Cancel Offer</button>
                ) : (
                <button onClick={createOffer} disabled={!pubkey}>
                  Create Offer
                  </button>
                )}
                <button onClick={() => window.location.reload()}>
                  Refresh Offers
                </button>
              </div>
            </div>

           <div style={{ opacity: 0.8, fontSize: 12 }}>
              Offers found: {offers.length}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {offers.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No offers yet.</div>
              ) : (
                offers.map((o) => {
                  const age = now - o.created_at;
                  const expired = age > 300;
                  const secondsLeft = Math.max(0, 300 - age);
                  const minutes = Math.floor(secondsLeft / 60);
                  const seconds = secondsLeft % 60;
                  const timer = `${minutes}:${String(seconds).padStart(2, "0")}`;
                  const isMyOffer = pubkey === o.pubkey;

                  return (
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
                        opacity: expired ? 0.35 : 1,
                        transition: "opacity 0.5s",
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: "monospace" }}>
                          {shortKey(o.pubkey)}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          {o.time}s + {o.inc}s • host plays: {o.color}
                        </div>
                        <div style={{
                          fontSize: 11,
                          marginTop: 4,
                          color: expired ? "#888" : secondsLeft < 60 ? "#ff6b6b" : "#88cc88",
                        }}>
                          {expired ? "⏰ Expired" : `⏱ ${timer}`}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {isMyOffer ? (
                          <button
                            onClick={() => cancelOffer(o.id)}
                            style={{ color: "#ff6b6b" }}
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            disabled={!pubkey || expired}
                            onClick={() => acceptOffer(o)}
                          >
                            Accept
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>  
        )}
      </div>  {/* ← closes the Lobby / Game div */}

      <ChessgroundBoard
        game={gameRef.current}
        currentGame={game}
        pubkey={pubkey}
        onChange={forceUpdate}
        onMove={publishMove}
      />

      <button onClick={reset}>Reset</button>

      {/* Tip QR Modal */}
      {tipModalOpen && (
        <div
          onClick={() => setTipModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            zIndex: 1200,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(92vw, 420px)",
              background: "#1b1b1b",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 12,
              padding: 16,
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Tip QR ⚡</div>

            {tipQrDataUrl ? (
              <img
                src={tipQrDataUrl}
                alt="Lightning invoice QR"
                style={{
                  width: "100%",
                  maxWidth: 320,
                  display: "block",
                  margin: "0 auto 12px auto",
                  borderRadius: 8,
                  background: "white",
                }}
              />
            ) : (
              <div style={{ opacity: 0.8, marginBottom: 12 }}>Generating QR...</div>
            )}

            <div
              style={{
                fontSize: 11,
                opacity: 0.75,
                wordBreak: "break-all",
                marginBottom: 12,
                fontFamily: "monospace",
                maxHeight: 80,
                overflow: "auto",
              }}
            >
              {tipInvoice}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={payTipWithWebLN}>Pay with WebLN</button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(tipInvoice);
                  alert("Invoice copied");
                }}
              >
                Copy invoice
              </button>
              <button onClick={() => setTipModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function shortKey(pubkey: string): string {
  return pubkey.slice(0, 8) + "..." + pubkey.slice(-4);
}

function looksLikeBolt11(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("lnbc") || v.startsWith("lntb") || v.startsWith("lnbcrt");
}

function looksLikeLightningAddress(value: string): boolean {
  const v = value.trim();
  if (!v.includes("@")) return false;
  const [name, domain] = v.split("@");
  return Boolean(name && domain && !domain.includes(" "));
}

async function getBolt11FromRecipient(
  recipientRaw: string,
  sats: number
): Promise<string> {
  const recipient = recipientRaw.trim().replace(/^lightning:/i, "");

  if (!recipient) throw new Error("Recipient is required.");
  if (looksLikeBolt11(recipient)) return recipient;
  if (!looksLikeLightningAddress(recipient)) {
    throw new Error(
      "Enter a valid lightning address (name@domain) or bolt11 invoice."
    );
  }

  const [name, domain] = recipient.split("@");
  const wellKnown = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(
    name
  )}`;

  const info = await fetchJson(wellKnown);
  if (!info?.callback) {
    throw new Error("Lightning address did not return a callback endpoint.");
  }

  const amountMsat = Math.round(sats * 1000);
  const minSendable = Number(info.minSendable ?? 1);
  const maxSendable = Number(info.maxSendable ?? Number.MAX_SAFE_INTEGER);

  if (amountMsat < minSendable)
    throw new Error("Amount is below minimum for this address.");
  if (amountMsat > maxSendable)
    throw new Error("Amount is above maximum for this address.");

  const cb = new URL(String(info.callback));
  cb.searchParams.set("amount", String(amountMsat));

  const payReq = await fetchJson(cb.toString());
  const pr = String(payReq?.pr ?? payReq?.paymentRequest ?? "");

  if (!pr || !looksLikeBolt11(pr))
    throw new Error("Failed to get a valid lightning invoice.");

  return pr;
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!r.ok)
    throw new Error(`HTTP ${r.status} while requesting payment data.`);

  return r.json();
}