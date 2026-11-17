const SMA_N = 330;
const DIP_BPS = 85n;
const TRAIL_BPS = 120n;
const MAX_SLIP_BPS = 200;
const BUY_NUM = 999n;
const BUY_DEN = 1000n;
const BPS = 10000n;

const closes = [];
let runSum = 0n;
let warmup = 0;
let symbol = null;
let minNotional = 0n;
let maxWeight = 10000;
let orderNo = 0;
let peak = 0n;

function handle(line) {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  const typ = msg.type;
  if (typ === "hello") {
    symbol = msg.symbols[0].symbol;
    warmup = msg.warmup_bars || 0;
    minNotional = BigInt(msg.fees.min_notional_quote_units);
    maxWeight = msg.caps.max_weight_bps;
    return;
  }
  if (typ === "done") {
    process.exit(0);
  }
  if (typ !== "batch") return;
  const seq = msg.seq;
  const orders = [];
  const acct = msg.account;
  const cash = BigInt(acct.cash_quote_units);
  let posQty = 0n;
  for (const p of acct.positions) {
    if (p.symbol === symbol) posQty = BigInt(p.qty);
  }
  for (const bar of msg.bars) {
    if (bar.symbol !== symbol) continue;
    const c = BigInt(bar.c);
    closes.push(c);
    runSum += c;
    const n = closes.length;
    if (n > SMA_N) runSum -= closes[n - SMA_N - 1];
  }
  const ready = closes.length >= SMA_N && closes.length > warmup;
  if (ready) {
    const latest = closes[closes.length - 1];
    const n = BigInt(SMA_N);
    if (posQty > 0n) {
      if (latest > peak) peak = latest;
      const backToMean = latest * n >= runSum;
      const trailingHit = latest * BPS <= peak * (BPS - TRAIL_BPS);
      if (backToMean || trailingHit) {
        orderNo += 1;
        orders.push({ side: "sell", client_id: "o" + orderNo,
          symbol: symbol, qty: posQty.toString(),
          max_slippage_bps: MAX_SLIP_BPS });
      }
    } else {
      peak = 0n;
      const dip = latest * BPS * n <= runSum * (BPS - DIP_BPS);
      if (dip) {
        let notion = (cash * BUY_NUM) / BUY_DEN;
        const cap = (cash * BigInt(maxWeight)) / BPS;
        if (notion > cap) notion = cap;
        if (notion >= minNotional && notion > 0n) {
          orderNo += 1;
          orders.push({ side: "buy", client_id: "o" + orderNo,
            symbol: symbol, notional_quote_units: notion.toString(),
            max_slippage_bps: MAX_SLIP_BPS });
        }
      }
    }
  }
  process.stdout.write(JSON.stringify({ type: "reply", seq: seq, orders: orders }) + "\n");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    handle(line);
  }
});
