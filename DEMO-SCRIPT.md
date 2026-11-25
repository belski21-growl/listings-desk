# Demo video script — Listings Desk (2–5 min)

Target: 4–5 minutes, screen recording + voiceover (English). Record after
the paid run is live so every receipt on screen is real. Repo commands run
from `~/workspace/scratch/telegraph-hackathon` (or the pushed GitHub repo).

## 0:00–0:20 — Problem

**On screen:** hackathon page / title card "Listings Desk — should we list
this token?"
**Say:** "An exchange lists a token. Before it does, someone has to answer:
is this contract safe, is the issuer clean, is the social presence real?
That review takes a listings analyst weeks. We built a desk that buys the
diligence instead."

## 0:20–0:50 — New input

**On screen:** terminal. Pick a token that is NOT USDC (so a reviewer can
re-run it themselves). Show the address on screen.
**Say:** "Give it any token contract address. Today: [TOKEN]. The desk
validates it on-chain first — if it's not a contract, it refuses to spend
a cent."
**Run:** `cd app && node listings-desk.mjs <TOKEN> --chain ethereum --free-check`
**Show:** the intent list with live miner counts.

## 0:50–2:00 — Live: 4 asks in parallel

**On screen:** terminal, live paid run.
**Run:** `TELEGRAPH_API_KEY=… node listings-desk.mjs <TOKEN> --chain ethereum --entity "<NAME>" --handle <@handle>`
**Say (while it runs):** "Four intents, bought in parallel from escrow —
contract audit, on-chain metrics, sanctions screening, social bot
detection. No wallet, no gas. Each answer comes back with the miner that
wrote it, a payment receipt, and a signal hash."
**Show as output lands:** miner names + costs per ask.

## 2:00–3:00 — The memo

**On screen:** the memo JSON + the printed verdict block.
**Say:** "Ninety seconds later: one signed memo. Verdict, risk score per
intent, a cost line, and a verification hash. For USDC the live memo read
LIST, 18 out of 100, for nine cents — all 18 points from the official
account being flagged likely-bot, not from the contract."
**Show:** `cat evidence/memo-*.json` (verdict, checks, verification_hash,
signed_by) and `cat evidence/ledger.jsonl` (one row per ask).

## 3:00–3:40 — Failure cases

**On screen:** terminal.
**Run:** `node listings-desk.mjs 0xZZZ --chain ethereum` → exit 2.
**Run:** `node listings-desk.mjs 0xa8484eBb1dE5FF18358CD1C57620ea13007f68Ac --chain ethereum` → exit 3, "holds no contract code".
**Say:** "It refuses to buy intelligence it can't use — bad address, or an
address with no code — and says so with an exit code instead of spending."

## 3:40–4:30 — Reproduce it

**On screen:** terminal, fresh clone steps.
**Run:** `npm install`, then `--free-check`, then `--dry-run`.
**Say:** "Anyone can reproduce this: install, free-check, dry-run with
mocked answers, then a live run with their own Anjoman key. Full steps in
TUTORIAL.md."

## 4:30–5:00 — Close

**On screen:** repo + docs links.
**Say:** "Testnet, nine cents a memo, every signal verifiable. Try another
token — and tell us what your exchange would want checked before listing.
Links in the description."

## Recording notes

- Keep the terminal font large; the memo JSON must be readable.
- Do NOT show the real API key on screen — set it in the environment
  before recording, or mask it.
- Keep the paid run uncut: the receipts are the proof.
- If an ask 504s (we hit one on the audit intent — backend gateway
  timeout ~60 s), keep the take and say so; the desk exits 4 and the
  retry is part of the honest story.
