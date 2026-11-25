# Build an autonomous listings desk on Telegraph in 30 minutes

An exchange lists a token. Before it does, someone has to answer: is this
contract safe, is the issuer clean, is the social presence real? That review
takes a listings analyst weeks. This tutorial builds a desk that buys the
diligence instead — four paid Telegraph intents, in parallel — and returns a
signed risk memo with a cost line. Total live cost for the example below:
**$0.09**. Time: about 90 seconds.

Repo: this directory. The desk is `app/listings-desk.mjs` (Node 20+,
`ethers` + `@telegraphprotocol/telegraph-protocol-mcp`).

## 1. The problem

A listing decision is four questions, and each one belongs to a different
specialist: a contract auditor, an on-chain data provider, a sanctions
screener, a social analyst. Hiring all four per token is slow and expensive.
Telegraph turns each one into a buyable **intent** — a machine-to-machine
purchase of intelligence, settled from escrow, with a signed receipt and a
verifiable signal hash. The desk asks all four at once and scores the
answers into one verdict: `LIST` or `HOLD`, 0–100 risk.

## 2. Intents, not products

An intent is a job description with a schema, not a vendor. The desk buys
the `*_GENERAL` variants, not a named miner family:

| Intent | Miners (testnet) | What it answers |
|---|---|---|
| `SMART_CONTRACT_AUDIT_GENERAL` | 20 | Reentrancy, owner privileges (mint, pause, blacklist, upgrade, selfdestruct), overflows, risk rating |
| `ONCHAIN_METRIC_VERIFY_GENERAL` | 46 | Native balance / tx history of an address at a block |
| `SANCTIONS_SCREENING_MATCH_GENERAL` | 31 | Name match against OFAC / EU / UN lists |
| `SOCIAL_BOT_DETECTION_GENERAL` | 17 | Bot vs human verdict + score for an X handle |

Buying `*_GENERAL` means the node routes to whichever miner can serve the
intent, and you pay that miner's price (~$0.01 each). You never pick a
miner by name, and you never negotiate.

## 3. Setup (5 minutes)

```bash
node --version   # 20+
npm install      # ethers + @telegraphprotocol/telegraph-protocol-mcp
```

Money comes from an Anjoman account (no wallet, no gas): log in at
anjoman.ai, claim test USDC from the faucet (5 test USDC per claim, 1 claim
per 24h), deposit it into escrow, create an API key. The key pays from
escrow — a $4 deposit covered every run in this repo with room to spare.

```bash
export TELEGRAPH_API_KEY=anjoman_…
```

## 4. Your first ask

Start free, no payment:

```bash
cd app
node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum --free-check
```

That validates the token is a contract, lists the four intents with their
miner counts, and exits. Then run the full pipeline with mocked answers:

```bash
node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum \
  --entity "Centre Consortium (USDC)" --handle @circle --dry-run
```

The live run is the same command without `--dry-run`. Under the hood the
desk calls `askAuto`, which POSTs to `/engine/ask` on
`backend.telegraphprotocol.com` with `Authorization: Bearer <key>`. The
response nests the answer under `result`: the payload itself, a
`signal_hash`, a `payments` list, a `cost_usd`, and the miner name. A
`receipt` arrives alongside it on the escrow rail. (One gotcha we hit live:
the backend rejects a `max_budget_usdc` field outright — omit it and each
ask goes to one miner.)

## 5. Four intents become one memo

Each intent scores 0–25 points. The desk maps the answers to flags:

- **Audit** — a high finding is 25, medium 10, `SELFDESTRUCT` 10, owner
  mint 5, upgradeable/proxy 5, pause/blacklist 3.
- **On-chain** — a large native balance held by a token contract is 15;
  a normal ~0 balance is 0.
- **Sanctions** — a match is 25 (hard fail). No match is 0.
- **Social** — `bot` is 25, `likely_bot` 18, `inconclusive` 10,
  `likely_human` 5, `human` 0.

Our live USDC memo (25 Nov 2026, block 26490229, 82 s):

```text
Verdict: LIST  risk 18/100
- SMART_CONTRACT_AUDIT: 0/25 — no high-risk flags in answer
  (miner: secrev-circl-last, $0.0100)
- ONCHAIN_METRIC_VERIFY: 0/25 — native balance 0 gwei (normal for a token contract)
  (miner: txlens, chainsight-oracle, $0.0200)
- SANCTIONS_SCREENING_MATCH: 0/25 — no sanctions match
  (miner: san-os-ofac, san-un-list, zk-sanctions, $0.0300)
- SOCIAL_BOT_DETECTION: 18/25 — verdict: likely_bot (score 0.8)
  (miner: chainsight-oracle, a1-preflight, txlens, $0.0300)
COST LINE: $0.0900 for 4 paid Telegraph requests — mode anjoman-key
verification_hash: 0x0549c536d02748e672c26b3e58f683aa7a40615529f03ac7bebe01fe29cb562b
signed_by: 0x43eF891603390C899A1330d87045192E20E84076
```

All 18 points come from one place: the official @circle account was flagged
`likely_bot` (score 0.8) — corporate accounts with automated posting
patterns trip bot detectors. The contract itself is clean: no high-risk
flags, no sanctions match, zero native balance. The memo says LIST, and it
says why in one line each. The full signed memo is
`evidence/memo-A0b86991-1795586082867.json`.

## 6. Verify it yourself

Don't trust the memo — check it. Every answer carries a `signal_hash`:

```bash
curl https://devnode.telegraphprotocol.com/engine/v1/signal/0x6db98538e49c3fe4641ccab657f37bcd4fa3c189f121f7d99b37f6a1fa5a839d
```

And the ledger is append-only, one row per ask:

```bash
cat evidence/ledger.jsonl
# {"intent":"SMART_CONTRACT_AUDIT_GENERAL","miner":["secrev-circl-last"],
#  "cost_uusdc":10000,"signal_hash":"0x6db9…","signal_verified":true, ...}
```

Four rows, four verified signals, one memo. Anyone can re-run the same
command against the same block and get the same answers.

## 7. When it fails

The desk refuses to buy intelligence it can't use, and says so with an
exit code:

| Case | Result |
|---|---|
| Invalid address | exit 2 |
| EOA / undeployed address | exit 3 — "holds no contract code" |
| No payment configured | exit 4 |
| Escrow too low (< $0.20) | exit 4 before any ask |
| Ask refused / backend timeout | exit 4, no memo |

One honest failure we hit: the audit ask once returned HTTP 504 — the
backend gateway timed out waiting for the miner (~60 s). The ask was still
billed $0.02. Failed asks are **not** free on this node: across three runs
and two probes we accrued $0.19 in unbilled spend, including the 504. Budget
for it; the run cap is $1.00.

## 8. Honest costs and limits

- Live memo: **$0.09** (audit $0.01, on-chain $0.02, sanctions $0.03,
  social $0.03). Dry-run mock: $0.04.
- Cap: $1.00 per run, enforced in the desk.
- The audit intent is still `registered` on testnet; the on-chain metric
  currently served is `balance`. More metrics are coming.
- Testnet prices are miner-set and can change; mainnet will differ.
- The social verdict is the noisiest signal — a corporate account can score
  `likely_bot`. Treat it as a flag, not a verdict on its own.

## 9. Next step

Point the desk at another token — a reviewer can reproduce the whole thing
with one command — and compare memos. Then open a PR or an issue, or tag
@Telegraphprotoc with what your exchange would want checked before listing.
