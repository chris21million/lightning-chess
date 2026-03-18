export type Signer =
  | { type: "nip07"; pubkey: string }
  | { type: "nsec"; pubkey: string; sk: Uint8Array }
  | null;

export type Offer = {
  id: string;
  pubkey: string;
  created_at: number;
  offerId: string;
  time: number;
  inc: number;
  color: "white" | "black" | "random";
};

export type Game = {
  gameId: string;
  offerEventId: string;
  white: string;
  black: string;
  time: number;
  inc: number;
};
