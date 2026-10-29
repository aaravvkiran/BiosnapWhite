"""FastAPI + BioCLIP 2 teaching MVP. Reports are NOT sent to a town agency."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import sqlite3
import threading
import uuid
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError

BASE = Path(__file__).resolve().parent.parent
STORAGE = BASE / "storage"
PHOTOS = STORAGE / "photos"
DB_PATH = STORAGE / "reports.sqlite3"
CATALOG = json.loads((BASE / "data" / "species_catalog.json").read_text(encoding="utf-8"))
CATALOG_BY_NAME = {
    name.strip().casefold(): row
    for row in CATALOG
    for name in [row["scientific_name"], *row.get("aliases", [])]
}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000
MODEL_LOCK = threading.Lock()  # Limit concurrent inference on one local model.
logger = logging.getLogger(__name__)

app = FastAPI(title="Shrewsbury Invasive Species API", version="0.1.0")
app.mount("/static", StaticFiles(directory=BASE / "app" / "static"), name="static")


def init_db() -> None:
    STORAGE.mkdir(exist_ok=True)
    PHOTOS.mkdir(exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          selected_species TEXT NOT NULL, town TEXT NOT NULL, notes TEXT NOT NULL,
          photo_filename TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review'
        )""")


init_db()


# Candidate names for a second-stage comparison. These are lookalikes, NOT
# claims that every one occurs in Massachusetts or is invasive locally.
LONGHORN_LOOKALIKES = [
    "Anoplophora glabripennis",  # Asian longhorned beetle (regulated pest)
    "Anoplophora lucipor",      # Example of BioCLIP's confusing prediction
    "Anoplophora chinensis",    # Citrus longhorned beetle
    "Monochamus scutellatus",   # Whitespotted sawyer (native lookalike)
    "Monochamus notatus",       # Northeastern sawyer (native lookalike)
    "Trenetica lacrymans",      # Another possible wrong model result
]


@lru_cache(maxsize=1)
def get_classifier():
    """Loads the BioCLIP 2 model once (first call downloads it)."""
    from bioclip.predict import TreeOfLifeClassifier
    return TreeOfLifeClassifier()


@lru_cache(maxsize=1)
def get_lookalike_classifier():
    """A focused comparison; its output is still NOT a verified identification."""
    from bioclip.predict import CustomLabelsClassifier
    return CustomLabelsClassifier(LONGHORN_LOOKALIKES)


def predict_with_model(image: Image.Image) -> dict:
    """Broad species + genus prediction; second pass for possible longhorn beetles.

    A focused model must never be treated as proof that one of its candidates
    is actually present in the photograph: this is a forced choice.
    """
    from bioclip import Rank
    with MODEL_LOCK:
        clf = get_classifier()
        # Official pybioclip docs support a list of Pillow images.
        species = clf.predict([image], Rank.SPECIES, k=5)
        genera = clf.predict([image], Rank.GENUS, k=5)

        # If the model predicts a longhorn beetle (even incorrectly at species
        # level), add a *comparison*, not an automatic 'ALB' verdict.
        is_longhorn_candidate = any(
            str(p.get("family", "")).casefold() == "cerambycidae"
            or str(p.get("genus", "")).casefold() == "anoplophora"
            for p in species
        ) or any(str(p.get("genus", "")).casefold() == "anoplophora" for p in genera)

        comparisons = (
            get_lookalike_classifier().predict([image])
            if is_longhorn_candidate else []
        )

    # Flag for careful review, not a confirmed detection or an official report.
    possible_alb = any(
        str(p.get("genus", "")).casefold() == "anoplophora"
        for p in (species + genera)
    )
    return {
        "species": species,
        "genera": genera,
        "lookalikes": comparisons,
        "possible_alb": possible_alb,
    }


async def validated_image(file: UploadFile) -> Image.Image:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image exceeds 8 MB")
    if not raw:
        raise HTTPException(400, "No image was provided")
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            if opened.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(415, "Please use JPEG, PNG, or WebP")
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((2048, 2048))
            return image
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Invalid or oversized image") from exc


@app.get("/")
def home():
    return FileResponse(
        BASE / "app" / "static" / "index.html",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "model": "BioCLIP 2 (loads on first identification)", "catalog_species": len(CATALOG)}


