# HIRE INTELLIGENCE
**BMW Digital Excellence Hub Hackathon 2026**

Multi-agent AI pipeline for senior hiring decisions. Combines UC02 (Dynamic JD Adaptation), UC04 (Scenario-Based Ranking), and UC05 (Internal vs External Hire) into a single, working tool.

---

## QUICK START

### 1. Get an OpenRouter API key
- Go to https://openrouter.ai
- Sign up or log in
- Create a new API key

### 2. Install dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 3. Add your API key
Create a `.env.local` file in the project root:
```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 4. Start the server
```bash
cd backend
python main.py
```

Open **http://localhost:3001** in your browser.

---

## HOW IT WORKS

### Workflow

1. **HR creates positions** — On the main dashboard, click "+ Add Position" to add job descriptions (title + full JD text). Multiple positions can be managed simultaneously for different roles in the same company.
2. **Candidates apply** — On the `/apply.html` page, applicants select a position from a dropdown, upload their CV, and answer screening questions. Each application is tied to a specific position.
3. **HR reviews candidates** — Back on the dashboard, candidates are displayed with the position they applied to. Use the position filter to view candidates per role.
4. **HR selects a position for the pipeline** — Click a position card to select it. The JD auto-populates and candidates are filtered to that role.
5. **HR picks candidates & runs the AI pipeline** — Select up to 3 candidates, choose a business scenario, set urgency, and run the 4-agent analysis.

### Architecture

- **Frontend**: Vanilla HTML/CSS/JS — no frameworks, no build step
- **Backend**: Python FastAPI + Uvicorn
- **AI**: 4 specialized LLM agents via OpenRouter API
- **Storage**: Candidates persisted to `backend/data/candidates.json`; JD positions stored in browser localStorage

---

## PROJECT STRUCTURE

```
hire-intelligence/
├── index.html              ← HR dashboard (3-screen pipeline UI)
├── apply.html              ← Candidate application page
├── css/
│   └── main.css            ← All styles
├── js/
│   ├── app.js              ← App state, JD management, position filtering, navigation
│   ├── ui.js               ← DOM rendering (candidates, JD list, pipeline panels)
│   ├── apply.js            ← Application form logic
│   └── pipeline.js         ← API client for agent pipeline
├── data/
│   ├── scenarios.js        ← 5 business scenarios
│   └── jobDescription.js   ← Example JD text
├── backend/
│   ├── main.py             ← FastAPI app, static file serving, CORS
│   ├── requirements.txt
│   ├── api/
│   │   ├── apply.py        ← POST /api/apply (candidate intake)
│   │   ├── candidates.py   ← GET /api/candidates
│   │   ├── pipeline.py     ← POST /api/pipeline, POST /api/pipeline/rerun
│   │   └── health.py       ← GET /api/health
│   ├── core/
│   │   ├── agents.py       ← All 5 AI agents (Agent 0–4)
│   │   ├── cv_parser.py    ← PDF/DOCX text extraction
│   │   └── store.py        ← Thread-safe JSON file store
│   └── models/
│       ├── candidate.py    ← CandidateProfile (Pydantic model)
│       └── pipeline.py     ← Pipeline request/response models
└── .env.local              ← Your OPENROUTER_API_KEY (never commit)
```

---

## KEY FEATURES

### Multi-Position JD Management
- Add, edit, and delete positions from the dashboard
- Each position has a title and full JD text
- Click a position card to select it for the pipeline
- Positions are stored in localStorage (48-hour TTL)

### Position-Aware Applications
- Applicants select a position from a dropdown when applying
- Position is stored server-side on the candidate profile (`applied_position`)
- Candidates display their applied position as a badge in the HR view

### Candidate Filtering
- Filter the candidate pool by position
- "All Positions" view shows everyone
- Selecting a position for the pipeline auto-filters candidates

---

## THE 5 AGENTS

| Agent | Use Case | What it does |
|-------|----------|--------------|
| Agent 0 | CV Parsing | Extracts structured profile from CV + screening answers |
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


python -m uvicorn main:app --reload --port 3001
