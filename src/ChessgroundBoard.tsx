import { useEffect, useRef } from "react";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";

import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export default function ChessgroundBoard({
  game,
  onChange,
  onMove,
}: {
  game: Chess;
  onChange: () => void;
  onMove?: (from: string, to: string) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const config: Config = {
      fen: game.fen(),
      orientation: "white",
      turnColor: game.turn() === "w" ? "white" : "black",
      movable: {
        color: game.turn() === "w" ? "white" : "black",
        free: false,
        dests: calcDests(game),
        events: {
          after: (orig, dest) => {
            const move = game.move({ from: orig, to: dest, promotion: "q" });

            if (!move) {
              apiRef.current?.set({
                fen: game.fen(),
                movable: { dests: calcDests(game) },
              });
              return;
            }

            // tell parent which move was made (for Nostr publish)
            onMove?.(orig, dest);

            // tell parent to re-render / update UI
            onChange();

            // sync chessground UI
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
  }, [game, onChange, onMove]);

  // keep the UI in sync (so Reset updates the pieces)
  useEffect(() => {
    if (!apiRef.current) return;

    apiRef.current.set({
      fen: game.fen(),
      turnColor: game.turn() === "w" ? "white" : "black",
      movable: {
        color: game.turn() === "w" ? "white" : "black",
        dests: calcDests(game),
      },
    });
  });

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