@app.get("/api/species")
def get_species():
    return CATALOG


@app.post("/api/identify")
async def identify(file: UploadFile = File(...)):
    img = await validated_image(file)
    try:
        raw_predictions = await asyncio.to_thread(predict_with_model, img)
    except Exception as exc:
        logger.exception("BioCLIP 2 inference failed")
        raise HTTPException(503, "BioCLIP 2 is unavailable. Check the server logs and internet access for the initial model download.") from exc

    results = []
    for prediction in raw_predictions["species"]:
        scientific = str(prediction.get("species", "")).strip()
        match = CATALOG_BY_NAME.get(scientific.casefold())
        results.append({
            "scientific_name": scientific,
            "genus": prediction.get("genus", ""),
            "family": prediction.get("family", ""),
            "model_score": round(float(prediction.get("score", 0)), 5),
            "common_name_from_model": prediction.get("common_name", ""),
            "in_local_catalog": match is not None,
            "local_entry": match,
        })

    genera = [
        {"genus": str(p.get("genus", "")), "model_score": round(float(p.get("score", 0)), 5)}
        for p in raw_predictions["genera"]
    ]
    lookalikes = [
        {"scientific_name": str(p.get("classification", "")),
         "relative_score": round(float(p.get("score", 0)), 5)}
        for p in raw_predictions["lookalikes"]
    ]
    possible_alb = raw_predictions["possible_alb"]
    return {
        "predictions": results,
        "genus_predictions": genera,
        "lookalike_comparison": lookalikes,
        "possible_alb": possible_alb,
        "alb_reference": CATALOG_BY_NAME.get("anoplophora glabripennis") if possible_alb else None,
        "review_required": True,
        "identification_status": "needs_expert_verification",
        "note": (
            "Both open-ended scores and the closed-set lookalike scores are uncalibrated. "
            "The true species may be absent from the candidate list. "
            "Never assume a species is confirmed or non-invasive solely from model predictions."
        ),
        "safety_note": (
            "Possible Anoplophora beetle. Do not move suspected infested wood. "
            "Photograph the beetle and seek guidance from USDA/MA plant health officials. "
            "Not an official identification or report."
            if possible_alb else
            "Seek expert review before removing organisms or taking treatment action."
        ),
        "official_alb_info": "https://www.aphis.usda.gov/plant-pests-diseases/alb" if possible_alb else None,
    }


@app.post("/api/reports", status_code=201)
async def create_report(
    file: UploadFile = File(...),
    selected_species: str = Form(...),
    town: str = Form("Shrewsbury"),
    notes: str = Form(""),
    consent: bool = Form(False),
):
    if not consent:
        raise HTTPException(400, "Consent is required before saving the photo")
    if selected_species not in {row["scientific_name"] for row in CATALOG} and selected_species != "Uncertain":
        raise HTTPException(400, "Choose a listed species or Uncertain")
    if town not in {"Shrewsbury", "Worcester", "Other Massachusetts"}:
        raise HTTPException(400, "Invalid town")
    if len(notes) > 1000:
        raise HTTPException(400, "Notes must have 1000 characters or fewer")
    img = await validated_image(file)
    report_id = uuid.uuid4().hex
    filename = f"{report_id}.jpg"
    img.save(PHOTOS / filename, format="JPEG", quality=85)  # removes original EXIF metadata
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO reports (id, selected_species, town, notes, photo_filename) VALUES (?,?,?,?,?)",
                (report_id, selected_species, town, notes, filename),
            )
    except Exception:
        (PHOTOS / filename).unlink(missing_ok=True)
        raise
    return {"report_id": report_id, "status": "pending_review", "sent_to_town": False,
            "message": "Saved locally for review; NOT sent to Shrewsbury or state authorities."}


@app.get("/api/admin/reports")
def list_reports(x_admin_key: str | None = Header(default=None)):
    expected = os.environ.get("ADMIN_API_KEY")
    if not expected:
        raise HTTPException(503, "Set ADMIN_API_KEY in the server environment first")
    import hmac
    if not x_admin_key or not hmac.compare_digest(x_admin_key, expected):
        raise HTTPException(401, "Invalid admin key")
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT id, created_at, selected_species, town, notes, status FROM reports ORDER BY created_at DESC").fetchall()
    return [dict(row) for row in rows]
