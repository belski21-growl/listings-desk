# Listings Desk — Telegraph Hackathon Season II

**Track 03 Apps & Agents · Mission 01 Exchange.**
An autonomous listings desk: give it a token contract address, it buys 4 intents
through Telegraph testnet in parallel and returns a **signed listing risk memo
with a cost line** answering: *Should we list this token?*

- `SMART_CONTRACT_AUDIT_GENERAL` (20 miners) — bytecode/source audit
- `ONCHAIN_METRIC_VERIFY_GENERAL` (46 miners) — on-chain balance/state
- `SANCTIONS_SCREENING_MATCH_GENERAL` (31 miners) — OFAC/EU/UN screening
- `SOCIAL_BOT_DETECTION_GENERAL` (17 miners) — bot-vs-human social check

Miner counts verified live against `https://devnode.telegraphprotocol.com/engine/v1/intents`
on 25 Nov 2026. Network: **testnet** (Ethereum Sepolia escrow). No mainnet, no real money.

## How it works

```
token address ──► validate (EIP-55) + eth_getCode on chain
        │
        ├──► 4 parallel Telegraph asks (POST /engine/v1/ask, max $0.05 budget each)
        │      paid from escrow: Anjoman API key (no gas) or burner-wallet escrow (Sepolia)
        │      each answer carries miner provenance + payments + signal_hash
        ├──► re-verify every signal: GET /engine/v1/signal/{hash}
        ├──► append every ask to evidence/ledger.jsonl (intent, miner, cost, latency, hash)
        └──► score 0–100 (25/intent) ──► verdict LIST / LIST_WITH_CONDITIONS / DO_NOT_LIST
             + cost line + SHA-256 verification hash + Ed25519-style signature (personal_sign)
```

Payment code is the **official** `@telegraphprotocol/telegraph-protocol-mcp`
package (v2.3.0) — `Payer` (wallet escrow) and `AnjomanApi` (key mode) — not a
reimplementation. Spending caps: $0.05/ask, $1.00/run. A failed ask is never
billed (protocol rule); on any ask failure no memo is produced.

## Run it

```bash
cd app
npm install   # ethers + @telegraphprotocol/telegraph-protocol-mcp

# 1. Free read-only check (no payment): token exists + intents/miners live
node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum --free-check

# 2. Full pipeline, mocked answers, no payment
node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum \
  --entity "Centre Consortium (USDC)" --handle @circle --dry-run

# 3. LIVE paid run on testnet (needs funding — see below)
TELEGRAPH_API_KEY=anjoman_... node listings-desk.mjs 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --chain ethereum --entity "Centre Consortium (USDC)" --handle @circle
```

Flags: `--chain ethereum|polygon|arbitrum` (default ethereum),
`--entity "Project Name"` (sanctions screening), `--handle @project`
(bot detection), `--out memo.json`.

## Funding the paid run (2 minutes, in the browser)

Recommended — **Anjoman API key, no gas, no wallet:**
1. Sign in at https://anjoman.ai → Dashboard → **Faucet** → claim 1 test USDC/day.
2. Dashboard → **API keys** → create a key (`anjoman_…`).
3. `TELEGRAPH_API_KEY=anjoman_…` and run. Asks pay from the Anjoman escrow
   (~$0.01 each; 4 asks ≈ $0.04 per memo).

Alternative — **burner-wallet escrow** (needs Sepolia ETH for gas):
mint test USDC `0xcc194e1a843B658526D0D5C431f670028582Ae17` (`mint(address,uint256)`,
anyone can), approve + `depositUSDC` on diamond
`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`, then set
`TELEGRAPH_PRIVATE_KEY=0x…` (burner wallet only — never a wallet with real funds).
Public no-login Sepolia faucets are captcha/login-gated as of 25 Nov 2026, so this
route needs a login faucet or the Anjoman path above.

## Failure cases (exit codes)

| Test | Command | Expected |
|---|---|---|
| Invalid address | `… 0xZZZ` | exit 2, "invalid token address" |
| EOA / no code | `… 0xa8484eBb1dE5FF18358CD1C57620ea13007f68Ac` | exit 3, "holds no contract code" |
| No payment configured | live run without key | exit 4, funding instructions |
| Ask refused/failed | live run, empty escrow | exit 4, no memo produced |
| Signal not re-verifiable | live run | memo flagged `signals_unverified` |

## Evidence

- `evidence/memo-dryrun-usdc.json` — dry-run memo (USDC, LIST 18/100, cost $0.04 mock)
- `evidence/ledger-dryrun.jsonl` — dry-run ledger rows (mock miners)
- `evidence/ledger.jsonl` — live paid ledger rows (written on a funded run)
- `evidence/memo-*.json` — live memos (written on a funded run)
- `app/burner-wallet.json` (mode 600) — fresh burner, 0 balance, testnet only

## Known limits (honest)

- Paid end-to-end run not yet executed: funding needs the Anjoman key step above.
- `SMART_CONTRACT_AUDIT_GENERAL` has 20 miners but lifecycle `registered`
  (not `active`); the node routes it via its LLM pick when unranked.
- `ONCHAIN_METRIC_VERIFY` currently buys the `balance` metric only;
  holder-concentration (tx_count / holder distribution) is a second ask away.
- Public mainnet RPCs from this VM are flaky (intermittent Cloudflare
  challenges on publicnode); the app uses static-network ethers providers and
  the reviewer can swap `RPCS` in `app/listings-desk.mjs`.
- x402 direct-wallet payment is NOT used: community reports (Truvian TRACK3,
  19 Nov 2026) say node x402 settlement has failed since 17 Nov (bounties#214);
  escrow (key or wallet) is the working rail.
