////////////////////////////////////////
// IMPORTS
////////////////////////////////////////
import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import type { GameOverState } from "./components/GameOverModal";
////////////////////////////////////////
// END IMPORTS
////////////////////////////////////////

////////////////////////////////////////
// PROPS
// opponentName — resolved display name passed in from App.tsx
// externalGameOver — game over state owned by App.tsx
// onTriggerGameOver — callback to set game over in App.tsx
////////////////////////////////////////
type Props = {
  game: Chess;
  currentGame?: { white: string; black: string; time: number; inc: number; gameId?: string } | null;
  pubkey?: string | null;
  opponentName?: string;
  onChange: () => void;
  onMove?: (from: string, to: string) => void;
  onLeaveGame?: () => void;
  externalGameOver?: GameOverState | null;
  onTriggerGameOver?: (result: GameOverState["result"], reason: GameOverState["reason"], opponentName: string) => void;
};
////////////////////////////////////////
// END PROPS
////////////////////////////////////////

////////////////////////////////////////
// PIECE SYMBOLS — unicode map for captured piece display
////////////////////////////////////////
const PIECE_SYMBOLS: Record<string, string> = {
  p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚",
  P: "♙", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔",
};
////////////////////////////////////////
// END PIECE SYMBOLS
////////////////////////////////////////

////////////////////////////////////////
// CAPTURED PIECES — derives taken pieces from move history
////////////////////////////////////////
function getCaptured(game: Chess): { byWhite: string[]; byBlack: string[] } {
  const byWhite: string[] = [];
  const byBlack: string[] = [];
  for (const move of game.history({ verbose: true }) as any[]) {
    if (!move.captured) continue;
    if (move.color === "w") byWhite.push(PIECE_SYMBOLS[move.captured.toUpperCase()]);
    else byBlack.push(PIECE_SYMBOLS[move.captured.toLowerCase()]);
  }
  return { byWhite, byBlack };
}
////////////////////////////////////////
// END CAPTURED PIECES
////////////////////////////////////////

////////////////////////////////////////
// FORMAT TIME — seconds to m:ss display
////////////////////////////////////////
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}
////////////////////////////////////////
// END FORMAT TIME
////////////////////////////////////////

////////////////////////////////////////
// TIMER DISPLAY — shows clock for one player
////////////////////////////////////////
function TimerDisplay({
  label, seconds, active, flagged,
}: {
  label: string; seconds: number; active: boolean; flagged: boolean;
}) {
  const low = seconds < 10;
  return (
    <div style={{
      width: "min(92vw, 680px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 12px",
      borderRadius: 6,
      background: active ? "rgba(247,211,0,0.1)" : "rgba(255,255,255,0.04)",
      border: active ? "1px solid rgba(247,211,0,0.3)" : "1px solid rgba(255,255,255,0.08)",
      transition: "background 0.3s, border 0.3s",
    }}>
      <span style={{ fontSize: 13, opacity: 0.6 }}>{label}</span>
      <span style={{
        fontFamily: "monospace",
        fontSize: 22,
        fontWeight: 700,
        color: flagged ? "#ff4444" : low && active ? "#ff9944" : "#fff",
        transition: "color 0.3s",
      }}>
        {flagged ? "0:00 🏳" : formatTime(seconds)}
      </span>
    </div>
  );
}
////////////////////////////////////////
// END TIMER DISPLAY
////////////////////////////////////////

