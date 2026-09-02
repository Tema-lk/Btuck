// ============================================================
// Tuck Shop Ledger — offline-first app logic
// Storage: IndexedDB via Dexie. Everything works with zero signal;
// nothing here ever requires the network.
// ============================================================

const db = new Dexie("tuckShopLedger");
db.version(1).stores({
  products: "++id, name",
  transactions: "++id, type, date",
  cashinBrackets: "++id, min",
  cashoutBrackets: "++id, min",
  settings: "key"
});

const money = (n) => "P" + (Number(n) || 0).toFixed(2);
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2);

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------------- Settings / balances helpers ----------------

async function getSetting(key, fallback) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
async function getBalances() {
  const cashInHand = await getSetting("cashInHand", 0);
  const eFloat = await getSetting("eFloat", 0);
  return { cashInHand, eFloat };
}
async function adjustBalances({ cashDelta = 0, floatDelta = 0 }) {
  const bal = await getBalances();
  await setSetting("cashInHand", bal.cashInHand + cashDelta);
  await setSetting("eFloat", bal.eFloat + floatDelta);
}

// ---------------- Seed default data on first run ----------------

async function seedIfEmpty() {
  const shopName = await getSetting("shopName", null);
  if (shopName === null) await setSetting("shopName", "My Tuck Shop");

  const hasCash = await db.settings.get("cashInHand");
  if (!hasCash) await setSetting("cashInHand", 0);
  const hasFloat = await db.settings.get("eFloat");
  if (!hasFloat) await setSetting("eFloat", 0);

  const cashinCount = await db.cashinBrackets.count();
  if (cashinCount === 0) {
    // PLACEHOLDER commission figures, approximated from an informal example
    // posted to Facebook — replace via Settings once the real Orange Money
    // agent commission sheet is available.
    await db.cashinBrackets.bulkAdd([
      { min: 25, max: 125, fee: 0.60 },
      { min: 126, max: 250, fee: 1.20 },
      { min: 251, max: 500, fee: 3.00 },
      { min: 501, max: 1000, fee: 5.52 },
      { min: 1001, max: 2000, fee: 12.00 },
      { min: 2001, max: 4000, fee: 24.00 },
      { min: 4001, max: 6000, fee: 36.00 },
      { min: 6001, max: 8000, fee: 48.00 },
      { min: 8001, max: 9500, fee: 57.00 }
    ]);
  }
  const cashoutCount = await db.cashoutBrackets.count();
  if (cashoutCount === 0) {
    await db.cashoutBrackets.bulkAdd([
      { min: 25, max: 125, fee: 2.10 },
      { min: 126, max: 250, fee: 2.80 },
      { min: 251, max: 500, fee: 4.55 },
      { min: 501, max: 1000, fee: 8.05 },
      { min: 1001, max: 2000, fee: 16.00 },
      { min: 2001, max: 4000, fee: 32.00 },
      { min: 4001, max: 6000, fee: 48.00 },
      { min: 6001, max: 8000, fee: 64.00 },
      { min: 8001, max: 9500, fee: 76.00 }
    ]);
  }
}

async function lookupCommission(kind, amount) {
  const table = kind === "cashin" ? db.cashinBrackets : db.cashoutBrackets;
  const brackets = await table.orderBy("min").toArray();
  if (brackets.length === 0) return 0;
  let match = brackets.find((b) => amount >= b.min && amount <= b.max);
  if (!match) {
    // amount falls outside every bracket — use the nearest edge bracket
    match = amount < brackets[0].min ? brackets[0] : brackets[brackets.length - 1];
  }
  return match.fee;
}

// ---------------- Date range helpers for reports ----------------

function startOfRange(range) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d;
  if (range === "week") {
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d;
  }
  if (range === "month") {
    d.setDate(1);
    return d;
  }
  return d;
}

async function transactionsInRange(range) {
  const start = startOfRange(range).getTime();
  const all = await db.transactions.toArray();
  return all.filter((t) => new Date(t.date).getTime() >= start);
}

