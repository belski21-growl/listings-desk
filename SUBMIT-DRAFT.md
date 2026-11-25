# Submit draft — Telegraph S2, Track 03 / Mission 01 (DRAFT, not submitted)

Fill from verified facts only. Placeholders marked [TODO]. Submit only
after the user reviews the finished entry and OKs it. Deadline:
1 Dec 2026 23:59 UTC = 2 Dec 2026 06:59 WIB.

## Project details

- **Project name:** Listings Desk
- **Track:** 03 Apps & Agents — **Mission:** 01 Exchange
- **One-liner:** An autonomous listings desk: give it a token contract
  address, it buys 4 Telegraph intents in parallel and returns a signed
  listing risk memo with a cost line answering "Should we list this token?"
- **Repo:** [TODO — GitHub link after push]
- **Demo video (2–5 min):** [TODO — link after recording; script in DEMO-SCRIPT.md]

## How to run

```bash
cd app
npm install   # ethers + @telegraphprotocol/telegraph-protocol-mcp

# Free read-only check (no payment)
node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum --free-check

# Full pipeline, mocked answers
node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum \
  --entity "Centre Consortium (USDC)" --handle @circle --dry-run

# Live paid run (Anjoman key, no gas)
TELEGRAPH_API_KEY=anjoman_… node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --chain ethereum --entity "Centre Consortium (USDC)" --handle @circle
```

## Evidence (all live, testnet)

- **Live memo:** `evidence/memo-A0b86991-1795586082867.json` — USDC, LIST
  18/100, $0.09, block 26490229, 25 Nov 2026 12:54 WIB.
  verification_hash:
  `0x0549c536d02748e672c26b3e58f683aa7a40615529f03ac7bebe01fe29cb562b`,
  signed_by `0x43eF891603390C899A1330d87045192E20E84076`.
- **Ledger:** `evidence/ledger.jsonl` — 4 rows, 4/4 signals verified.
- **Signal hashes:** audit `0x6db98538…`, on-chain `0x9c4a2134…`,
  sanctions `0x1199549b…`, social `0xae30ada9…` (verify at
  `GET /engine/v1/signal/{hash}` on devnode).
- **Tutorial:** `TUTORIAL.md` — "Build an autonomous listings desk on
  Telegraph in 30 minutes".
- **Public updates:** [TODO — links after posting #1 / #2 / #3 on X]
- **Independent dev tried it:** [TODO — still 0; biggest gap for the
  20 Content points]

## Public summary

> Exchanges take weeks to review a token listing. We built a desk that buys
> the diligence instead: contract audit + on-chain metrics + sanctions
> screening + social bot detection — 4 paid Telegraph intents, in parallel —
> and returns a signed risk memo with a cost line: "Should we list this
> token?" Live on testnet: 136 intents, our 4 have 20/46/31/17 miners. One
> live memo for USDC: LIST, 18/100, $0.09 of intelligence in 82 seconds.

## Commercial summary

1. **Buyer, how often?** Spot/derivative venues (e.g. Kraken, Gate.io,
   Binance) — every new listing + every surveillance alert; listing review
   is weekly per venue.
2. **Problem?** Listing review eats analyst-weeks, surveillance is bought
   per seat from one in-house model, counterparty checks force opening the
   book.
3. **Demo flow?** Problem → Telegraph request → intelligence + miner proof
   → observed cost → finished memo → how to try it.
4. **Cost?** ~$0.09/memo on testnet (4 asks); vs analyst-weeks. Mainnet:
   miner prices may change, $1/run cap in the app.
5. **Adoption path?** Internal listings-desk tool → memo-per-listing for
   small venues → surveillance feed sold back as a miner.

## Showcase permission

[TODO — confirm with user: allow Telegraph to showcase the project?]

## Pre-submit check

- [ ] Repo pushed to the user's GitHub, README final
- [ ] Demo video recorded + linked (real receipts on screen)
- [ ] Public updates #1, #2, #3 posted on separate dates + tutorial linked
- [ ] Independent dev evidence (or honest note that it is missing)
- [ ] Registration completed (email + 6-digit code)
- [ ] github.com/telegraphprotocol/bounties starred
- [ ] User reviewed this draft + OKs the submit
