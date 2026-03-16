import { useCallback, useRef, useState } from "react";
import { Chess } from "chess.js";
import ChessgroundBoard from "./ChessgroundBoard";

export default function App() {
  const gameRef = useRef(new Chess());

  // Force React to re-render after a move
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const reset = () => {
    gameRef.current.reset(); // reset the same Chess instance
    setTick(0); // trigger re-render + reset counter
  };

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

      <ChessgroundBoard game={gameRef.current} onChange={forceUpdate} />

      <button onClick={reset}>Reset</button>
    </div>
  );
}
