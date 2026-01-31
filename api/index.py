import os
import sys
import json
import io
import numpy as np
from typing import Any
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Path adjustment
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from core.image_processor import ImageProcessor
from core.semantic_analyzer import SemanticAnalyzer
from core.layout_generator import LayoutGenerator

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root of deployment
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# Vercel public directory is served at root, so we look for files in 'public'
# but the browser will see them at the root level (e.g. /index.html)
static_abs_path = os.path.join(BASE_DIR, "public")
DEMO_DATA_URL_PREFIX = "/demo_data"

# Initialize Processors
image_processor = ImageProcessor(upload_dir="/tmp", static_dir=static_abs_path)
semantic_analyzer = SemanticAnalyzer()
layout_generator = LayoutGenerator()

def _get_demo_asset_base_url() -> str | None:
    """Return the configured absolute demo asset base URL, if any.

    When set, this should be a full URL to an object storage folder (e.g. OSS),
    like `https://bucket.oss-cn-beijing.aliyuncs.com/demo`.
    """
    base_url = os.getenv("DEMO_ASSET_BASE_URL", "").strip()
    if not base_url:
        return None
    return base_url.rstrip("/")


def _demo_original_filename(case_id: str) -> str:
    """Return the original image filename for the given demo case."""
    # The repository assets use `.JPG`, while the provided OSS layout uses `.jpg`.
    if _get_demo_asset_base_url():
        return f"{case_id}.jpg"
    return f"{case_id}.JPG"


def demo_asset_url(relative_path: str) -> str:
    """Build a URL for a demo asset (image/json) for the UI/backend to consume."""
    normalized = relative_path.lstrip("/")
    base_url = _get_demo_asset_base_url()
    if base_url:
        return f"{base_url}/{normalized}"
    return f"{DEMO_DATA_URL_PREFIX}/{normalized}"


def demo_thumbnail_url(case_id: str) -> str:
    """Return an optimized thumbnail URL for the case selector grid."""
    base_url = _get_demo_asset_base_url()
    url = demo_asset_url(_demo_original_filename(case_id))
    if not base_url:
        return url
    # On OSS, use on-the-fly image processing to reduce payload.
    return f"{url}?x-oss-process=image/resize,w_600/quality,Q_75/format,webp"


def demo_ortho_preview_url(case_id: str) -> str:
    """Return an optimized ortho preview URL for the main viewport."""
    base_url = _get_demo_asset_base_url()
    url = demo_asset_url(f"{case_id}_ortho.jpg")
    if not base_url:
        return url
    # Keep enough resolution for the viewport while reducing transfer size.
    return f"{url}?x-oss-process=image/resize,w_1800/quality,Q_80/format,webp"


