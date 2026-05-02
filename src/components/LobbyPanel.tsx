import { useProfile } from "../nostr/useProfile";
import ChallengePlayer from "../nostr/ChallengePlayer";
import { shortKey } from "../utils/lightning";
import { RELAYS } from "../nostr/constants";

interface Offer {
  id: string;
  pubkey: string;
  time: number;
  inc: number;
  color: string;
  created_at: number;
}

interface ActiveGame {
  gameId: string;
  white: string;
  black: string;
  time: number;
  inc: number;
}

interface Props {
  game: ActiveGame | null;
  pubkey: string | null;
  now: number;
  offers: Offer[];
  offerMinutes: number;
  setOfferMinutes: (v: number) => void;
  offerInc: number;
  setOfferInc: (v: number) => void;
  offerColor: string;
  setOfferColor: (v: any) => void;
  myOfferEventId: string | null;
  createOffer: () => void;
  cancelOffer: (id?: string) => void;
  acceptOffer: (o: Offer) => void;
  leaveGame: () => void;
  relayStatus: string;
  challengeNpub: string;
  setChallengeNpub: (v: string) => void;
  isChallenging: boolean;
  challengePlayer: () => void;
}

////////////////////////////////////////
// OFFER ROW — separate component so useProfile can be called per offer
////////////////////////////////////////
function OfferRow({
  o,
  now,
  pubkey,
  cancelOffer,
  acceptOffer,
}: {
  o: Offer;
  now: number;
  pubkey: string | null;
  cancelOffer: (id?: string) => void;
  acceptOffer: (o: Offer) => void;
}) {
  const displayName = useProfile(o.pubkey);
  const age = now - o.created_at;
  const expired = age > 300;
  const secondsLeft = Math.max(0, 300 - age);
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timer = `${minutes}:${String(seconds).padStart(2, "0")}`;
  const isMyOffer = pubkey === o.pubkey;

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: 10,
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        opacity: expired ? 0.35 : 1,
        transition: "opacity 0.5s",
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          {displayName || shortKey(o.pubkey)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          {Math.floor(o.time / 60)}m + {o.inc}s • host plays: {o.color}
        </div>
        <div style={{
          fontSize: 11,
          marginTop: 4,
          color: expired ? "#888" : secondsLeft < 60 ? "#ff6b6b" : "#88cc88",
        }}>
          {expired ? "⏰ Expired" : `⏱ ${timer}`}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {isMyOffer ? (
          <button onClick={() => cancelOffer(o.id)} style={{ color: "#ff6b6b" }}>
            Cancel
          </button>
        ) : (
          <button disabled={!pubkey || expired} onClick={() => acceptOffer(o)}>
            Accept
          </button>
        )}
      </div>
    </div>
  );
}
////////////////////////////////////////
// END OFFER ROW
////////////////////////////////////////

export default function LobbyPanel({
  game,
  pubkey,
  now,
  offers,
  offerMinutes,
  setOfferMinutes,
  offerInc,
  setOfferInc,
  offerColor,
  setOfferColor,
  myOfferEventId,
  createOffer,
  cancelOffer,
  acceptOffer,
  leaveGame,
  relayStatus,
  challengeNpub,
  setChallengeNpub,
  isChallenging,
  challengePlayer,
}: Props) {
  const whiteName = useProfile(game?.white ?? null);
  const blackName = useProfile(game?.black ?? null);

  return (
    <div
      style={{
        width: "min(92vw, 760px)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {game ? (
        <>
          <div style={{ fontWeight: 600 }}>Current game</div>
          <div style={{ fontSize: 12, opacity: 0.85, fontFamily: "monospace" }}>
            gameId: {game.gameId}
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            White: {whiteName || shortKey(game.white)} • Black: {blackName || shortKey(game.black)} •{" "}
            {Math.floor(game.time / 60)}m + {game.inc}s
          </div>
          <button onClick={leaveGame} style={{ width: "fit-content", padding: "6px 20px" }}>
            Leave game
          </button>
        </>
      ) : (
        <>
          <ChallengePlayer
            challengeNpub={challengeNpub}
            setChallengeNpub={setChallengeNpub}
            isChallenging={isChallenging}
            challengePlayer={challengePlayer}
            offerMinutes={offerMinutes}
            offerInc={offerInc}
            offerColor={offerColor}
          />

          {/* ---- Game settings + create offer ---- */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Create game</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>
                Relays: {relayStatus} ({RELAYS.length})
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 12, opacity: 0.85 }}>
                Time{" "}
                <input
                  type="number"
                  value={offerMinutes}
                  min={1}
                  onChange={(e) => setOfferMinutes(Number(e.target.value))}
                  style={{ width: 90, marginLeft: 6 }}
                />
              </label>
              <label style={{ fontSize: 12, opacity: 0.85 }}>
                Inc{" "}
                <input
                  type="number"
                  value={offerInc}
                  min={0}
                  onChange={(e) => setOfferInc(Number(e.target.value))}
                  style={{ width: 70, marginLeft: 6 }}
                />
              </label>
              <label style={{ fontSize: 12, opacity: 0.85 }}>
                Host plays{" "}
                <select
                  value={offerColor}
                  onChange={(e) => setOfferColor(e.target.value as any)}
                  style={{ marginLeft: 6 }}
                >
                  <option value="random">random</option>
                  <option value="white">white</option>
                  <option value="black">black</option>
                </select>
              </label>
              {myOfferEventId ? (
                <button onClick={cancelOffer}>Cancel Offer</button>
              ) : (
                <button onClick={createOffer} disabled={!pubkey}>
                  Create Offer
                </button>
              )}
              <button onClick={() => window.location.reload()}>Refresh Offers</button>
            </div>
          </div>
          {/* ---- End game settings ---- */}

          {/* ---- Offers list ---- */}
          <div style={{ opacity: 0.8, fontSize: 12 }}>Offers found: {offers.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {offers.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No offers yet.</div>
            ) : (
              offers.map((o) => (
                <OfferRow
                  key={o.id}
                  o={o}
                  now={now}
                  pubkey={pubkey}
                  cancelOffer={cancelOffer}
                  acceptOffer={acceptOffer}
                />
              ))
            )}
          </div>
          {/* ---- End offers list ---- */}
        </>
      )}
    </div>
  );
}