////////////////////////////////////////
// COMPONENT
////////////////////////////////////////
export default function ChessgroundBoard({
  game,
  currentGame,
  pubkey,
  opponentName = "Opponent",
  onChange,
  onMove,
  onLeaveGame,
  externalGameOver,
  onTriggerGameOver,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  ////////////////////////////////////////
  // DERIVED — player color + turn
  ////////////////////////////////////////
  const myColor = currentGame && pubkey
    ? currentGame.white === pubkey ? "white"
    : currentGame.black === pubkey ? "black"
    : null
    : null;

  const isMyTurn = myColor && game.turn() === myColor[0];
  ////////////////////////////////////////
  // END DERIVED — player color + turn
  ////////////////////////////////////////

  ////////////////////////////////////////
  // DERIVED — captured pieces split by side
  ////////////////////////////////////////
  const { byWhite, byBlack } = getCaptured(game);
  const topCaptures = myColor === "black" ? byWhite : byBlack;
  const bottomCaptures = myColor === "black" ? byBlack : byWhite;
  ////////////////////////////////////////
  // END DERIVED — captured pieces
  ////////////////////////////////////////

  ////////////////////////////////////////
  // STATE — clocks
  ////////////////////////////////////////
  const initTime = currentGame?.time ?? 0;
  const inc = currentGame?.inc ?? 0;

  const [whiteTime, setWhiteTime] = useState(initTime);
  const [blackTime, setBlackTime] = useState(initTime);
  const [flagged, setFlagged] = useState<"white" | "black" | null>(null);

  const whiteTimeRef = useRef(initTime);
  const blackTimeRef = useRef(initTime);
  const flaggedRef = useRef<"white" | "black" | null>(null);
  ////////////////////////////////////////
  // END STATE — clocks
  ////////////////////////////////////////

  ////////////////////////////////////////
  // REF — keep latest opponentName for use inside effects/callbacks
  ////////////////////////////////////////
  const opponentNameRef = useRef(opponentName);
  useEffect(() => {
    opponentNameRef.current = opponentName;
  }, [opponentName]);
  ////////////////////////////////////////
  // END REF — opponentName
  ////////////////////////////////////////

  ////////////////////////////////////////
  // HELPER — trigger game over via App.tsx callback
  ////////////////////////////////////////
  const triggerGameOver = (
    result: GameOverState["result"],
    reason: GameOverState["reason"]
  ) => {
    onTriggerGameOver?.(result, reason, opponentNameRef.current);
  };
  ////////////////////////////////////////
  // END HELPER
  ////////////////////////////////////////

  ////////////////////////////////////////
  // EFFECT — reset clocks when new game starts
  ////////////////////////////////////////
  useEffect(() => {
    const t = currentGame?.time ?? 0;
    setWhiteTime(t);
    setBlackTime(t);
    whiteTimeRef.current = t;
    blackTimeRef.current = t;
    setFlagged(null);
    flaggedRef.current = null;
  }, [currentGame?.gameId]);
  ////////////////////////////////////////
  // END EFFECT — reset clocks
  ////////////////////////////////////////

  ////////////////////////////////////////
  // EFFECT — clock tick
  // White ticks immediately from game start
  // Swaps to opponent after each move
  ////////////////////////////////////////
  useEffect(() => {
    if (!currentGame || initTime <= 0 || flaggedRef.current) return;

    const interval = setInterval(() => {
      if (flaggedRef.current) { clearInterval(interval); return; }

      const turn = game.turn();

      if (turn === "w") {
        whiteTimeRef.current -= 1;
        setWhiteTime(whiteTimeRef.current);
        if (whiteTimeRef.current <= 0) {
          flaggedRef.current = "white";
          setFlagged("white");
          clearInterval(interval);
          triggerGameOver(myColor === "black" ? "win" : "loss", "timeout");
        }
      } else {
        blackTimeRef.current -= 1;
        setBlackTime(blackTimeRef.current);
        if (blackTimeRef.current <= 0) {
          flaggedRef.current = "black";
          setFlagged("black");
          clearInterval(interval);
          triggerGameOver(myColor === "white" ? "win" : "loss", "timeout");
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentGame?.gameId, flagged]);
  ////////////////////////////////////////
  // END EFFECT — clock tick
  ////////////////////////////////////////

  ////////////////////////////////////////
  // EFFECT — init chessground board
  ////////////////////////////////////////
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const isGameOver = !!externalGameOver;

    const config: Config = {
      fen: game.fen(),
      orientation: myColor === "black" ? "black" : "white",
      turnColor: game.turn() === "w" ? "white" : "black",
      coordinates: true,
      lastMove: (() => {
        const history = game.history({ verbose: true }) as any[];
        const last = history[history.length - 1];
        return last ? [last.from, last.to] : undefined;
      })(),
      movable: {
        // board locked when game is over
        color: isMyTurn && !isGameOver ? (myColor as "white" | "black") : undefined,
        free: false,
        dests: isGameOver ? new Map() : calcDests(game),
        events: {
          after: (orig, dest) => {
            if (externalGameOver) return;

            const move = game.move({ from: orig, to: dest, promotion: "q" });
            if (!move) {
              apiRef.current?.set({ fen: game.fen(), movable: { dests: calcDests(game) } });
              return;
            }

            ////////////////////////////////////////
            // INCREMENT — add inc to player who just moved
            ////////////////////////////////////////
            if (inc > 0) {
              if (move.color === "w") {
                whiteTimeRef.current += inc;
                setWhiteTime(whiteTimeRef.current);
              } else {
                blackTimeRef.current += inc;
                setBlackTime(blackTimeRef.current);
              }
            }
            ////////////////////////////////////////
            // END INCREMENT
            ////////////////////////////////////////

           ////////////////////////////////////////
            // PUBLISH MOVE FIRST — before game over check
            // so checkmate move gets sent to relay
            ////////////////////////////////////////
            onMove?.(orig, dest);
            onChange();
            apiRef.current?.set({
              fen: game.fen(),
              turnColor: game.turn() === "w" ? "white" : "black",
              movable: {
                color: game.turn() === "w" ? "white" : "black",
                dests: calcDests(game),
              },
            });
            ////////////////////////////////////////
            // END PUBLISH MOVE
            ////////////////////////////////////////

            ////////////////////////////////////////
            // GAME OVER DETECTION — winner side only
            // Loser side is detected in useLobbyGame move subscription
            ////////////////////////////////////////
            if (game.isGameOver()) {
              if (game.isCheckmate()) {
                triggerGameOver(game.turn() !== myColor?.[0] ? "win" : "loss", "checkmate");
              } else if (game.isStalemate()) {
                triggerGameOver("draw", "stalemate");
              } else if (game.isDraw()) {
                triggerGameOver("draw", "draw");
              }
            }
            ////////////////////////////////////////
            // END GAME OVER DETECTION
            ////////////////////////////////////////
          },
        },
      },
    };

    apiRef.current = Chessground(el, config);
    return () => {
      apiRef.current?.destroy?.();
      apiRef.current = null;
    };
  }, [game, currentGame, pubkey, isMyTurn, onChange, onMove, externalGameOver]);
  ////////////////////////////////////////
  // END EFFECT — init chessground board
  ////////////////////////////////////////

  ////////////////////////////////////////
  // EFFECT — sync board on opponent move / reset
  ////////////////////////////////////////
  useEffect(() => {
    if (!apiRef.current) return;
    const isGameOver = !!externalGameOver;
    apiRef.current.set({
      fen: game.fen(),
      orientation: myColor === "black" ? "black" : "white",
      turnColor: game.turn() === "w" ? "white" : "black",
      lastMove: (() => {
        const history = game.history({ verbose: true }) as any[];
        const last = history[history.length - 1];
        return last ? [last.from, last.to] : undefined;
      })(),
      movable: {
        color: isMyTurn && !isGameOver ? (myColor as "white" | "black") : undefined,
        dests: isGameOver ? new Map() : calcDests(game),
      },
    });

    ////////////////////////////////////////
    // INCREMENT on opponent move
    ////////////////////////////////////////
    if (inc > 0 && game.history().length > 0) {
      const history = game.history({ verbose: true }) as any[];
      const lastMove = history[history.length - 1];
      if (lastMove?.color === "w") {
        whiteTimeRef.current += inc;
        setWhiteTime(whiteTimeRef.current);
      } else if (lastMove?.color === "b") {
        blackTimeRef.current += inc;
        setBlackTime(blackTimeRef.current);
      }
    }
    ////////////////////////////////////////
    // END INCREMENT on opponent move
    ////////////////////////////////////////

  }, [game, currentGame, pubkey, isMyTurn, externalGameOver]);
  ////////////////////////////////////////
  // END EFFECT — sync board
  ////////////////////////////////////////

  ////////////////////////////////////////
  // DERIVED — timer rows
  // Opponent on top, me on bottom
  ////////////////////////////////////////
  const topTimer = {
    label: myColor === "black" ? "White" : "Black",
    seconds: myColor === "black" ? whiteTime : blackTime,
    active: myColor === "black" ? game.turn() === "w" : game.turn() === "b",
    flagged: myColor === "black" ? flagged === "white" : flagged === "black",
  };
  const bottomTimer = {
    label: myColor === "black" ? "Black" : "White",
    seconds: myColor === "black" ? blackTime : whiteTime,
    active: myColor === "black" ? game.turn() === "b" : game.turn() === "w",
    flagged: myColor === "black" ? flagged === "black" : flagged === "white",
  };
  ////////////////////////////////////////
  // END DERIVED — timer rows
  ////////////////////////////////////////

  ////////////////////////////////////////
  // RENDER
  // GameOverModal is now rendered in App.tsx
  // ChessgroundBoard only renders board + timers + captures
  ////////////////////////////////////////
  return (
    <div style={{ width: "min(92vw, 680px)", display: "flex", flexDirection: "column", gap: 6 }}>

      {/* ---- Opponent timer (top) ---- */}
      {currentGame && initTime > 0 && <TimerDisplay {...topTimer} />}

      {/* ---- Board row ---- */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 16 }}>

        {/* ---- Left column — opponent's captured pieces ---- */}
        <div style={{ width: 36, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4, gap: 2 }}>
          <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4, letterSpacing: 0.5 }}>
            {myColor === "black" ? "WHITE" : "BLACK"}
          </div>
          {topCaptures.map((p, i) => (
            <span key={i} style={{ fontSize: 26, lineHeight: 1.2 }}>{p}</span>
          ))}
        </div>
        {/* ---- End left column ---- */}

        {/* ---- Board ---- */}
        <div style={{
  flex: 1,
  minWidth: 0,
  aspectRatio: "1 / 1",
  position: "relative",
  overflow: "visible",
}}>
  <div
    ref={elRef}
    className="cg-wrap brown"
    style={{ width: "100%", height: "100%", display: "block" }}
  />
</div>
        {/* ---- End board ---- */}

        {/* ---- Right column — my captured pieces ---- */}
        <div style={{ width: 36, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4, gap: 2 }}>
          <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4, letterSpacing: 0.5 }}>
            {myColor === "black" ? "BLACK" : "WHITE"}
          </div>
          {bottomCaptures.map((p, i) => (
            <span key={i} style={{ fontSize: 26, lineHeight: 1.2 }}>{p}</span>
          ))}
        </div>
        {/* ---- End right column ---- */}

      </div>
      {/* ---- End board row ---- */}

      {/* ---- My timer (bottom) ---- */}
      {currentGame && initTime > 0 && <TimerDisplay {...bottomTimer} />}

    </div>
  );
  ////////////////////////////////////////
  // END RENDER
  ////////////////////////////////////////
}
////////////////////////////////////////
// END COMPONENT
////////////////////////////////////////

////////////////////////////////////////
// UTILITY — calculate legal move destinations for chessground
////////////////////////////////////////
function calcDests(game: Chess) {
  const dests = new Map<string, string[]>();
  const moves = game.moves({ verbose: true }) as Array<{ from: string; to: string }>;
  for (const m of moves) {
    const arr = dests.get(m.from);
    if (arr) arr.push(m.to);
    else dests.set(m.from, [m.to]);
  }
  return dests;
}
////////////////////////////////////////
// END UTILITY
////////////////////////////////////////