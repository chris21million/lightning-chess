import { useCallback } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: string;
  qrDataUrl: string;
}

export default function TipModal({ open, onClose, invoice, qrDataUrl }: Props) {
  const payWithWebLN = useCallback(async () => {
    try {
      if (!invoice) return;
      const w = (window as any).webln;
      if (w?.enable && w?.sendPayment) {
        await w.enable();
        await w.sendPayment(invoice);
        alert("Tip sent ✅");
        onClose();
        return;
      }
      await navigator.clipboard.writeText(invoice);
      alert("WebLN not found. Invoice copied.");
    } catch (e: any) {
      console.error(e);
      alert(`Payment failed: ${e?.message ?? e}`);
    }
  }, [invoice, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
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
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
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
          {invoice}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={payWithWebLN}>Pay with WebLN</button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(invoice);
              alert("Invoice copied");
            }}
          >
            Copy invoice
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}