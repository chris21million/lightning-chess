import { useCallback, useEffect, useState } from "react";
import { finalizeEvent, getPublicKey, nip19, type EventTemplate } from "nostr-tools";
import type { Signer } from "./types";

const STORAGE_KEY = "pawnstr:signer";

export function useAuth() {
  const [signer, setSigner] = useState<Signer>(null);
  const [nsecInput, setNsecInput] = useState("");

  const pubkey = signer?.pubkey ?? null;

  // RESTORE SESSION ON LOAD
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);

      if (
        parsed &&
        parsed.type === "nip07" &&
        typeof parsed.pubkey === "string"
      ) {
        setSigner(parsed);
        return;
      }

      if (
        parsed &&
        parsed.type === "nsec" &&
        typeof parsed.pubkey === "string" &&
        Array.isArray(parsed.sk)
      ) {
        setSigner({
          type: "nsec",
          pubkey: parsed.pubkey,
          sk: new Uint8Array(parsed.sk),
        });
      }
    } catch (e) {
      console.error("Failed to restore signer", e);
    }
  }, []);

  // Robust NIP-07 detection
  const [hasNip07, setHasNip07] = useState(false);

  useEffect(() => {
    const check = () => typeof window !== "undefined" && !!window.nostr;

    if (check()) {
      setHasNip07(true);
      return;
    }

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

      const signerObj = { type: "nip07", pubkey: pk } as const;

      setSigner(signerObj);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(signerObj));
    } catch (e) {
      console.error(e);
      alert("Extension rejected the request or failed.");
    }
  }, []);

  const loginWithNsec = useCallback(() => {
    const confirmed = window.confirm(
      "Warning: Pasting your nsec is dangerous.\n\nThis gives the website access to your private key. Only continue if you trust this site and understand the risk.\n\nDo you want to continue?"
    );

    if (!confirmed) return;

    try {
      const trimmed = nsecInput.trim();
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== "nsec") throw new Error("Not an nsec");

      const sk = decoded.data as Uint8Array;
      const pk = getPublicKey(sk);

      const signerObj = {
        type: "nsec" as const,
        pubkey: pk,
        sk,
      };

      setSigner(signerObj);
      setNsecInput("");

      // EASY BUT UNSAFE: persist secret key in localStorage
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          type: "nsec",
          pubkey: pk,
          sk: Array.from(sk),
        })
      );
    } catch (e) {
      console.error(e);
      alert("Invalid nsec. It should start with nsec1...");
    }
  }, [nsecInput]);

  const logout = useCallback(() => {
    setSigner(null);
    setNsecInput("");
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const signEvent = useCallback(
    async (draft: EventTemplate) => {
      if (!signer) throw new Error("Not logged in");

      if (signer.type === "nip07") {
        if (!window.nostr?.signEvent) {
          throw new Error("No NIP-07 signing available");
        }
        return await window.nostr.signEvent(draft);
      }

      return finalizeEvent(draft, signer.sk);
    },
    [signer]
  );

  return {
    signer,
    setSigner,
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
