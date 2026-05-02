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
import { useProfile } from "./nostr/useProfile";
import SideMenu from "./components/SideMenu";
import LobbyPanel from "./components/LobbyPanel";
import TipModal from "./components/TipModal";
import GameOverModal from "./components/GameOverModal";
import type { GameOverState } from "./components/GameOverModal";

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

  ////////////////////////////////////////
  // GAME OVER STATE — managed in App.tsx
  // so both winner (via ChessgroundBoard) and
  // loser (via opponent move subscription) can trigger it
  ////////////////////////////////////////
  const [gameOverState, setGameOverState] = useState<GameOverState | null>(null);
  const gameOverStateRef = useRef<GameOverState | null>(null);

  const triggerGameOver = useCallback((
    result: GameOverState["result"],
    reason: GameOverState["reason"],
    opponentName: string
  ) => {
    if (gameOverStateRef.current) return;
    const state = { result, reason, opponentName };
    gameOverStateRef.current = state;
    setGameOverState(state);
  }, []);
  ////////////////////////////////////////
  // END GAME OVER STATE
  ////////////////////////////////////////

  // Move sync refs
  const lastPlyRef = useRef(0);
  const lastMoveEventIdRef = useRef<string>("none");

  // opponentNameRef defined before useLobbyGame so it can be passed in
  const opponentNameRef = useRef("Opponent");

  // Lobby + game hook — move subscription now lives inside here
  const {
    poolRef, relayStatus, offers,
    offerMinutes, setOfferMinutes, offerInc, setOfferInc, offerColor, setOfferColor,
    game, createOffer, cancelOffer, acceptOffer, leaveGame, myOfferEventId,
    challengeNpub, setChallengeNpub, isChallenging, challengePlayer,
  } = useLobbyGame({ 
    pubkey, signEvent, gameRef, lastPlyRef, lastMoveEventIdRef, forceUpdate,
    triggerGameOver,
    opponentNameRef,
  });

  // Resolve opponent display name via useProfile
  const opponentPubkey = game
    ? pubkey === game.white ? game.black : game.white
    : null;
  const opponentDisplayName = useProfile(opponentPubkey);
  useEffect(() => {
    opponentNameRef.current = opponentDisplayName || (opponentPubkey ? shortKey(opponentPubkey) : "Opponent");
  }, [opponentDisplayName, opponentPubkey]);

  ////////////////////////////////////////
  // RESET GAME OVER when game changes
  ////////////////////////////////////////
  useEffect(() => {
    gameOverStateRef.current = null;
    setGameOverState(null);
  }, [game?.gameId]);
  ////////////////////////////////////////
  // END RESET GAME OVER
  ////////////////////////////////////////

  

  ////////////////////////////////////////
  // PUBLISH MOVE
  ////////////////////////////////////////
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

      const results = await Promise.allSettled(pool.publish(RELAYS, signed));
      const anyOk = results.some(r => r.status === "fulfilled");
      if (!anyOk) throw new Error("No relays accepted the move.");

      lastPlyRef.current = ply;
      lastMoveEventIdRef.current = signed.id || "";
    } catch (e: any) {
      console.error(e);
      alert(`Failed to publish move: ${e?.message ?? e}`);
    }
  }, [game, pubkey, signEvent, poolRef]);
  ////////////////////////////////////////
  // END PUBLISH MOVE
  ////////////////////////////////////////

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
        offerMinutes={offerMinutes}
        setOfferMinutes={setOfferMinutes}
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
        opponentName={opponentDisplayName || (opponentPubkey ? shortKey(opponentPubkey) : "Opponent")}
        onChange={forceUpdate}
        onMove={publishMove}
        onLeaveGame={leaveGame}
        externalGameOver={gameOverState}
        onTriggerGameOver={triggerGameOver}
      />

      {/* App level game over modal — handles loser side */}
      <GameOverModal
        state={gameOverState}
        onLeave={() => {
          gameOverStateRef.current = null;
          setGameOverState(null);
          leaveGame();
        }}
      />

      <button onClick={() => window.open("https://nostr.org", "_blank")}>What is Nostr?</button>

      <TipModal
        open={tipModalOpen}
        onClose={() => setTipModalOpen(false)}
        invoice={tipInvoice}
        qrDataUrl={tipQrDataUrl}
      />

      {/* ---- Footer ---- */}
      <div style={{
        marginTop: 8,
        paddingTop: 16,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        width: "min(92vw, 680px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: "rgba(255,255,255,0.35)",
      }}>
        <button
          onClick={() => window.open("https://primal.net/p/nprofile1qqsgghzf9zufmmtta8ysg8em6pqhzzg9xg89glyqpx79qe3g02eefugs96cxa", "_blank")}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 12, cursor: "pointer", padding: 0 }}
        >
          made with ♥ by chris21million
        </button>
        <button
          onClick={() => window.open("lightning:chris21million@rizful.com")}
          style={{
            background: "rgba(247,211,0,0.1)",
            border: "1px solid rgba(247,211,0,0.25)",
            borderRadius: 6,
            color: "#f7d300",
            fontSize: 12,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          ⚡ zap me
        </button>
      </div>
      {/* ---- End footer ---- */}

    </div>
  );
}