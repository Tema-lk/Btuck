# Tuck Shop Ledger

An offline-first app for stock, mobile money (cash-in/cash-out), and expense
tracking, built to install to a phone's home screen like a normal app —
no app store, no data plan required to use it day-to-day.

## What it does

- **Stock**: add products with cost/sell price and quantity, log sales in
  two taps, automatic low-stock warnings.
- **Mobile money**: tracks the two balances that matter — cash in hand and
  e-float — and moves them correctly on every cash-in, cash-out, and
  ATM/branch deposit. Commission is calculated from an editable bracket
  table (Settings tab) so it can be corrected the moment the real Orange
  Money agent commission sheet is available — no coding required.
- **Expenses**: quick categorized logging.
- **Reports**: today / this week / this month view of stock profit, mobile
  money commission, expenses, and total profit, plus best sellers.
- **Backup**: Settings → Export all data downloads a JSON file, in case the
  phone is ever lost or replaced.

All data is stored **on the device only** (IndexedDB), and the app is
built to work with zero signal. Nothing needs the internet after it's
installed, except to install it in the first place.

## Getting it onto the phone

A PWA needs to be served over HTTPS to be installable — opening the HTML
file directly won't allow "Add to Home Screen" to work properly. The
easiest free options:

**Option A — GitHub Pages (free, recommended)**
1. Create a new GitHub repository and upload all the files in this folder
   (keep the `icons` folder inside it).
2. Repository → Settings → Pages → set source to the main branch.
3. GitHub gives you a URL like `https://yourname.github.io/tuckshop/`.
4. Open that URL on the phone in Chrome → menu → **Add to Home Screen**.

**Option B — Netlify Drop (free, no account needed)**
1. Go to https://app.netlify.com/drop in a browser.
2. Drag this whole folder onto the page.
3. It gives you an instant HTTPS URL — open that on the phone and
   **Add to Home Screen**.

Once installed, the phone can go offline immediately — it caches
everything it needs on first load.

## Extending it later

- `app.js` — all app logic (single file, no build step).
- `styles.css` — visual design.
- `index.html` — screens and modals.
- Commission brackets live in the database, editable from the Settings
  screen directly — you don't need to touch code to update them.

Natural next features once the MVP is in daily use: multi-day trend
charts, a PIN lock, and CSV export for reports.