// ============================================================
// NAVIGATION
// ============================================================

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  if (name === "dashboard") renderDashboard();
  if (name === "stock") renderStock();
  if (name === "money") renderMoney();
  if (name === "expenses") renderExpenses();
  if (name === "reports") renderReports();
  if (name === "settings") renderSettings();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

// ============================================================
// MODALS
// ============================================================

function openModal(id) {
  document.getElementById(id).classList.add("active");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}
document.querySelectorAll("[data-open-modal]").forEach((el) => {
  el.addEventListener("click", () => openModal(el.dataset.openModal));
});
document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", (e) => closeModal(e.target.closest(".modal-overlay").id));
});
document.querySelectorAll(".modal-overlay").forEach((el) => {
  el.addEventListener("click", (e) => { if (e.target === el) closeModal(el.id); });
});

// ============================================================
// DASHBOARD
// ============================================================

async function renderDashboard() {
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  document.getElementById("shopNameDisplay").textContent = await getSetting("shopName", "My Tuck Shop");

  const bal = await getBalances();
  document.getElementById("cashInHandVal").textContent = money(bal.cashInHand);
  document.getElementById("eFloatVal").textContent = money(bal.eFloat);
  document.getElementById("mmCashVal").textContent = money(bal.cashInHand);
  document.getElementById("mmFloatVal").textContent = money(bal.eFloat);

  const lowWarn = document.getElementById("lowFloatWarning");
  lowWarn.innerHTML = "";
  if (bal.eFloat < 200) {
    const div = document.createElement("div");
    div.className = "note";
    div.textContent = "E-float is running low — consider an ATM/branch deposit soon so cash-ins don't stall.";
    lowWarn.appendChild(div);
  }

  const todays = await transactionsInRange("today");
  let stockProfit = 0, commission = 0, expenses = 0;
  todays.forEach((t) => {
    if (t.type === "sale") stockProfit += t.profit;
    if (t.type === "cashin" || t.type === "cashout") commission += t.commission;
    if (t.type === "expense") expenses += t.amount;
  });
  const total = stockProfit + commission - expenses;
  document.getElementById("heroProfit").textContent = money(total);
  document.getElementById("heroBreakdown").textContent =
    `Stock ${money(stockProfit)} · Mobile money ${money(commission)} · Expenses -${money(expenses)}`;

  // low stock
  const products = await db.products.toArray();
  const low = products.filter((p) => p.stock <= p.lowThreshold);
  const lowCard = document.getElementById("lowStockCard");
  lowCard.innerHTML = "";
  if (low.length === 0) {
    lowCard.innerHTML = '<div class="empty-state">Nothing low yet.</div>';
  } else {
    low.forEach((p) => {
      lowCard.appendChild(rowEl(p.name, `${p.stock} left`, "", "brick"));
    });
  }

  // recent activity (last 6 of today)
  const recentCard = document.getElementById("recentActivityCard");
  recentCard.innerHTML = "";
  const recent = todays.slice(-6).reverse();
  if (recent.length === 0) {
    recentCard.innerHTML = '<div class="empty-state">No activity yet today.</div>';
  } else {
    recent.forEach((t) => recentCard.appendChild(activityRow(t)));
  }
}

function rowEl(primary, secondary, amountText, amountClass) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.innerHTML = `
    <div><div class="primary">${primary}</div><div class="secondary">${secondary}</div></div>
    <div class="amount ${amountClass || ""}">${amountText || ""}</div>
  `;
  return row;
}

