# LearnBond: money that moves when learning happens

![LearnBond](thumbnail.png)

> Built for the **PayPal AI Hackathon: Build What's Next with PayPal and AI** (2026).
> HTML/CSS/JS front end · Google Gemini · PayPal **Sandbox** (test money only) · AG Grid · optional zero-dependency Python server on Render.

**🔗 Live demo:** _add your Render URL here_ (free plan: the first load can take about 50 seconds while it wakes up)

Education apps charge a subscription whether or not anyone learns. **LearnBond flips that.** A sponsor (a parent, an aunt abroad, an employer) funds a learning goal through PayPal. The money is held until it is earned. An **AI Tutor** teaches the student. An independent **AI Examiner** questions the student to check the Tutor's claim that they're ready. **Only when the Examiner verifies mastery is the money released.** A **Study Kit Agent** spends a small, sponsor-mandated budget on the materials that close the gaps the Examiner found. Money that isn't earned goes back to the sponsor.

---

## For judges: a 60-second tour

1. Open the live demo. A **setup guide** appears; on the live demo everything is already connected, so just close it.
2. Click **✨ Fill example** → **Design milestones with AI** → **Create goal & go to funding**.
3. Pay with the PayPal button using any PayPal **Sandbox personal account** (test money only).
4. Click **Open student view**, chat with the Tutor, then **I'm ready: call the Examiner** and answer in your own words.
5. Back on the sponsor tab, watch the **payout**, the **Study Kit Agent** and the **money ledger** update live. Then click **Close goal** to see the refund.

### Where to look for each sponsor prize

| Category | Where it lives | What to look for |
|---|---|---|
| **PayPal + AI** | `js/paypal.js`, `server.py`, `js/goals.js` | Smart Buttons checkout; **Payouts API** pays the student only after the AI Examiner's verdict passes code guardrails; **Refunds API** returns unearned money to each contributor's original capture. |
| **Agentic Commerce** | `js/agent.js`, `js/ai.js` (Study Kit Agent) | Gemini plans searches → code runs the catalog search tool → Gemini picks a cart → **code enforces the sponsor's mandate** (catalog prices, per-item cap, budget, auto-buy limit) → PayPal payout to the store. Full reasoning trace shown on the dashboard. |
| **AG Grid** | `js/grids.js`, `js/create.js`, `js/goal.js` | Portfolio grid (progress bars, pinned totals, click-through), money ledger (signed amounts, PayPal references, pinned "held now", cell flashes), audit log (floating filters, quick search, hash tooltips). All three export to CSV. |
| **Render** | `render.yaml`, `server.py` | One-click Blueprint; secrets live in Render env vars; health check on `/api/config`. |

---

## Run it yourself (2 minutes)

**Option A: just open it.** Double-click `index.html`. A **setup guide** pops up on first launch and walks you through *Settings → Gemini key → PayPal Sandbox client ID*. Skip it to explore in demo mode (simulated AI and payments).

**Option B: run the server (real PayPal payouts & refunds).**

```bat
copy .env.example .env      &rem then fill in your Sandbox keys
run.bat                     &rem Windows: creates .venv on first run, opens http://localhost:3000
```

```sh
cp .env.example .env && ./run.sh     # macOS / Linux
```

Or manually: `python -m venv .venv`, activate it, then run `python server.py`. The server uses **only the Python standard library**, so there is nothing to `pip install` (`requirements.txt` exists for tooling and Render).

**Option C: deploy to Render.** Dashboard → **New → Blueprint** → pick this repo. `render.yaml` asks for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `GEMINI_API_KEY`, and judges get a live demo with **zero setup**.

### Getting the keys

1. **Gemini API key**: https://aistudio.google.com/apikey → *Create API key*. Paste it in **Settings**, or put it in `.env` as `GEMINI_API_KEY` so it never reaches the browser.
2. **PayPal Sandbox app**: https://developer.paypal.com → *Apps & Credentials* → **Sandbox** → *Create App*. The **Client ID** can go in Settings or `.env`. The **Secret** goes **only** in `.env` or Render. Pay at checkout with a *Personal* account from *Testing Tools → Sandbox Accounts*.

## The flow

```
Sponsor ──PayPal Sandbox checkout──▶ funds held for the goal (+ optional study-kit budget)
                                         │
Student ◀── AI Tutor (Gemini) teaches ────┤
                                         │
        Tutor makes a "readiness claim" ──▶ AI Examiner (Gemini) tries to disprove it
                                         │   (3–5 adaptive questions, typed or spoken)
                                         ▼
                 Verdict + word-for-word evidence quotes + confidence
                                         │
                 Guardrails (code, not AI) ──┬─ auto ─────────▶ PayPal Payout to student
                                             └─ needs approval ─▶ sponsor approves ─▶ payout
                                         │
   Gaps found ──▶ Study Kit Agent: search store (tool) ▶ propose cart ▶ mandate check (code)
                                         └─ within auto-buy limit ▶ PayPal Payout to store
                                         └─ above limit ▶ sponsor approves ▶ payout
Deadline passes / sponsor closes ──▶ PayPal Refund of unearned funds to each contributor
```

Every step is written to a **SHA-256 hash-chained audit log** that the sponsor can inspect, filter and export.

## What's real and what's simulated

