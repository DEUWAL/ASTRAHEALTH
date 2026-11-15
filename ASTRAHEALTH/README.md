# ASTRAHEALTH — BITCOSMOS
**Monitoring Life Beyond Earth.** AI-assisted astronaut health monitoring and early-warning prototype
(NASA Space Apps Challenge 2026). Research / decision-support prototype — **not clinically validated or medically certified.**

## Status (honest)
| Area | State |
|---|---|
| Core logic (validation, baselines, Isolation Forest + statistical + trend detection, risk GREEN/AMBER/RED, alert dedupe, CSV import, idempotent sync logic, radiation units, PDF/CSV reports, synthetic simulator) | **Implemented and tested** (16 tests pass, see documentation/TEST_REPORT.md) |
| FastAPI app, SQLAlchemy models, JWT/Argon2 auth, RBAC, all REST endpoints | **Written, NOT yet executed** (FastAPI/SQLAlchemy could not be installed in the authoring sandbox). Syntax-checked only. `tests/test_api.py` is ready to run. |
| Docker / Compose / Render config | Written, not built or deployed |
| Alembic migrations | **Not generated** (app uses `create_all` for dev) |
| **One-click browser demo** (`docs/index.html`): 4 demo scenarios, GREEN/AMBER/RED status, alerts with acknowledge/resolve, offline queue in IndexedDB + idempotent sync to a *simulated* server, CSV export | **Implemented; logic tested headlessly with Node** (`node docs/engine.test.js`) and UI render smoke-tested with a DOM stub. Not yet checked in a real browser. |
| Full React/Vite/Tailwind frontend connected to the FastAPI backend, Vercel config, NASA OSDR integration | **Not started** |

## Try it in one click (no install)
Open `docs/index.html` in a browser, or host it free with **GitHub Pages**: repository **Settings → Pages → Deploy from a branch → `main` / `/docs` → Save**.
Your demo URL will be `https://<your-username>.github.io/<repo-name>/`. Put that link in your NASA Space Apps submission.
The browser demo uses synthetic data only and does not call the Python backend; it is a JavaScript port of the same rule / baseline / risk / alert logic.

## Run the backend locally
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env                 # set JWT_SECRET_KEY etc.
python scripts_train_and_seed.py        # trains model on SYNTHETIC data + seeds demo DB
uvicorn app.main:app --reload           # http://localhost:8000/docs
pytest                                  # core + API tests
```
No-dependency core check: `python run_core_tests.py`

Demo users (seeded, fictional data): `admin`, `medic`, `control`, `astro1` — password = `DEMO_PASSWORD` env var,
or the default in `scripts_train_and_seed.py`. Change it; never use for real deployments.

## Design notes
- All simulated data is labelled `source=SYNTHETIC`. Missing/invalid data raises a separate data-quality warning and is never treated as GREEN.
- Thresholds in `app/core/rules.py` are prototype configuration, not clinical limits. Anomaly scores are not disease probabilities.
- The ML detector's recall depends on its contamination setting; see the tradeoff test in `tests/test_core.py`. Metrics are on synthetic data only.
