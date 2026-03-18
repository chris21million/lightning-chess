import { useCallback, useMemo, useState } from "react";
import { finalizeEvent, getPublicKey, nip19, type EventTemplate } from "nostr-tools";
import type { Signer } from "./types";

export function useAuth() {
  const [signer, setSigner] = useState<Signer>(null);
  const [nsecInput, setNsecInput] = useState("");

  const pubkey = signer?.pubkey ?? null;

  const hasNip07 = useMemo(() => {
    return typeof window !== "undefined" && !!window.nostr;
  }, []);

  const loginWithExtension = useCallback(async () => {
    if (!window.nostr) {
      alert("No NIP-07 extension found. Install Alby or nos2x.");
      return;
    }
    const pk = await window.nostr.getPublicKey();
    setSigner({ type: "nip07", pubkey: pk });
  }, []);

  const loginWithNsec = useCallback(() => {
    try {
      const decoded = nip19.decode(nsecInput.trim());
      if (decoded.type !== "nsec") throw new Error("Not an nsec");
      const sk = decoded.data as Uint8Array;
      const pk = getPublicKey(sk);
      setSigner({ type: "nsec", pubkey: pk, sk });
    } catch {
      alert("Invalid nsec.");
    }
  }, [nsecInput]);

  const logout = useCallback(() => {
    setSigner(null);
    setNsecInput("");
  }, []);

  const signEvent = useCallback(
    async (draft: EventTemplate) => {
      if (!signer) throw new Error("Not logged in");

      if (signer.type === "nip07") {
        if (!window.nostr) throw new Error("No NIP-07 extension found");
        return await window.nostr.signEvent(draft);
      }

      return finalizeEvent(draft, signer.sk);
    },
    [signer]
  );

  return {
    signer,
    setSigner, // optional, but handy
    pubkey,

    nsecInput,
    setNsecInput,

    hasNip07,
    loginWithExtension,
    loginWithNsec,
    logout,

    signEvent,
  };
}
