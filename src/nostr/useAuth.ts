import { useCallback, useEffect, useState } from "react";
import { finalizeEvent, getPublicKey, nip19, type EventTemplate } from "nostr-tools";
import type { Signer } from "./types";

export function useAuth() {
  const [signer, setSigner] = useState<Signer>(null);
  const [nsecInput, setNsecInput] = useState("");

  const pubkey = signer?.pubkey ?? null;

  // Robust NIP-07 detection (extensions sometimes inject after first render)
  const [hasNip07, setHasNip07] = useState(false);

  useEffect(() => {
    const check = () => typeof window !== "undefined" && !!window.nostr;

    // Immediate check
    if (check()) {
      setHasNip07(true);
      return;
    }

    // Poll briefly (up to 5s)
    const interval = window.setInterval(() => {
      if (check()) {
        setHasNip07(true);
        window.clearInterval(interval);
      }
    }, 200);

    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
    }, 5000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, []);

  const loginWithExtension = useCallback(async () => {
    if (!window.nostr?.getPublicKey) {
      alert(
        "No NIP-07 extension found.\n\nInstall/enable nos2x or Alby, then refresh this page."
      );
      return;
    }

    try {
      const pk = await window.nostr.getPublicKey();
      setSigner({ type: "nip07", pubkey: pk });
    } catch (e) {
      console.error(e);
      alert("Extension rejected the request or failed.");
    }
  }, []);

  const loginWithNsec = useCallback(() => {
    try {
      const trimmed = nsecInput.trim();
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== "nsec") throw new Error("Not an nsec");

      const sk = decoded.data as Uint8Array;
      const pk = getPublicKey(sk);

      setSigner({ type: "nsec", pubkey: pk, sk });
      setNsecInput(""); // clear secret from UI after success
    } catch (e) {
      console.error(e);
      alert("Invalid nsec. It should start with nsec1...");
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
        if (!window.nostr?.signEvent) throw new Error("No NIP-07 signing available");
        return await window.nostr.signEvent(draft);
      }

      // nsec signer
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

