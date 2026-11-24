---
title: BioSnap
emoji: 🌿
colorFrom: green
colorTo: emerald
sdk: docker
app_port: 8000
---

# Shrewsbury Species Spotter — FastAPI + BioCLIP 2

A **teaching/MVP** mobile-friendly website that identifies biological organisms with BioCLIP 2, matches the result against a 31-item Shrewsbury/Worcester/Massachusetts species catalog, suggests safe next steps, and optionally stores **unverified** reports in SQLite. It **does not** contact municipal authorities.

## Start on Windows 11 (PowerShell)

1. Install Python 3.11 (64-bit), then open PowerShell inside this folder.
2. Run:

   ```powershell
   py -3.11 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   $env:ADMIN_API_KEY = "replace-with-a-long-random-secret"
   python -m uvicorn app.main:app --reload
   ```

   If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process Bypass` for just that terminal or use `.venv\Scripts\python.exe -m uvicorn app.main:app --reload` instead.

3. Visit `http://127.0.0.1:8000/` to upload or paste a photo.
4. Interactive API documentation: `http://127.0.0.1:8000/docs`.

### First prediction

`pybioclip` downloads the BioCLIP 2 model and reference embeddings on the first request. Model weights alone are around 1.7 GB. An Internet connection, several GB of free disk and enough system memory are needed. CPU inference can be slow; GPU is optional but not configured in this starter. The model is cached and reused while the server process stays running.

If the install is unsuccessful, use the official [pybioclip installation instructions](https://imageomics.github.io/pybioclip/) or first install a supported PyTorch build per [pytorch.org](https://pytorch.org/get-started/locally/).

## API endpoints

- `GET /api/health` — status
- `GET /api/species` — 31-species catalog
- `POST /api/identify` — multipart image field named `file`; model predictions (unverified)
- `POST /api/reports` — multipart fields `file`, `selected_species`, `town`, `notes`, `consent=true`; locally stores a user-reported sighting
- `GET /api/admin/reports` — requires `X-Admin-Key` header equal to server-side `ADMIN_API_KEY`; *development-only*, do not expose publicly without proper authentication and HTTPS

## Test with curl (PowerShell)

```powershell
curl.exe -F "file=@C:\\path\\to\\beetle.jpg" http://127.0.0.1:8000/api/identify
```

## Improving incorrect beetle identification (new)

Instead of trusting BioCLIP's first species name, `/api/identify` now:

1. Runs an open-ended BioCLIP 2 **species** prediction (top five).
2. Runs an open-ended **genus** prediction (top five).
3. If a possible Cerambycidae / Anoplophora beetle is suggested, runs **CustomLabelsClassifier** against a curated list of potential pest species and common lookalikes.
4. Returns `possible_alb`, `genus_predictions`, `lookalike_comparison`, and an expert-review warning, **not** a verified invasive species ID.
5. Keeps reports defaulted to `Uncertain` so a model guess isn't silently recorded as a confirmed species.

**Important:** The closed-set comparison is forced to rank the supplied labels. Do not interpret its top score as the probability that the photo shows that species. A native beetle not on the list may be a better match. This is a prototype, not a validated classifier. Reports are still kept on the server, not sent to town authorities.

To test without downloading BioCLIP, after installing `httpx`, run:

```powershell
python -m unittest discover -s tests -v
```

## Important limitations

- A high BioCLIP score is **not** a calibrated probability of correctness.
- The model compares against taxa in its reference index; it can confuse similar species or miss organisms.
- The local catalog is based on the town report and prior compiled candidate list; the catalog is **not** a verified list of increasing populations. It includes some species only documented at the state level and some locally listed exotic plants.
- Phragmites has native and invasive lineages; species-level name alone may not determine whether the sample is invasive.
- The reference list should be validated with town/state experts before public release.
- The website stores submitted photos only after consent; submitted photos are re-encoded to remove EXIF. It uses SQLite on the server and does not upload photos to third-party inference servers.
- No automatic communication with Shrewsbury exists. Official integration requires an agency partnership; use the authoritative public reporting link where applicable.
- For public production: add user accounts, rate limits, anti-spam controls, access controls for stored photos, encrypted transport, retention/deletion policies, and expert moderation. Do not publish an unsecured admin key.

## Project files

```
app/main.py                 FastAPI, BioCLIP, SQLite reports
app/static/index.html      Photo upload and reporting page
app/static/app.js          Paste/upload and HTTP calls
app/static/styles.css      Responsive presentation
 data/species_catalog.json 31 local/regional species and safe guidance
storage/                   Local report database and stripped photos
```

## Source links

- [BioCLIP 2 model](https://huggingface.co/imageomics/bioclip-2)
- [Official pybioclip tutorial](https://imageomics.github.io/pybioclip/python-tutorial/)
- [Massachusetts spotted lanternfly reporting form](https://massnrc.org/pests/slfreport.aspx)
- The Shrewsbury environmental plan excerpt supplied by the project owner.