function activityRow(t) {
  const time = new Date(t.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (t.type === "sale") return rowEl(`Sold ${t.qty} × ${t.productName}`, time, "+" + money(t.amount), "positive");
  if (t.type === "expense") return rowEl(t.category, time + (t.note ? " · " + t.note : ""), "-" + money(t.amount), "negative");
  if (t.type === "cashin") return rowEl("Cash-in", time + ` · customer P${t.amount.toFixed(2)}`, "+" + money(t.commission), "positive");
  if (t.type === "cashout") return rowEl("Cash-out", time + ` · customer P${t.amount.toFixed(2)}`, "+" + money(t.commission), "positive");
  if (t.type === "atmdeposit") return rowEl("ATM / branch deposit", time, money(t.amount), "");
  return rowEl(t.type, time, "", "");
}

// ============================================================
// STOCK
// ============================================================

async function renderStock() {
  const products = await db.products.orderBy("name").toArray();
  const card = document.getElementById("productListCard");
  card.innerHTML = "";
  if (products.length === 0) {
    card.innerHTML = '<div class="empty-state">No products yet. Add your first one.</div>';
    return;
  }
  products.forEach((p) => {
    const row = document.createElement("div");
    row.className = "list-row";
    const low = p.stock <= p.lowThreshold;
    row.innerHTML = `
      <div>
        <div class="primary">${p.name}${low ? '<span class="badge">low</span>' : ""}</div>
        <div class="secondary">${p.stock} in stock · sells at ${money(p.price)}</div>
      </div>
      <div class="amount"></div>
    `;
    row.style.cursor = "pointer";
    row.addEventListener("click", () => openRestock(p.id));
    card.appendChild(row);
  });
}

document.getElementById("saveProductBtn").addEventListener("click", async () => {
  const name = document.getElementById("pName").value.trim();
  const cost = parseFloat(document.getElementById("pCost").value);
  const price = parseFloat(document.getElementById("pPrice").value);
  const stock = parseInt(document.getElementById("pStock").value, 10);
  const lowThreshold = parseInt(document.getElementById("pLow").value, 10) || 0;
  if (!name || isNaN(cost) || isNaN(price) || isNaN(stock)) {
    toast("Fill in every field first");
    return;
  }
  await db.products.add({ name, cost, price, stock, lowThreshold });
  ["pName", "pCost", "pPrice", "pStock"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("pLow").value = 5;
  closeModal("modalAddProduct");
  toast("Product added");
  renderStock();
});

let restockingId = null;
async function openRestock(id) {
  restockingId = id;
  const p = await db.products.get(id);
  document.getElementById("restockTitle").textContent = "Restock — " + p.name;
  document.getElementById("restockQty").value = 1;
  openModal("modalRestock");
}
document.getElementById("confirmRestockBtn").addEventListener("click", async () => {
  const qty = parseInt(document.getElementById("restockQty").value, 10);
  if (!qty || qty <= 0) { toast("Enter a valid quantity"); return; }
  const p = await db.products.get(restockingId);
  await db.products.update(restockingId, { stock: p.stock + qty });
  closeModal("modalRestock");
  toast(`Added ${qty} to ${p.name}`);
  renderStock();
  renderDashboard();
});
document.getElementById("deleteProductBtn").addEventListener("click", async () => {
  if (!confirm("Delete this product? Past sales history is kept.")) return;
  await db.products.delete(restockingId);
  closeModal("modalRestock");
  toast("Product deleted");
  renderStock();
});

// -------- Sell modal --------
document.getElementById("modalSell").addEventListener("click", () => {}); // placeholder, real open handled below
async function populateSellModal() {
  const products = await db.products.orderBy("name").toArray();
  const sel = document.getElementById("sellProduct");
  sel.innerHTML = products.map((p) => `<option value="${p.id}">${p.name} (${p.stock} left)</option>`).join("");
  updateSellPreview();
}
document.querySelector('[data-open-modal="modalSell"]').addEventListener("click", populateSellModal);
document.getElementById("sellProduct").addEventListener("change", updateSellPreview);
document.getElementById("sellQty").addEventListener("input", updateSellPreview);

async function updateSellPreview() {
  const sel = document.getElementById("sellProduct");
  if (!sel.value) { document.getElementById("sellPreview").innerHTML = ""; return; }
  const p = await db.products.get(parseInt(sel.value, 10));
  const qty = parseInt(document.getElementById("sellQty").value, 10) || 0;
  const amount = p.price * qty;
  const profit = (p.price - p.cost) * qty;
  const preview = document.getElementById("sellPreview");
  if (!p) { preview.innerHTML = ""; return; }
  const overStock = qty > p.stock;
  preview.innerHTML = `
    <div class="list-row"><div class="primary">Total</div><div class="amount">${money(amount)}</div></div>
    <div class="list-row"><div class="primary">Profit</div><div class="amount positive">${money(profit)}</div></div>
    ${overStock ? `<div class="secondary" style="color:var(--brick)">Only ${p.stock} in stock</div>` : ""}
  `;
}

document.getElementById("confirmSellBtn").addEventListener("click", async () => {
  const sel = document.getElementById("sellProduct");
  if (!sel.value) { toast("Add a product first"); return; }
  const p = await db.products.get(parseInt(sel.value, 10));
  const qty = parseInt(document.getElementById("sellQty").value, 10);
  if (!qty || qty <= 0) { toast("Enter a valid quantity"); return; }
  if (qty > p.stock) { toast("Not enough stock"); return; }

  const amount = p.price * qty;
  const profit = (p.price - p.cost) * qty;
  await db.transactions.add({
    type: "sale", date: nowISO(), productId: p.id, productName: p.name,
    qty, unitCost: p.cost, unitPrice: p.price, amount, profit
  });
  await db.products.update(p.id, { stock: p.stock - qty });
  await adjustBalances({ cashDelta: amount });

  closeModal("modalSell");
  toast(`Sold ${qty} × ${p.name}`);
  renderDashboard();
  renderStock();
});

// ============================================================
// MOBILE MONEY
// ============================================================

let moneyType = "cashin";
document.querySelectorAll("#moneyTypeToggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    moneyType = btn.dataset.type;
    document.querySelectorAll("#moneyTypeToggle button").forEach((b) => b.classList.toggle("active", b === btn));
    updateMoneyPreview();
  });
});
document.getElementById("moneyAmount").addEventListener("input", updateMoneyPreview);

