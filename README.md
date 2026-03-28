# HIRE INTELLIGENCE
**BMW Digital Excellence Hub Hackathon 2026**

Multi-agent AI pipeline for senior hiring decisions. Combines UC02 (Dynamic JD Adaptation), UC04 (Scenario-Based Ranking), and UC05 (Internal vs External Hire) into a single, working tool.

---

## QUICK START (4 steps)

### 1. Get a Grok API key
- Go to https://console.x.ai
- Sign up or log in
- Create a new API key
- Copy your key (starts with `sk-`)

### 2. Install dependencies
```bash
npm install
```

### 3. Add your API key
Create a `.env` file in the project root:
```bash
GROK_API_KEY=sk-your-grok-api-key-here
```

### 4. Start the server
```bash
npm start
```

Open **http://localhost:3000** in your browser.

---

## HOW IT WORKS

**No framework. No build step. No React. No TypeScript.**

Just:
- `index.html` — the entire 3-screen UI
- `css/main.css` — all styles
- `js/app.js` — navigation, state, event handling
- `js/ui.js` — DOM rendering functions
- `js/pipeline.js` — API call functions
- `data/*.js` — candidate, scenario, and JD data
- `server.js` — Node.js server (no Express) that serves HTML + runs 4 AI agents via Grok

---

## PROJECT STRUCTURE

```
hire-intelligence/
├── index.html          ← All 3 screens in one file
├── server.js           ← Node.js backend + all 4 agents
├── package.json
└── .env                ← Your GROK_API_KEY (never commit this)
├── css/
│   └── main.css        ← All styles
├── js/
│   ├── app.js          ← App logic and navigation
│   ├── ui.js           ← DOM rendering
│   └── pipeline.js     ← API calls + demo fallback data
└── data/
    ├── candidates.js   ← 3 synthetic candidate profiles
    ├── scenarios.js    ← 4 business scenarios
    └── jobDescription.js ← Default JD text
```

---

## DEMO MODE

If the backend isn't running or the API key is missing, the app automatically falls back to pre-built demo data so you can still show the full UI flow. Check the browser console — it will say "API unavailable, using demo data".

---

## DEPLOYMENT (Vercel / Railway / Render)

For Vercel — add a `vercel.json`:
```json
{
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

Set `GROK_API_KEY` as an environment variable in your deployment dashboard.

---

## THE 4 AGENTS

| Agent | Use Case | What it does |
|-------|----------|--------------|
| Agent 1 | UC02 | Reweights JD criteria for the current business scenario |
| Agent 2 | UC05 | Evaluates internal vs external sourcing across speed/cost/risk |
| Agent 3 | UC04 | Scores every candidate per criterion (not a single number) |
| Agent 4 | Cross-UC | Synthesises a plain-English recommendation with tradeoff analysis |

All 4 agents call `grok-2-latest` via Grok's OpenAI-compatible API. The pipeline runs in under 30 seconds. All outputs are overridable by the HR lead before the decision is logged.

---

## ETHICAL COMPLIANCE

- All candidate data is synthetic — no real personal data
- Human always decides — every output has an override button
- Transparent reasoning — every score has a one-sentence evidence statement
- Full audit trail — every run logs scenario, weights, scores, and final decision
