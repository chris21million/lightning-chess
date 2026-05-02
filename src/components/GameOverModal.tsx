import React from "react";

export type GameOverReason = "checkmate" | "stalemate" | "draw" | "timeout";
export type GameOverResult = "win" | "loss" | "draw";

export interface GameOverState {
  result: GameOverResult;
  reason: GameOverReason;
  opponentName: string;
}

interface Props {
  state: GameOverState | null;
  onLeave: () => void;
}

////////////////////////////////////////
// RESULT ICON — circle changes per outcome
////////////////////////////////////////
function ResultIcon({ result, reason }: { result: GameOverResult; reason: GameOverReason }) {
  const bg =
    result === "win" ? "rgba(74,222,128,0.15)"
    : result === "loss" ? "rgba(248,113,113,0.15)"
    : "rgba(148,163,184,0.15)";

  const color =
    result === "win" ? "#4ade80"
    : result === "loss" ? "#f87171"
    : "#94a3b8";

  const symbol =
    result === "draw" ? "½"
    : reason === "timeout" ? "⏱"
    : result === "win" ? "♔"
    : "♚";

  return (
    <div style={{
      width: 36,
      height: 36,
      borderRadius: "50%",
      background: bg,
      color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 16,
      fontWeight: 700,
      flexShrink: 0,
    }}>
      {symbol}
    </div>
  );
}
////////////////////////////////////////
// END RESULT ICON
////////////////////////////////////////

////////////////////////////////////////
// LABEL HELPERS
////////////////////////////////////////
function resultLabel(result: GameOverResult): string {
  if (result === "win") return "You won";
  if (result === "loss") return "You lost";
  return "Draw";
}

function reasonLabel(reason: GameOverReason, result: GameOverResult): string {
  if (reason === "checkmate") return "by checkmate";
  if (reason === "timeout") return result === "win" ? "opponent ran out of time" : "on time";
  if (reason === "stalemate") return "by stalemate";
  return "by agreement";
}
////////////////////////////////////////
// END LABEL HELPERS
////////////////////////////////////////

////////////////////////////////////////
// COMPONENT
////////////////////////////////////////
export default function GameOverModal({ state, onLeave }: Props) {
  if (!state) return null;

  const { result, reason, opponentName } = state;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      zIndex: 1300,
      display: "grid",
      placeItems: "center",
      padding: 16,
    }}>
      <div style={{
        width: "min(92vw, 360px)",
        background: "#1e1e1e",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxSizing: "border-box",
      }}>

        {/* Result line: icon + text */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ResultIcon result={result} reason={reason} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
              {resultLabel(result)}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
              {reasonLabel(reason, result)}
            </div>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />

        {/* Opponent name */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Opponent</span>
          <span style={{ fontSize: 13, color: "#e8e8e8", fontWeight: 500 }}>{opponentName}</span>
        </div>

        {/* Leave button */}
        <button
          onClick={onLeave}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: 7,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            background: "#f7d300",
            color: "#111",
            border: "none",
          }}
        >
          Leave game
        </button>

      </div>
    </div>
  );
}
////////////////////////////////////////
// END COMPONENT
////////////////////////////////////////