async function updateMoneyPreview() {
  const amount = parseFloat(document.getElementById("moneyAmount").value);
  const preview = document.getElementById("moneyPreview");
  if (isNaN(amount) || amount <= 0) { preview.innerHTML = ""; return; }
  const commission = await lookupCommission(moneyType, amount);
  const bal = await getBalances();
  let cashAfter, floatAfter;
  if (moneyType === "cashin") {
    cashAfter = bal.cashInHand + amount;
    floatAfter = bal.eFloat - amount;
  } else {
    cashAfter = bal.cashInHand - amount;
    floatAfter = bal.eFloat + amount;
  }
  preview.innerHTML = `
    <div class="list-row"><div class="primary">Your commission</div><div class="amount positive">${money(commission)}</div></div>
    <div class="list-row"><div class="primary">Cash in hand after</div><div class="amount">${money(cashAfter)}</div></div>
    <div class="list-row"><div class="primary">E-float after</div><div class="amount">${money(floatAfter)}</div></div>
    ${floatAfter < 0 && moneyType === "cashin" ? '<div class="secondary" style="color:var(--brick)">This would take e-float negative — check the balance first.</div>' : ""}
  `;
}

document.getElementById("confirmMoneyBtn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("moneyAmount").value);
  if (isNaN(amount) || amount <= 0) { toast("Enter a valid amount"); return; }
  const commission = await lookupCommission(moneyType, amount);

  await db.transactions.add({ type: moneyType, date: nowISO(), amount, commission });

  if (moneyType === "cashin") {
    await adjustBalances({ cashDelta: amount, floatDelta: -amount });
  } else {
    await adjustBalances({ cashDelta: -amount, floatDelta: amount });
  }
  // commission itself is agent income, credited into e-float by the provider
  await adjustBalances({ floatDelta: commission });

  document.getElementById("moneyAmount").value = "";
  document.getElementById("moneyPreview").innerHTML = "";
  closeModal("modalMoney");
  toast(`${moneyType === "cashin" ? "Cash-in" : "Cash-out"} logged — commission ${money(commission)}`);
  renderDashboard();
  renderMoney();
});

