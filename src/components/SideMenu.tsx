import { useCallback, useState } from "react";
import * as QRCode from "qrcode";
import { getBolt11FromRecipient } from "../utils/lightning";

interface Props {
  open: boolean;
  onClose: () => void;
  pubkey: string | null;
  shortPk: string;
  shownName: string;
  avatar: string | null;
  lightning: string | null;
  isLoadingMetadata: boolean;
  refreshMetadata: () => void;
  hasNip07: boolean;
  loginWithExtension: () => void;
  loginWithNsec: () => void;
  logout: () => void;
  nsecInput: string;
  setNsecInput: (v: string) => void;
  onTipQrReady: (invoice: string, qrDataUrl: string) => void;
}

export default function SideMenu({
  open,
  onClose,
  pubkey,
  shortPk,
  shownName,
  avatar,
  lightning,
  isLoadingMetadata,
  refreshMetadata,
  hasNip07,
  loginWithExtension,
  loginWithNsec,
  logout,
  nsecInput,
  setNsecInput,
  onTipQrReady,
}: Props) {
  const [tipRecipient, setTipRecipient] = useState("");
  const [tipSats, setTipSats] = useState(100);
  const [tipBusy, setTipBusy] = useState(false);

  const sendTip = useCallback(async () => {
    try {
      setTipBusy(true);
      const sats = Number(tipSats);
      if (!Number.isFinite(sats) || sats <= 0)
        throw new Error("Tip amount must be greater than 0 sats.");
      const invoice = await getBolt11FromRecipient(tipRecipient, sats);
      const qr = await QRCode.toDataURL(invoice, { width: 320, margin: 1 });
      onTipQrReady(invoice, qr);
    } catch (e: any) {
      console.error(e);
      alert(`Tip failed: ${e?.message ?? e}`);
    } finally {
      setTipBusy(false);
    }
  }, [tipRecipient, tipSats, onTipQrReady]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
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
        {/* ---- Profile block ---- */}
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
                  <button onClick={() => refreshMetadata()} disabled={isLoadingMetadata}>
                    {isLoadingMetadata ? "Refreshing..." : "Refresh profile"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.85, fontSize: 12 }}>Not logged in</div>
          )}
        </div>
        {/* ---- End profile block ---- */}

        {/* ---- Tip block ---- */}
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
              <button onClick={sendTip} disabled={tipBusy || !tipRecipient.trim()}>
                {tipBusy ? "Creating..." : "Create tip QR"}
              </button>
            </div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              Purely voluntary tips • Good game / nice move
            </div>
          </div>
        </div>
        {/* ---- End tip block ---- */}

        {/* ---- Auth buttons ---- */}
        {pubkey && (
          <button onClick={logout} style={{ width: "100%" }}>
            Logout
          </button>
        )}
        {!pubkey && (
          <button onClick={loginWithExtension} disabled={!hasNip07} style={{ width: "100%" }}>
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
        {/* ---- End auth buttons ---- */}
      </div>
    </div>
  );
}