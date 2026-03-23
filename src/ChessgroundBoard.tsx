import { useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";

import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

type Props = {
  game: Chess;
  currentGame?: { white: string; black: string } | null;   // ← NEW: from useLobbyGame
  pubkey?: string | null;                                   // ← NEW: your pubkey
  onChange: () => void;
  onMove?: (from: string, to: string) => void;
};

export default function ChessgroundBoard({
  game,
  currentGame,
  pubkey,
  onChange,
  onMove,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  // Determine which color the current player is allowed to move
  const myColor = currentGame && pubkey
    ? currentGame.white === pubkey
      ? "white"
      : currentGame.black === pubkey
      ? "black"
      : null
    : null;

  const isMyTurn = myColor && game.turn() === myColor[0];

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const config: Config = {
      fen: game.fen(),
      orientation: myColor === "black" ? "black" : "white",   // auto-orient to your side
      turnColor: game.turn() === "w" ? "white" : "black",
      movable: {
        color: isMyTurn ? (myColor as "white" | "black") : undefined,   // ← THIS IS THE FIX
        free: false,
        dests: calcDests(game),
        events: {
          after: (orig, dest) => {
            const move = game.move({ from: orig, to: dest, promotion: "q" });

            if (!move) {
              apiRef.current?.set({ fen: game.fen(), movable: { dests: calcDests(game) } });
              return;
            }

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

  // Keep board in sync when game updates (opponent moves, reset, etc.)
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

  return (
    <div style={{ width: "min(92vw, 520px)", aspectRatio: "1 / 1" }}>
      <div
        ref={elRef}
        className="cg-wrap brown"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

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