document.getElementById("confirmDepositBtn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("depositAmount").value);
  if (isNaN(amount) || amount <= 0) { toast("Enter a valid amount"); return; }
  const bal = await getBalances();
  if (amount > bal.cashInHand) {
    if (!confirm("This is more than the cash currently on hand. Record anyway?")) return;
  }
  await db.transactions.add({ type: "atmdeposit", date: nowISO(), amount });
  await adjustBalances({ cashDelta: -amount, floatDelta: amount });
  document.getElementById("depositAmount").value = "";
  closeModal("modalDeposit");
  toast("Deposit recorded");
  renderDashboard();
  renderMoney();
});

async function renderMoney() {
  const bal = await getBalances();
  document.getElementById("mmCashVal").textContent = money(bal.cashInHand);
  document.getElementById("mmFloatVal").textContent = money(bal.eFloat);

  const all = await db.transactions
    .where("type").anyOf("cashin", "cashout", "atmdeposit")
    .reverse()
    .sortBy("date");
  const card = document.getElementById("mmActivityCard");
  card.innerHTML = "";
  if (all.length === 0) {
    card.innerHTML = '<div class="empty-state">No mobile money activity yet.</div>';
    return;
  }
  all.slice(0, 30).forEach((t) => card.appendChild(activityRow(t)));
}

// ============================================================
// EXPENSES
// ============================================================

document.getElementById("confirmExpenseBtn").addEventListener("click", async () => {
  const category = document.getElementById("expCategory").value;
  const amount = parseFloat(document.getElementById("expAmount").value);
  const note = document.getElementById("expNote").value.trim();
  if (isNaN(amount) || amount <= 0) { toast("Enter a valid amount"); return; }
  await db.transactions.add({ type: "expense", date: nowISO(), category, amount, note });
  await adjustBalances({ cashDelta: -amount });
  document.getElementById("expAmount").value = "";
  document.getElementById("expNote").value = "";
  closeModal("modalExpense");
  toast("Expense saved");
  renderDashboard();
  renderExpenses();
});

async function renderExpenses() {
  const all = await db.transactions.where("type").equals("expense").reverse().sortBy("date");
  const card = document.getElementById("expenseListCard");
  card.innerHTML = "";
  if (all.length === 0) {
    card.innerHTML = '<div class="empty-state">No expenses logged yet.</div>';
    return;
  }
  all.forEach((t) => card.appendChild(activityRow(t)));
}

// ============================================================
// REPORTS
// ============================================================

let reportRange = "today";
document.querySelectorAll("#reportRangeToggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    reportRange = btn.dataset.range;
    document.querySelectorAll("#reportRangeToggle button").forEach((b) => b.classList.toggle("active", b === btn));
    renderReports();
  });
});

async function renderReports() {
  const txs = await transactionsInRange(reportRange);
  let revenue = 0, cogs = 0, commission = 0, expenses = 0;
  const bestSellers = {};

  txs.forEach((t) => {
    if (t.type === "sale") {
      revenue += t.amount;
      cogs += t.unitCost * t.qty;
      bestSellers[t.productName] = (bestSellers[t.productName] || 0) + t.qty;
    }
    if (t.type === "cashin" || t.type === "cashout") commission += t.commission;
    if (t.type === "expense") expenses += t.amount;
  });

  const stockProfit = revenue - cogs;
  const total = stockProfit + commission - expenses;

  document.getElementById("repTotalProfit").textContent = money(total);
  document.getElementById("repRevenue").textContent = money(revenue);
  document.getElementById("repCogs").textContent = "-" + money(cogs);
  document.getElementById("repStockProfit").textContent = money(stockProfit);
  document.getElementById("repCommission").textContent = money(commission);
  document.getElementById("repExpenses").textContent = "-" + money(expenses);

  const bestCard = document.getElementById("repBestSellers");
  bestCard.innerHTML = "";
  const sorted = Object.entries(bestSellers).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    bestCard.innerHTML = '<div class="empty-state">No sales in this period yet.</div>';
  } else {
    sorted.slice(0, 8).forEach(([name, qty]) => {
      bestCard.appendChild(rowEl(name, "", `${qty} sold`, ""));
    });
  }
}