@app.get("/")
async def root() -> Response:
    """Serve the dashboard entrypoint.

    In local/dev contexts, serve `public/index.html` directly.
    In Vercel serverless contexts, static assets may not be present on the
    function filesystem, so we fall back to redirecting to `/index.html`,
    which Vercel serves from `public/`.
    """
    index_path = os.path.join(static_abs_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return RedirectResponse(url="/index.html")


@app.get("/cases")
async def get_cases() -> list[dict[str, Any]]:
    """Return the curated demo cases shown in the UI."""
    return [
        {
            "id": "IMG_1397",
            "name": "Commercial Office A",
            "thumbnail": demo_thumbnail_url("IMG_1397"),
            "ortho_image": demo_ortho_preview_url("IMG_1397"),
            "original_image": demo_asset_url(_demo_original_filename("IMG_1397")),
            "step1_info": {
                "structure": "RC Frame",
                "year": "1995-2005",
                "use": "Commercial/Office",
                "area_est": "2400 m²",
            },
            "step3_info": {
                "bays": 6,
                "symmetry": "High",
                "kitchen_est": "North side columns",
                "bedroom_est": "South facing bays",
            },
        },
        {
            "id": "IMG_1398",
            "name": "Residential Tower B",
            "thumbnail": demo_thumbnail_url("IMG_1398"),
            "ortho_image": demo_ortho_preview_url("IMG_1398"),
            "original_image": demo_asset_url(_demo_original_filename("IMG_1398")),
            "step1_info": {
                "structure": "Shear Wall",
                "year": "2010-2020",
                "use": "Residential",
                "area_est": "5600 m²",
            },
            "step3_info": {
                "bays": 8,
                "symmetry": "Bilateral",
                "kitchen_est": "Inner courtyard side",
                "bedroom_est": "Main facade windows",
            },
        },
        {
            "id": "IMG_1399",
            "name": "Facade Case C",
            "thumbnail": demo_thumbnail_url("IMG_1399"),
            "ortho_image": demo_ortho_preview_url("IMG_1399"),
            "original_image": demo_asset_url(_demo_original_filename("IMG_1399")),
            "step1_info": {
                "structure": "Masonry-Concrete Mix",
                "year": "1980s",
                "use": "Residential/Old Town",
                "area_est": "1200 m²",
            },
            "step3_info": {
                "bays": 4,
                "symmetry": "Low",
                "kitchen_est": "Rear extensions",
                "bedroom_est": "Street facing windows",
            },
        },
    ]


@app.post("/analyze_demo")
async def analyze_demo(request: Request, case_id: str = Form(...)) -> dict[str, Any]:
    """Analyze a bundled demo case and return the computed results."""
    try:
        demo_data_dir = os.path.join(static_abs_path, "demo_data")
        json_path = os.path.join(demo_data_dir, f"{case_id}_ortho.json")
        img_path = os.path.join(demo_data_dir, f"{case_id}_ortho.jpg")

        data: dict[str, Any]
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                data = json.load(f)
        else:
            # In Vercel serverless deployments, the `public/` directory is served
            # by the edge but is not necessarily readable from the function FS.
            base_url = _get_demo_asset_base_url()
            if base_url:
                json_url = f"{base_url}/{case_id}_ortho.json"
            else:
                request_base_url = str(request.base_url).rstrip("/")
                json_url = f"{request_base_url}{DEMO_DATA_URL_PREFIX}/{case_id}_ortho.json"

            try:
                import httpx
            except Exception as e:  # pragma: no cover
                raise HTTPException(status_code=500, detail=f"Missing dependency: httpx ({e})")

            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(json_url)

            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Demo data not found")

            data = resp.json()

        bounding_boxes = []
        counts = {"window": 0, "ac": 0, "door": 0, "other": 0}

        for shape in data["shapes"]:
            pts = np.array(shape["points"])
            x_min, y_min = pts.min(axis=0)
            x_max, y_max = pts.max(axis=0)
            w, h = x_max - x_min, y_max - y_min
            label = shape["label"]
            bounding_boxes.append([label, int(x_min), int(y_min), int(w), int(h)])

            if "window" in label:
                counts["window"] += 1
            elif "ac" in label:
                counts["ac"] += 1
            elif "door" in label:
                counts["door"] += 1
            else:
                counts["other"] += 1

        if os.path.exists(img_path):
            with Image.open(img_path) as img:
                image_dims = img.size
        else:
            base_url = _get_demo_asset_base_url()
            if base_url:
                img_url = f"{base_url}/{case_id}_ortho.jpg"
            else:
                request_base_url = str(request.base_url).rstrip("/")
                img_url = f"{request_base_url}{DEMO_DATA_URL_PREFIX}/{case_id}_ortho.jpg"

            try:
                import httpx
            except Exception as e:  # pragma: no cover
                raise HTTPException(status_code=500, detail=f"Missing dependency: httpx ({e})")

            async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
                resp = await client.get(img_url)

            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Demo image not found")

            with Image.open(io.BytesIO(resp.content)) as img:
                image_dims = img.size

        risk_report = semantic_analyzer.analyze(bounding_boxes, image_dims)

        return {
            "status": "success",
            "risk_report": risk_report,
            "counts": counts,
            "images": {
                "original": demo_asset_url(_demo_original_filename(case_id)),
                "processed": demo_asset_url(f"{case_id}_ortho.jpg"),
            },
            "debug": {
                "boxes_count": len(bounding_boxes),
                "image_dims": image_dims,
                "raw_boxes": bounding_boxes,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