| Part | Static files (no server) | With `server.py` / Render |
|---|---|---|
| Gemini AI (planner, tutor, examiner, shopping agent) | Real with your key in Settings, simulated otherwise | Real with the server's key (never sent to the browser) |
| PayPal checkout (sponsor pays) | **Real Sandbox** (JS SDK) | **Real Sandbox** |
| Payouts to the student and agent purchases | Simulated, clearly labelled | **Real Sandbox Payouts API** |
| Refunds of unearned money | Simulated, clearly labelled | **Real Sandbox Refunds API** (on real captures) |
| Storage | Browser `localStorage`; open the sponsor and student pages in the same browser | same |

The server is hard-wired to `api-m.sandbox.paypal.com`, caps every transfer at $1,000 and rate-limits the API, so it can never move real money.

## Features

- **First-run setup guide**: a step-by-step modal showing how to reach Settings and connect Gemini and PayPal, with live ✓/○ status. It can be reopened from the top bar at any time.
- **AI milestone planner**: turns "Pass WAEC Maths: quadratics" plus a budget into examinable milestones, with the money split by difficulty.
- **AI Tutor**: Socratic, guides the student rather than handing over answers.
- **Two agents, one adversarial**: the Tutor must make an honest readiness claim (strengths *and* suspected gaps), and the Examiner treats it as a hypothesis to disprove.
- **Proof-of-learning receipts**: Examiner quotes are machine-checked against the student's real answers; an invented quote voids the verdict.
- **Agentic commerce (Study Kit Agent)**: a tool-using Gemini agent searches the study store for the exact gaps the Examiner found, proposes a cart and explains each item. **Code enforces the sponsor's mandate**: catalog prices only, a per-item cap, the kit budget, no duplicates, and an auto-buy limit above which the sponsor approves. It pays through PayPal from the held funds. The student can ask it for help too, and student text is treated as untrusted.
- **Guardrails on AI-controlled money**: confidence threshold, auto-release limit, daily cap, attempt limits, and integrity-triggered sponsor review. The AI only *recommends*.
- **AG Grid everywhere money is reported**: a sponsor **portfolio** grid (progress bars, pinned totals, click-through), a **money ledger** (every capture, payout, purchase and refund with PayPal references, signed amounts, a pinned "held now" row, live cell flashes) and the **audit log** grid (floating filters by actor/action, quick search, hash tooltips). All of them export to CSV.
- **Multi-sponsor funding**, **deadline refunds**, a **tamper-evident audit log**, and **live cross-tab updates**.

## Project structure

```
index.html          Create & fund a goal; sponsor portfolio grid
goal.html           Sponsor dashboard: funding, receipts, approvals, Study Kit Agent, ledger, audit
learn.html          Student study room: Tutor chat, Examiner exam, ask the Study Kit Agent
settings.html       Keys (browser only) + setup checklist + server status
css/styles.css
js/backend.js       Detects the optional server (real payouts / server-side Gemini)
js/onboarding.js    First-run setup guide
js/ai.js            Gemini: Planner, Tutor, Examiner, Study Kit Agent (structured output)
js/agent.js         Study Kit Agent: catalog search tool, mandate enforcement, checkout
js/paypal.js        PayPal JS SDK checkout; payouts/refunds via server or simulated
js/goals.js         Core logic: funding, exams, releases, refunds
js/guardrails.js    Release rules + evidence verification
js/grids.js         AG Grid theme + helpers
js/audit.js         Hash-chained audit log (Web Crypto SHA-256)
js/store.js         localStorage persistence
server.py           Optional stdlib-only Python server (static files + PayPal + Gemini proxy)
render.yaml         One-click Render Blueprint
requirements.txt    Empty on purpose: standard library only
.env.example        Template for your secrets (.env is git-ignored)
run.bat / run.sh    Create .venv on first run and start the server
```

## Full guided tour (≈3 minutes)

1. **Setup**: the setup guide appears; show the green ✓ checklist (or click *Explore in demo mode*).
2. **Create**: *Fill example* → *Design milestones with AI*. Gemini splits $60 into three milestones, plus a $12 study-kit mandate.
3. **Fund**: two relatives pay with PayPal Sandbox. The ledger grid flashes the new captures.
4. **Learn & exam**: in the student tab, chat with the Tutor, then *I'm ready*. Paste a textbook answer: it's flagged and probed. Answer properly, by voice if you like.
5. **Money moves**: a verified verdict with quotes from the student's own answers triggers a **real Sandbox payout** (via the server). The sponsor tab updates live.
6. **Agentic commerce**: the student asks the Study Kit Agent for "practice on word problems". Show its trace (think → search → decide → guardrail), the mandate check, and an approval for the cart that is over the limit.
7. **Refund & audit**: *Close goal* sends a real Sandbox refund. Filter the audit grid by `agent`, export the CSV, and point out that the hash chain is intact.

## Sponsor technologies

- **PayPal**: JS SDK Smart Buttons (Orders/Capture), Payouts API and Refunds API (Sandbox).
- **AG Grid Community** (v33): portfolio, ledger and audit grids.
- **Render**: Blueprint deploy (`render.yaml`) of the Python server, secrets kept in Render env vars.
- **Google Gemini** (`gemini-2.5-flash`): structured JSON output (`responseSchema`) for every money-relevant decision.

## License

[MIT](LICENSE)
