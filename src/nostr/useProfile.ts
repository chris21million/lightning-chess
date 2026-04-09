import { useEffect, useState } from "react";
import { SimplePool } from "nostr-tools";
import { RELAYS } from "./constants";

export function useProfile(pubkey: string | null) {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) return;

    // Check cache first
    const cached = localStorage.getItem(`pawnstr:metadata:${pubkey}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setDisplayName(parsed.display_name || parsed.name || null);
        return;
      } catch {}
    }

    // Fetch from relays
    const pool = new SimplePool();
    const sub = pool.subscribeMany(
      RELAYS,
      [{ kinds: [0], authors: [pubkey], limit: 1 }],
      {
        onevent(ev) {
          try {
            const parsed = JSON.parse(ev.content);
            const name = parsed.display_name || parsed.name || null;
            setDisplayName(name);
            localStorage.setItem(`pawnstr:metadata:${pubkey}`, ev.content);
          } catch {}
        },
        oneose() {
          try { sub.close(); } catch {}
          try { pool.close(RELAYS); } catch {}
        },
      }
    );

    return () => {
      try { sub.close(); } catch {}
      try { pool.close(RELAYS); } catch {}
    };
  }, [pubkey]);

  return displayName;
}