import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import ChessgroundBoard from "./ChessgroundBoard";
import { uciFromTo } from "./utils/chess";
import { useAuth } from "./nostr/useAuth";
import { useLobbyGame } from "./nostr/useLobbyGame";
import { RELAYS, MOVE_KIND } from "./nostr/constants";
import { tagValue } from "./nostr/tags";
import { type EventTemplate } from "nostr-tools";
import { shortKey } from "./utils/lightning";
import SideMenu from "./components/SideMenu";
import LobbyPanel from "./components/LobbyPanel";
import TipModal from "./components/TipModal";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  // Chess board
  const gameRef = useRef(new Chess());
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  // Clock tick for offer countdown timers
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset
  const reset = () => {
    gameRef.current.reset();
    setTick(0);
    lastPlyRef.current = 0;
    lastMoveEventIdRef.current = "none";
  };

  // Auth
  const {
    pubkey, nsecInput, setNsecInput, hasNip07,
    loginWithExtension, loginWithNsec, logout, signEvent,
    displayName, avatar, lightning, refreshMetadata, isLoadingMetadata,
  } = useAuth();

  // Tip modal
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const [tipInvoice, setTipInvoice] = useState("");
  const [tipQrDataUrl, setTipQrDataUrl] = useState("");

  // Move sync refs
  const lastPlyRef = useRef(0);
  const lastMoveEventIdRef = useRef<string>("none");

  // Lobby + game hook
  const {
    poolRef, relayStatus, offers,
    offerSeconds, setOfferSeconds, offerInc, setOfferInc, offerColor, setOfferColor,
    game, createOffer, cancelOffer, acceptOffer, leaveGame, myOfferEventId,
    challengeNpub, setChallengeNpub, isChallenging, challengePlayer,
  } = useLobbyGame({ pubkey, signEvent, gameRef, lastPlyRef, lastMoveEventIdRef, forceUpdate });

  // Subscribe to opponent moves
  useEffect(() => {
    if (!game) return;
    const pool = poolRef.current;
    if (!pool) return;

    const sub = pool.subscribeMany(
      RELAYS,
      [{ kinds: [MOVE_KIND], "#d": [game.gameId], since: Math.floor(Date.now() / 1000) - 600, limit: 200 }],
      {
        onevent(ev) {
          if (pubkey && ev.pubkey === pubkey) return;
          if (tagValue(ev, "d") !== game.gameId) return;

          const plyStr = tagValue(ev, "ply");
          const uci = tagValue(ev, "uci");
          if (!plyStr || !uci) return;

          const ply = Number(plyStr);
          if (!Number.isFinite(ply) || ply !== lastPlyRef.current + 1) return;

          const turn = gameRef.current.turn();
          if (ev.pubkey !== (turn === "w" ? game.white : game.black)) return;

          const move = gameRef.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: "q" });
          if (!move) return;

          lastPlyRef.current = ply;
          lastMoveEventIdRef.current = ev.id || "";
          forceUpdate();
        },
      }
    );

    return () => { try { sub.close(); } catch {} };
  }, [game, pubkey, forceUpdate, poolRef]);

  // Publish local move
  const publishMove = useCallback(async (from: string, to: string) => {
    if (!game || !pubkey) return;

    const turn = gameRef.current.turn();
    const moverColor = turn === "w" ? "b" : "w";
    if ((moverColor === "w" ? game.white : game.black) !== pubkey) return;

    try {
      const ply = lastPlyRef.current + 1;
      const draft: EventTemplate = {
        kind: MOVE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", game.gameId], ["ply", String(ply)], ["uci", uciFromTo(from, to)], ["prev", lastMoveEventIdRef.current]],
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
  }, [game, pubkey, signEvent, poolRef]);

  // Derived
  const shortPk = useMemo(() => (pubkey ? shortKey(pubkey) : ""), [pubkey]);
  const shownName = displayName?.trim() || shortPk || "Unknown";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#242424",
      color: "#fff",
      padding: 16,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 12,
    }}>

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pubkey={pubkey}
        shortPk={shortPk}
        shownName={shownName}
        avatar={avatar}
        lightning={lightning}
        isLoadingMetadata={isLoadingMetadata}
        refreshMetadata={refreshMetadata}
        hasNip07={hasNip07}
        loginWithExtension={loginWithExtension}
        loginWithNsec={loginWithNsec}
        logout={logout}
        nsecInput={nsecInput}
        setNsecInput={setNsecInput}
        onTipQrReady={(invoice, qr) => {
          setTipInvoice(invoice);
          setTipQrDataUrl(qr);
          setTipModalOpen(true);
        }}
      />

      {/* Header */}
      <div style={{ width: "min(92vw, 760px)", position: "relative", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <h1 style={{ margin: 0, color: "#f7d300", fontWeight: 800, letterSpacing: 0.5, textShadow: "0 0 12px rgba(247,211,0,0.35)" }}>
          Lightning-chess ⚡
        </h1>
        <button onClick={() => setMenuOpen((v) => !v)} style={{ position: "absolute", right: 0 }}>
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      <LobbyPanel
        game={game}
        pubkey={pubkey}
        now={now}
        offers={offers}
        offerSeconds={offerSeconds}
        setOfferSeconds={setOfferSeconds}
        offerInc={offerInc}
        setOfferInc={setOfferInc}
        offerColor={offerColor}
        setOfferColor={setOfferColor}
        myOfferEventId={myOfferEventId}
        createOffer={createOffer}
        cancelOffer={cancelOffer}
        acceptOffer={acceptOffer}
        leaveGame={leaveGame}
        relayStatus={relayStatus}
        challengeNpub={challengeNpub}
        setChallengeNpub={setChallengeNpub}
        isChallenging={isChallenging}
        challengePlayer={challengePlayer}
      />

      <ChessgroundBoard
        game={gameRef.current}
        currentGame={game}
        pubkey={pubkey}
        onChange={forceUpdate}
        onMove={publishMove}
      />

      <button onClick={reset}>Reset</button>

      <TipModal
        open={tipModalOpen}
        onClose={() => setTipModalOpen(false)}
        invoice={tipInvoice}
        qrDataUrl={tipQrDataUrl}
      />

    </div>
  );
}