////////////////////////////////////////
// IMPORTS
////////////////////////////////////////
import { useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
////////////////////////////////////////
// END IMPORTS
////////////////////////////////////////

////////////////////////////////////////
// PROPS
////////////////////////////////////////
type Props = {
  game: Chess;
  currentGame?: { white: string; black: string } | null;
  pubkey?: string | null;
  onChange: () => void;
  onMove?: (from: string, to: string) => void;
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
// COMPONENT
////////////////////////////////////////
export default function ChessgroundBoard({
  game,
  currentGame,
  pubkey,
  onChange,
  onMove,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  ////////////////////////////////////////
  // DERIVED — player color + turn
  ////////////////////////////////////////
  const myColor = currentGame && pubkey
    ? currentGame.white === pubkey
      ? "white"
      : currentGame.black === pubkey
      ? "black"
      : null
    : null;

  const isMyTurn = myColor && game.turn() === myColor[0];
  ////////////////////////////////////////
  // END DERIVED — player color + turn
  ////////////////////////////////////////

  ////////////////////////////////////////
  // DERIVED — captured pieces split by side
  // topCaptures = opponent's taken pieces (shown left)
  // bottomCaptures = your taken pieces (shown right)
  ////////////////////////////////////////
  const { byWhite, byBlack } = getCaptured(game);
  const topCaptures = myColor === "black" ? byWhite : byBlack;
  const bottomCaptures = myColor === "black" ? byBlack : byWhite;
  ////////////////////////////////////////
  // END DERIVED — captured pieces
  ////////////////////////////////////////

  ////////////////////////////////////////
  // EFFECT — init chessground board
  ////////////////////////////////////////
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const config: Config = {
      fen: game.fen(),
      orientation: myColor === "black" ? "black" : "white",
      turnColor: game.turn() === "w" ? "white" : "black",
      ////////////////////////////////////////
      // coordinates: false — prevents 12345678abcdefgh
      // labels from escaping outside the board div
      ////////////////////////////////////////
      coordinates: false,
      ////////////////////////////////////////
      // END coordinates fix
      ////////////////////////////////////////
      movable: {
        color: isMyTurn ? (myColor as "white" | "black") : undefined,
        free: false,
        dests: calcDests(game),
        events: {
          after: (orig, dest) => {
            const move = game.move({ from: orig, to: dest, promotion: "q" });
            if (!move) {
              apiRef.current?.set({ fen: game.fen(), movable: { dests: calcDests(game) } });
              return;
            }

            ////////////////////////////////////////
            // GAME OVER DETECTION
            ////////////////////////////////////////
            if (game.isGameOver()) {
              if (game.isCheckmate()) {
                setTimeout(() => alert(
                  game.turn() === "w"
                    ? "⬛ Black wins by checkmate!"
                    : "⬜ White wins by checkmate!"
                ), 100);
              } else if (game.isStalemate()) {
                setTimeout(() => alert("Draw — Stalemate!"), 100);
              } else if (game.isDraw()) {
                setTimeout(() => alert("Draw!"), 100);
              }
            }
            ////////////////////////////////////////
            // END GAME OVER DETECTION
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
          },
        },
      },
    };

    apiRef.current = Chessground(el, config);
    return () => {
      apiRef.current?.destroy?.();
      apiRef.current = null;
    };
  }, [game, currentGame, pubkey, isMyTurn, onChange, onMove]);
  ////////////////////////////////////////
  // END EFFECT — init chessground board
  ////////////////////////////////////////

  ////////////////////////////////////////
  // EFFECT — sync board on opponent move / reset
  ////////////////////////////////////////
  useEffect(() => {
    if (!apiRef.current) return;
    apiRef.current.set({
      fen: game.fen(),
      orientation: myColor === "black" ? "black" : "white",
      turnColor: game.turn() === "w" ? "white" : "black",
      movable: {
        color: isMyTurn ? (myColor as "white" | "black") : undefined,
        dests: calcDests(game),
      },
    });
  }, [game, currentGame, pubkey, isMyTurn]);
  ////////////////////////////////////////
  // END EFFECT — sync board
  ////////////////////////////////////////

  ////////////////////////////////////////
  // RENDER
  // Layout: [opponent captures col] [board] [my captures col]
  // overflow:hidden on board wrapper contains cg-wrap styles
  // and prevents the mini chessboard icon from leaking out
  ////////////////////////////////////////
  return (
    <div style={{
      width: "min(92vw, 680px)",
      display: "flex",
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 16,
    }}>

      {/* ---- Left column — opponent's captured pieces ---- */}
      <div style={{
        width: 36,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 4,
        gap: 2,
      }}>
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4, letterSpacing: 0.5 }}>
          {myColor === "black" ? "WHITE" : "BLACK"}
        </div>
        {topCaptures.map((p, i) => (
          <span key={i} style={{ fontSize: 26, lineHeight: 1.2 }}>{p}</span>
        ))}
      </div>
      {/* ---- End left column ---- */}

      {/* ---- Board — overflow:hidden stops cg-wrap leaking out ---- */}
      <div style={{
        flex: 1,
        minWidth: 0,
        aspectRatio: "1 / 1",
        position: "relative",
        overflow: "hidden",
      }}>
        <div
          ref={elRef}
          className="cg-wrap brown"
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
      {/* ---- End board ---- */}

      {/* ---- Right column — my captured pieces ---- */}
      <div style={{
        width: 36,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 4,
        gap: 2,
      }}>
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4, letterSpacing: 0.5 }}>
          {myColor === "black" ? "BLACK" : "WHITE"}
        </div>
        {bottomCaptures.map((p, i) => (
          <span key={i} style={{ fontSize: 26, lineHeight: 1.2 }}>{p}</span>
        ))}
      </div>
      {/* ---- End right column ---- */}

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