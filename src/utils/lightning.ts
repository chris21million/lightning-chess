export function shortKey(pubkey: string): string {
  return pubkey.slice(0, 8) + "..." + pubkey.slice(-4);
}

export function looksLikeBolt11(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("lnbc") || v.startsWith("lntb") || v.startsWith("lnbcrt");
}

export function looksLikeLightningAddress(value: string): boolean {
  const v = value.trim();
  if (!v.includes("@")) return false;
  const [name, domain] = v.split("@");
  return Boolean(name && domain && !domain.includes(" "));
}

export async function getBolt11FromRecipient(
  recipientRaw: string,
  sats: number
): Promise<string> {
  const recipient = recipientRaw.trim().replace(/^lightning:/i, "");

  if (!recipient) throw new Error("Recipient is required.");
  if (looksLikeBolt11(recipient)) return recipient;
  if (!looksLikeLightningAddress(recipient)) {
    throw new Error("Enter a valid lightning address (name@domain) or bolt11 invoice.");
  }

  const [name, domain] = recipient.split("@");
  const wellKnown = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;

  const info = await fetchJson(wellKnown);
  if (!info?.callback) {
    throw new Error("Lightning address did not return a callback endpoint.");
  }

  const amountMsat = Math.round(sats * 1000);
  const minSendable = Number(info.minSendable ?? 1);
  const maxSendable = Number(info.maxSendable ?? Number.MAX_SAFE_INTEGER);

  if (amountMsat < minSendable) throw new Error("Amount is below minimum for this address.");
  if (amountMsat > maxSendable) throw new Error("Amount is above maximum for this address.");

  const cb = new URL(String(info.callback));
  cb.searchParams.set("amount", String(amountMsat));

  const payReq = await fetchJson(cb.toString());
  const pr = String(payReq?.pr ?? payReq?.paymentRequest ?? "");

  if (!pr || !looksLikeBolt11(pr))
    throw new Error("Failed to get a valid lightning invoice.");

  return pr;
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} while requesting payment data.`);
  return r.json();
}