// ============================================================
// SETTINGS
// ============================================================

document.getElementById("saveShopNameBtn").addEventListener("click", async () => {
  const val = document.getElementById("shopNameInput").value.trim();
  if (!val) return;
  await setSetting("shopName", val);
  toast("Shop name saved");
  renderDashboard();
});

document.getElementById("saveBalancesBtn").addEventListener("click", async () => {
  const cash = parseFloat(document.getElementById("setCashInput").value);
  const flt = parseFloat(document.getElementById("setFloatInput").value);
  if (!isNaN(cash)) await setSetting("cashInHand", cash);
  if (!isNaN(flt)) await setSetting("eFloat", flt);
  toast("Balances updated");
  renderDashboard();
});

document.getElementById("addCashinBracket").addEventListener("click", async () => {
  await db.cashinBrackets.add({ min: 0, max: 0, fee: 0 });
  renderBracketTable("cashin");
});
document.getElementById("addCashoutBracket").addEventListener("click", async () => {
  await db.cashoutBrackets.add({ min: 0, max: 0, fee: 0 });
  renderBracketTable("cashout");
});

async function renderBracketTable(kind) {
  const table = kind === "cashin" ? db.cashinBrackets : db.cashoutBrackets;
  const listEl = document.getElementById(kind + "BracketList");
  const rows = await table.orderBy("min").toArray();
  listEl.innerHTML = "";
  rows.forEach((b) => {
    const row = document.createElement("div");
    row.className = "bracket-row";
    row.innerHTML = `
      <input type="number" step="0.01" value="${b.min}" data-field="min">
      <input type="number" step="0.01" value="${b.max}" data-field="max">
      <input type="number" step="0.01" value="${b.fee}" data-field="fee">
      <button class="del-btn" title="Remove">&times;</button>
    `;
    row.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const field = inp.dataset.field;
        const val = parseFloat(inp.value) || 0;
        await table.update(b.id, { [field]: val });
      });
    });
    row.querySelector(".del-btn").addEventListener("click", async () => {
      await table.delete(b.id);
      renderBracketTable(kind);
    });
    listEl.appendChild(row);
  });
}

document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = {
    products: await db.products.toArray(),
    transactions: await db.transactions.toArray(),
    cashinBrackets: await db.cashinBrackets.toArray(),
    cashoutBrackets: await db.cashoutBrackets.toArray(),
    settings: await db.settings.toArray(),
    exportedAt: nowISO()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tuckshop-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  if (!confirm("This deletes everything on this phone. Export a backup first if you're not sure. Continue?")) return;
  await db.delete();
  location.reload();
});

async function renderSettings() {
  document.getElementById("shopNameInput").value = await getSetting("shopName", "My Tuck Shop");
  const bal = await getBalances();
  document.getElementById("setCashInput").value = bal.cashInHand.toFixed(2);
  document.getElementById("setFloatInput").value = bal.eFloat.toFixed(2);
  renderBracketTable("cashin");
  renderBracketTable("cashout");
}

// ============================================================
// PWA install prompt + service worker
// ============================================================

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("installBanner").classList.add("show");
});
document.getElementById("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("installBanner").classList.remove("show");
});

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ============================================================
// BOOT
// ============================================================

(async function boot() {
  await seedIfEmpty();
  renderDashboard();
})();
