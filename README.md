# Lightning Chess⚡

A decentralized chess platform built on **Nostr** and powered by the **Lightning Network**.

## Features
- ♟️ Real-time chess gameplay via Nostr relays
- 🔐 Login with Nostr (npub / NIP-07 extension or nsec)
- ⚡ Lightning tips (zaps) for good moves or games
- 🤝 Challenge players directly via npub
- 🌐 Relay-based matchmaking and move synchronization

## Tech Stack
- React + TypeScript
- `chess.js` + Chessground
- `nostr-tools`
- Lightning Network (WebLN + LNURL)

## Getting Started

```bash
git clone https://github.com/chris21million/lightning-chess.git
cd lightning-chess
npm install
npm run dev
