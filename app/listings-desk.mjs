#!/usr/bin/env node
/**
 * Listings Desk — Telegraph Hackathon Season II, Track 03 Apps & Agents, Mission 01 Exchange.
 *
 * Input: a token contract address (+ chain, project entity name, social handle).
 * Buys 4 intents through Telegraph testnet in parallel:
 *   SMART_CONTRACT_AUDIT_GENERAL, ONCHAIN_METRIC_VERIFY_GENERAL,
 *   SANCTIONS_SCREENING_MATCH_GENERAL, SOCIAL_BOT_DETECTION_GENERAL
 * ...and combines them into a SIGNED listing risk memo with a cost line.
 *
 * Payment uses the OFFICIAL @telegraphprotocol/telegraph-protocol-mcp code, two modes:
 *   1. TELEGRAPH_API_KEY set  -> Anjoman account escrow (no wallet, no gas).
 *      POST https://backend.telegraphprotocol.com/engine/ask (auto-routed ask).
 *   2. TELEGRAPH_PRIVATE_KEY set -> wallet escrow on Ethereum Sepolia.
 *      POST https://devnode.telegraphprotocol.com/engine/v1/ask with the
 *      escrow X-PAYMENT personal_sign header (Payer class from the MCP package).
 * Caps: max $0.05 budget per ask, max $1.00 per memo run (4 asks).
 * Every paid ask is appended to evidence/ledger.jsonl (intent, miner, cost,
 * latency, signal_hash, receipt) and each signal is re-verified via
 * GET /engine/v1/signal/{hash} on the devnode.
 *
 * Modes:
 *   --free-check   live read-only validation only (intents/miners/ranking +
 *                  on-chain token existence). No payment, no memo.
 *   --dry-run      full pipeline with MOCKED Telegraph answers (shapes taken
 *                  from the real intent response definitions). No payment.
 *   (default)      live paid run on testnet.
 *
 * Exit codes: 0 ok; 2 bad CLI input (incl. invalid token address);
 * 3 token address holds no contract code on the chosen chain;
 * 4 Telegraph ask refused/failed (incl. empty escrow — a failed ask is never
 * billed); 5 signal verification failed. No memo is produced on failure.
 *
 * Testnet only. No mainnet, no real money. Burner wallet only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { loadConfig } from "../node_modules/@telegraphprotocol/telegraph-protocol-mcp/dist/config.js";
import { Payer } from "../node_modules/@telegraphprotocol/telegraph-protocol-mcp/dist/pay.js";
import { AnjomanApi } from "../node_modules/@telegraphprotocol/telegraph-protocol-mcp/dist/api.js";
import { Chain } from "../node_modules/@telegraphprotocol/telegraph-protocol-mcp/dist/chain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, "evidence");
const DEVNODE = "https://devnode.telegraphprotocol.com";
const BACKEND = "https://backend.telegraphprotocol.com";
const MAX_BUDGET_UUSDC = 50_000; // $0.05 per ask (hold); billed is ~$0.01
const RUN_CAP_USD = 1.0;
const RPCS = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
};
const CHAIN_IDS = { ethereum: 1, polygon: 137, arbitrum: 42161 };

const INTENTS = [
  {
    key: "audit",
    intent: "SMART_CONTRACT_AUDIT_GENERAL",
    label: "SMART_CONTRACT_AUDIT",
    build: (a) => ({
      query: `Audit the smart contract ${a.token} on ${a.chain} for a token listing decision. Report: reentrancy, access control / owner privileges (mint, pause, blacklist, fee changes, upgrade/proxy, selfdestruct, withdrawal), integer overflows, and an overall risk rating (low/medium/high/critical) with the single most dangerous finding first.`,
    }),
  },
  {
    key: "onchain",
    intent: "ONCHAIN_METRIC_VERIFY_GENERAL",
    label: "ONCHAIN_METRIC_VERIFY",
    build: (a) => ({
      intent: "ONCHAIN_METRIC_VERIFY_GENERAL",
      params: { address: a.token, block: a.block, chain: a.chain, metric: "balance" },
    }),
  },
  {
    key: "sanctions",
    intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
    label: "SANCTIONS_SCREENING_MATCH",
    build: (a) => ({
      intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
      params: { name: a.entity },
    }),
  },
  {
    key: "social",
    intent: "SOCIAL_BOT_DETECTION_GENERAL",
    label: "SOCIAL_BOT_DETECTION",
    build: (a) => ({
      intent: "SOCIAL_BOT_DETECTION_GENERAL",
      params: { account: a.handle },
    }),
  },
];

function parseArgs(argv) {
  const o = { chain: "ethereum", entity: null, handle: null, dryRun: false, freeCheck: false, out: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--chain") o.chain = argv[++i];
    else if (t === "--entity") o.entity = argv[++i];
    else if (t === "--handle") o.handle = argv[++i];
    else if (t === "--out") o.out = argv[++i];
    else if (t === "--dry-run") o.dryRun = true;
    else if (t === "--free-check") o.freeCheck = true;
    else if (t === "--help" || t === "-h") { usage(); process.exit(0); }
    else if (t.startsWith("--")) { console.error(`Unknown flag: ${t}`); usage(); process.exit(2); }
    else pos.push(t);
  }
  o.token = pos[0] || null;
  return o;
}
function usage() {
  console.log(`Usage: node listings-desk.mjs <tokenAddress> [--chain ethereum|polygon|arbitrum]
       [--entity "Project Name"] [--handle @project] [--out memo.json]
       [--dry-run] [--free-check]

Env: TELEGRAPH_API_KEY (Anjoman key mode, no gas) OR
     TELEGRAPH_PRIVATE_KEY (burner wallet escrow mode, Sepolia testnet).
     TELEGRAPH_MAX_BUDGET_USDC default 50000 ($0.05/ask).`);
}
function fail(code, msg) { console.error(`ERROR (${code}): ${msg}`); process.exit(code); }

async function getJson(url, ms = 30_000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 500) }; }
  return { status: r.status, body: j };
}

// --- scoring: each intent contributes 0..25 risk points; verdict on total/100 ---
function scoreIntent(key, ans) {
  const text = JSON.stringify(ans ?? {}).toLowerCase();
  const has = (...ws) => ws.some((w) => text.includes(w));
  if (key === "audit") {
    let p = 0; const flags = [];
    // Prefer a structured risk field when the miner returns one; otherwise scan
    // the text with negations ("no critical findings") stripped first.
    const risk = String(ans?.answer?.risk ?? ans?.risk ?? "").toLowerCase();
    const text = JSON.stringify(ans ?? {}).toLowerCase()
      .replace(/no (critical|high|medium) (finding|findings|risk|issues?)/g, "");
    const has = (...ws) => ws.some((w) => text.includes(w));
    if (risk === "critical") { p += 25; flags.push("risk=critical"); }
    else if (risk === "high") { p += 18; flags.push("risk=high"); }
    else if (risk === "medium") { p += 10; flags.push("risk=medium"); }
    else if (has("critical")) { p += 25; flags.push("critical finding reported"); }
    else if (has("high")) { p += 18; flags.push("high finding reported"); }
    else if (has("medium")) { p += 10; flags.push("medium finding reported"); }
    if (has("selfdestruct")) { p += 10; flags.push("SELFDESTRUCT present"); }
    if (has("mint") && has("owner")) { p += 5; flags.push("owner mint"); }
    if (has("proxy") || has("upgrade")) { p += 5; flags.push("upgradeable/proxy"); }
    if (has("pause") || has("blacklist")) { p += 3; flags.push("pause/blacklist"); }
    return { points: Math.min(25, p), flags: flags.length ? flags : ["no high-risk flags in answer"] };
  }
  if (key === "onchain") {
    // A token contract normally holds ~0 native balance; a large native balance
    // or zero tx history is unusual. balance_gwei is the scored field.
    const bal = Number(ans?.answer?.balance_gwei ?? ans?.balance_gwei ?? NaN);
    if (Number.isNaN(bal)) return { points: 10, flags: ["balance field missing — unverified"] };
    if (bal > 1e11) return { points: 15, flags: [`large native balance ${bal} gwei held by token contract`] };
    return { points: 0, flags: [`native balance ${bal} gwei (normal for a token contract)`] };
  }
  if (key === "sanctions") {
    const m = ans?.answer?.matched ?? ans?.matched;
    if (m === true || m === "true") return { points: 25, flags: ["SANCTIONS MATCH — hard fail"] };
    if (m === undefined) return { points: 10, flags: ["matched field missing — unverified"] };
    return { points: 0, flags: ["no sanctions match"] };
  }
  if (key === "social") {
    const v = String(ans?.answer?.verdict ?? ans?.verdict ?? "").toLowerCase();
    const s = Number(ans?.answer?.bot_score ?? ans?.bot_score ?? NaN);
    if (v === "bot") return { points: 25, flags: ["verdict: bot"] };
    if (v === "likely_bot") return { points: 18, flags: [`verdict: likely_bot (score ${s})`] };
    if (v === "inconclusive" || !v) return { points: 10, flags: [`verdict: ${v || "missing"} — unverified`] };
    if (v === "likely_human") return { points: 5, flags: ["verdict: likely_human"] };
    return { points: 0, flags: ["verdict: human"] };
  }
  return { points: 0, flags: [] };
}

function mockAnswer(key, a) {
  // Shapes copied from the live intent response definitions (devnode, 25 Nov 2026).
  if (key === "audit") return { answer: { summary: "MOCK (dry-run): owner can pause; logic is fixed at deploy.", risk: "medium" }, fulfillment: { status: "complete", provenance: [{ miner: "mock-miner", field: "answer" }], payments: [{ miner: "mock-miner", amount_uusdc: 10000 }] }, signal_hash: "0x" + "0".repeat(64), mock: true };
  if (key === "onchain") return { answer: { balance_gwei: 0, address: a.token }, fulfillment: { status: "complete", provenance: [{ miner: "mock-miner", field: "balance_gwei" }], payments: [{ miner: "mock-miner", amount_uusdc: 10000 }] }, signal_hash: "0x" + "1".repeat(64), mock: true };
  if (key === "sanctions") return { answer: { name: a.entity, matched: false, matches: [], lists: ["OFAC", "EU", "UN"] }, fulfillment: { status: "complete", provenance: [{ miner: "mock-miner", field: "matched" }], payments: [{ miner: "mock-miner", amount_uusdc: 10000 }] }, signal_hash: "0x" + "2".repeat(64), mock: true };
  return { answer: { account: a.handle, verdict: "likely_human", bot_score: 0.22, signals: ["steady post cadence"] }, fulfillment: { status: "complete", provenance: [{ miner: "mock-miner", field: "verdict" }], payments: [{ miner: "mock-miner", amount_uusdc: 10000 }] }, signal_hash: "0x" + "3".repeat(64), mock: true };
}

async function verifySignal(hash) {
  if (!hash || /^0x0+$/.test(hash) || /^0x(1|2|3)+$/.test(hash)) return { verified: false, note: "mock hash, not verifiable" };
  try {
    const { status, body } = await getJson(`${DEVNODE}/engine/v1/signal/${hash}`);
    const v = body?.verification ?? body?.verified ?? body;
    return { verified: status === 200, status, detail: typeof v === "object" ? JSON.stringify(v).slice(0, 400) : String(v).slice(0, 400) };
  } catch (e) { return { verified: false, note: String(e.message).slice(0, 200) }; }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.token) { usage(); process.exit(2); }
  // --- input validation (failure case #1) ---
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.token)) fail(2, `invalid token address "${a.token}" — expected 0x + 40 hex chars`);
  a.token = ethers.getAddress(a.token);
  if (!RPCS[a.chain]) fail(2, `unknown chain "${a.chain}" — use ethereum, polygon or arbitrum`);
  a.entity = a.entity || `token ${a.token}`;
  a.handle = a.handle || "@unknown";
  fs.mkdirSync(EVIDENCE, { recursive: true });

  // --- on-chain existence check (failure case #2) ---
  const provider = new ethers.JsonRpcProvider(RPCS[a.chain], CHAIN_IDS[a.chain], { staticNetwork: true });
  let block, code;
  try {
    block = await provider.getBlockNumber();
    code = await provider.getCode(a.token);
  } catch (e) { fail(3, `cannot read ${a.chain} chain state: ${e.message.slice(0, 200)}`); }
  a.block = block;
  if (!code || code === "0x") fail(3, `${a.token} holds no contract code on ${a.chain} (EOA or undeployed) — refusing to buy intelligence for it`);

  // --- free-check mode: live read-only validation, no payment ---
  if (a.freeCheck) {
    console.log(`token ${a.token} chain=${a.chain} block=${block} code=${code.length} bytes`);
    const { status, body } = await getJson(`${DEVNODE}/engine/v1/intents`);
    const intents = body?.intents ?? [];
    console.log(`devnode intents: ${intents.length} (HTTP ${status})`);
    for (const it of INTENTS) {
      const hit = intents.find((x) => x.intent_name === it.intent);
      console.log(`- ${it.intent}: ${hit ? `${hit.miner_count} miners, ${hit.class}, ${hit.lifecycle_state}` : "NOT FOUND"}`);
    }
    const rk = await getJson(`${DEVNODE}/leaderboard/miners?intent=ONCHAIN_METRIC_VERIFY_GENERAL&limit=3`).catch(() => ({ status: 0, body: {} }));
    console.log(`ranking ONCHAIN_METRIC_VERIFY_GENERAL HTTP ${rk.status}: ${JSON.stringify(rk.body?.intents?.ONCHAIN_METRIC_VERIFY_GENERAL ?? rk.body).slice(0, 300)}`);
    console.log("FREE-CHECK OK — no payment made.");
    return;
  }

  // --- payment setup ---
  let mode, payer = null, api = null;
  if (process.env.TELEGRAPH_API_KEY) {
    mode = "anjoman-key";
    api = new AnjomanApi(BACKEND, process.env.TELEGRAPH_API_KEY.trim());
    const bal = await api.account().catch((e) => { fail(4, `Anjoman account check failed: ${e.message.slice(0, 200)}`); });
    console.log(`Anjoman escrow spendable: $${bal?.escrow?.spendable_usd ?? "?"}`);
    if (Number(bal?.escrow?.spendable_usd) < 0.2) fail(4, `Anjoman escrow too low ($${bal?.escrow?.spendable_usd}) — need >= $0.20 for 4 parallel asks; top up at anjoman.ai (faucet: 1 test USDC/day)`);
  } else if (process.env.TELEGRAPH_PRIVATE_KEY) {
    mode = "wallet-escrow";
    const cfg = loadConfig({ ...process.env, TELEGRAPH_MAX_BUDGET_USDC: String(process.env.TELEGRAPH_MAX_BUDGET_USDC || MAX_BUDGET_UUSDC), TELEGRAPH_MAX_ASK_USD: "0.10", TELEGRAPH_DAILY_LIMIT_USD: String(RUN_CAP_USD), TELEGRAPH_PAYMENT: "escrow", TELEGRAPH_HOME: path.join(ROOT, ".telegraph-home") });
    payer = new Payer(cfg, process.env.TELEGRAPH_PRIVATE_KEY.trim());
    const chain = new Chain(cfg);
    const acct = await chain.account(new ethers.Wallet(process.env.TELEGRAPH_PRIVATE_KEY.trim()).address);
    console.log(`wallet escrow: ${JSON.stringify(acct?.escrow ?? acct)}`);
  } else if (a.dryRun) {
    mode = "dry-run-mock";
  } else {
    fail(4, "no payment configured: set TELEGRAPH_API_KEY (Anjoman, recommended — no gas) or TELEGRAPH_PRIVATE_KEY (burner wallet escrow, Sepolia). Use --dry-run for a no-payment pipeline test.");
  }
  console.log(`mode=${mode} token=${a.token} chain=${a.chain} block=${block}`);

  // --- buy the 4 intents in parallel ---
  const t0 = Date.now();
  const results = await Promise.all(INTENTS.map(async (spec) => {
    const t1 = Date.now();
    const body = spec.build(a);
    let raw;
    try {
      if (a.dryRun) {
        await new Promise((r) => setTimeout(r, 50));
        raw = { status: 200, body: mockAnswer(spec.key, a) };
      } else if (api) {
        const res = await api.askAuto({ ...body, max_budget_usdc: MAX_BUDGET_UUSDC });
        raw = { status: 200, body: res };
      } else {
        raw = await payer.post("/engine/v1/ask", { ...body, max_budget_usdc: MAX_BUDGET_UUSDC });
      }
    } catch (e) {
      return { spec, ok: false, error: e.message.slice(0, 300), ms: Date.now() - t1 };
    }
    const b = raw.body ?? {};
    const ok = raw.status >= 200 && raw.status < 300 && (b.fulfillment?.status === "complete" || b.answer !== undefined || b.status === "complete");
    const payments = b.fulfillment?.payments ?? [];
    const billed = payments.reduce((s, p) => s + Number(p.amount_uusdc || 0), 0);
    const miners = [...new Set(payments.map((p) => p.miner).filter(Boolean))];
    const signalHash = b.signal_hash || b.signalHash || b.fulfillment?.signal_hash || null;
    return { spec, ok, status: raw.status, ms: Date.now() - t1, answer: b.answer ?? b, fulfillment: b.fulfillment ?? null, signalHash, billedUusdc: billed, miners, raw: a.dryRun ? undefined : b };
  }));

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    for (const f of failed) console.error(`ASK FAILED ${f.spec.intent}: ${f.error || `HTTP ${f.status}`}`);
    fail(4, `${failed.length}/4 Telegraph asks failed — no memo produced (failed asks are never billed by the protocol)`);
  }

  // --- verify signals + ledger ---
  let totalBilled = 0;
  for (const r of results) {
    totalBilled += r.billedUusdc || 0;
    const v = a.dryRun ? { verified: false, note: "dry-run mock" } : await verifySignal(r.signalHash);
    r.signalVerified = v.verified;
    r.signalDetail = v.detail || v.note || "";
    const entry = { ts: new Date().toISOString(), run: `${a.token}@${a.chain}#${block}`, intent: r.spec.intent, miner: r.miners, cost_uusdc: r.billedUusdc, latency_ms: r.ms, signal_hash: r.signalHash, signal_verified: v.verified, fulfillment: r.fulfillment?.status ?? null, mode };
    const ledgerFile = a.dryRun ? "ledger-dryrun.jsonl" : "ledger.jsonl";
    fs.appendFileSync(path.join(EVIDENCE, ledgerFile), JSON.stringify(entry) + "\n");
    if (!a.dryRun && !v.verified) console.error(`WARN signal not verified: ${r.spec.intent} hash=${r.signalHash}`);
  }
  if (!a.dryRun && results.some((r) => !r.signalVerified)) {
    console.error("WARN: some signals could not be re-verified via /engine/v1/signal — memo is still issued but flagged UNVERIFIED_SIGNALS (see evidence).");
  }

  // --- score + memo ---
  const scored = results.map((r) => ({ intent: r.spec.label, ...scoreIntent(r.spec.key, r.answer), miner: r.miners, cost_uusdc: r.billedUusdc, latency_ms: r.ms, signal_hash: r.signalHash, signal_verified: r.signalVerified }));
  const total = scored.reduce((s, x) => s + x.points, 0);
  const verdict = total >= 70 ? "DO_NOT_LIST" : total >= 40 ? "LIST_WITH_CONDITIONS" : "LIST";
  const memo = {
    kind: "telegraph-h2-listings-desk-risk-memo",
    network: "testnet",
    token: a.token, chain: a.chain, block,
    entity: a.entity, handle: a.handle,
    question: "Should we list this token?",
    verdict, risk_score: total, risk_max: 100,
    checks: scored,
    cost: { billed_uusdc: totalBilled, billed_usd: totalBilled / 1e6, asks: 4, cap_usd: RUN_CAP_USD, note: "testnet USDC; gas $0 (key mode) / Sepolia test ETH (wallet mode)" },
    elapsed_ms: Date.now() - t0,
    mode, generated_at: new Date().toISOString(),
    signals_unverified: results.some((r) => !r.signalVerified) && !a.dryRun,
    dry_run: !!a.dryRun,
  };
  const canonical = JSON.stringify(memo);
  memo.verification_hash = "0x" + crypto.createHash("sha256").update(canonical).digest("hex");
  // sign with the desk key (burner wallet if present, else ephemeral key for dry-run)
  const signer = process.env.TELEGRAPH_PRIVATE_KEY
    ? new ethers.Wallet(process.env.TELEGRAPH_PRIVATE_KEY.trim())
    : ethers.Wallet.createRandom();
  memo.signed_by = signer.address;
  memo.signature = await signer.signMessage(ethers.getBytes(memo.verification_hash));
  const outPath = a.out || path.join(EVIDENCE, `memo-${a.token.slice(2, 10)}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(memo, null, 2));
  console.log(`\n=== LISTING RISK MEMO ===\nToken: ${a.token} (${a.chain} @ ${block})\nVerdict: ${verdict}  risk ${total}/100`);
  for (const s of scored) console.log(`- ${s.intent}: ${s.points}/25 — ${s.flags.join("; ")} (miner: ${s.miner.join(",") || "?"}, $${((s.cost_uusdc || 0) / 1e6).toFixed(4)})`);
  console.log(`COST LINE: $${(totalBilled / 1e6).toFixed(4)} for 4 paid Telegraph requests (${memo.elapsed_ms} ms) — mode ${mode}`);
  console.log(`verification_hash: ${memo.verification_hash}\nsigned_by: ${memo.signed_by}\nmemo: ${outPath}\nledger: ${path.join(EVIDENCE, "ledger.jsonl")}`);
}

main().catch((e) => { console.error("FATAL:", e.message.slice(0, 500)); process.exit(4); });
