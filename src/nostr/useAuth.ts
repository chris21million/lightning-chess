// src/nostr/useAuth.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  finalizeEvent,
  getPublicKey,
  nip19,
  type EventTemplate,
  SimplePool,
} from "nostr-tools";
import type { Signer } from "./types";
import { RELAYS } from "./constants";

const STORAGE_KEY = "pawnstr:signer";

const getStorage = () =>
  import.meta.env.DEV ? sessionStorage : localStorage;

const META_KEY_PREFIX = "pawnstr:metadata:";
const metadataKey = (pubkey: string) => `${META_KEY_PREFIX}${pubkey}`;

// FIX: fully defined type instead of empty placeholder
export type UserMetadata = {
  name?: string;
  display_name?: string;
  picture?: string;
  image?: string;
  lud16?: string;
  lud06?: string;
  about?: string;
  website?: string;
  nip05?: string;
  banner?: string;
};

function parseMetadata(content: string): UserMetadata {
  try {
    return (JSON.parse(content || "{}") as UserMetadata) ?? {};
  } catch {
    return {};
  }
}

export function useAuth() {
  const [signer, setSigner] = useState<Signer>(null);
  const [nsecInput, setNsecInput] = useState("");
  const [metadata, setMetadata] = useState<UserMetadata>({});
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);

  const pubkey = signer?.pubkey ?? null;
  const hasNip07 =
    typeof window !== "undefined" && !!(window as any).nostr;

  // ==================== RESTORE LOGIN ====================
  useEffect(() => {
    const storage = getStorage();
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);

      if (parsed?.type === "nip07" && parsed?.pubkey) {
        setSigner({ type: "nip07", pubkey: parsed.pubkey });
        return;
      }

      if (
        parsed?.type === "nsec" &&
        parsed?.pubkey &&
        Array.isArray(parsed?.sk)
      ) {
        setSigner({
          type: "nsec",
          pubkey: parsed.pubkey,
          sk: Uint8Array.from(parsed.sk),
        });
      }
    } catch (e) {
      console.error("Failed to restore signer", e);
    }
  }, []);

  // Load cached metadata when pubkey changes
  useEffect(() => {
    if (!pubkey) {
      setMetadata({});
      return;
    }
    const cached = localStorage.getItem(metadataKey(pubkey));
    if (!cached) return;
    try {
      setMetadata(JSON.parse(cached));
    } catch {}
  }, [pubkey]);

  // ==================== FETCH METADATA ====================
  const fetchMetadata = useCallback(
    async (pk: string, force = false) => {
      if (!pk) return;

      if (!force) {
        const cached = localStorage.getItem(metadataKey(pk));
        if (cached) {
          try {
            setMetadata(JSON.parse(cached));
          } catch {}
          // Still return early — only fetch fresh when forced
          return;
        }
      }

      setIsLoadingMetadata(true);
      const pool = new SimplePool();

      try {
        let latest: any = null;

        await new Promise<void>((resolve) => {
          const sub = pool.subscribeMany(
            RELAYS,
            [{ kinds: [0], authors: [pk], limit: 20 }],
            {
              onevent(ev) {
                if (!latest || ev.created_at > latest.created_at)
                  latest = ev;
              },
              oneose() {
                try { sub.close(); } catch {}
                resolve();
              },
            }
          );

          setTimeout(() => {
            try { sub.close(); } catch {}
            resolve();
          }, 2500);
        });

        if (latest?.content) {
          const parsed = parseMetadata(latest.content);
          setMetadata(parsed);
          localStorage.setItem(metadataKey(pk), JSON.stringify(parsed));
        }
      } catch (e) {
        console.error("Failed to fetch metadata", e);
      } finally {
        try { pool.close(RELAYS); } catch {}
        setIsLoadingMetadata(false);
      }
    },
    []
  );

  // Fetch on login
  useEffect(() => {
    if (!pubkey) return;
    fetchMetadata(pubkey);
  }, [pubkey, fetchMetadata]);

  // ==================== LOGIN ====================
  const loginWithExtension = useCallback(async () => {
    const nostr = (window as any).nostr;
    if (!nostr?.getPublicKey) {
      alert("No NIP-07 extension found.");
      return;
    }
    try {
      const pk = await nostr.getPublicKey();
      const next: Signer = { type: "nip07", pubkey: pk };
      setSigner(next);
      getStorage().setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error(e);
      alert("Extension login failed.");
    }
  }, []);

  const loginWithNsec = useCallback(() => {
    const raw = nsecInput.trim();
    if (!raw) return alert("Paste nsec first.");

    try {
      const decoded = nip19.decode(raw);
      if (decoded.type !== "nsec") return alert("Invalid nsec.");

      const sk = decoded.data as Uint8Array;
      const pk = getPublicKey(sk);

      const next: Signer = { type: "nsec", pubkey: pk, sk };
      setSigner(next);
      getStorage().setItem(
        STORAGE_KEY,
        JSON.stringify({ type: "nsec", pubkey: pk, sk: Array.from(sk) })
      );
    } catch (e) {
      console.error(e);
      alert("Invalid nsec.");
    }
  }, [nsecInput]);

  const logout = useCallback(() => {
    setSigner(null);
    setNsecInput("");
    setMetadata({});
    getStorage().removeItem(STORAGE_KEY);
  }, []);

  // ==================== SIGN ====================
  const signEvent = useCallback(
    async (draft: EventTemplate) => {
      if (!signer) throw new Error("Not logged in");
      if (signer.type === "nip07") {
        return await (window as any).nostr!.signEvent(draft);
      }
      return finalizeEvent(draft, signer.sk);
    },
    [signer]
  );

  // ==================== REFRESH ====================
  const refreshMetadata = useCallback(() => {
    if (pubkey) fetchMetadata(pubkey, true);
  }, [pubkey, fetchMetadata]);

  // ==================== DERIVED ====================
  const displayName = useMemo(
    () =>
      metadata.display_name ||
      metadata.name ||
      (pubkey ? `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}` : ""),
    [metadata, pubkey]
  );

  const avatar = metadata.picture || metadata.image || "";
  const lightning = metadata.lud16 || metadata.lud06 || "";

  return {
    signer,
    pubkey,
    hasNip07,
    nsecInput,
    setNsecInput,
    loginWithExtension,
    loginWithNsec,
    logout,
    signEvent,
    metadata,
    displayName,
    avatar,
    lightning,
    isLoadingMetadata,
    refreshMetadata,
  };
}