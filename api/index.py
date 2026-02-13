import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps


class StaticFilesWithCache(StaticFiles):
    """StaticFiles that sets Cache-Control for browser caching."""

    def __init__(
        self,
        directory: str,
        *,
        cache_control: str = "public, max-age=86400",
        **kwargs: Any,
    ) -> None:
        super().__init__(directory=directory, **kwargs)
        self.cache_control = cache_control

    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers.setdefault("Cache-Control", self.cache_control)
        return resp

# Path adjustment so `core/` can be imported when running from repo root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from core.semantic_analyzer import SemanticAnalyzer

DEMO_DATA_URL_PREFIX = "/demo_data"
FLOORPLAN_SVG_URL_PREFIX = "/floorplan_svg"
THUMB_URL_PREFIX = "/thumb"
VIEWPORT_URL_PREFIX = "/viewport"
VIEWPORT_MAX_SIZE = int(os.getenv("VIEWPORT_MAX_SIZE", "1920"))

REPO_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "public"
DEMO_DATA_DIR = Path(os.getenv("DEMO_DATA_DIR", str(PUBLIC_DIR / "demo_data"))).resolve()
FRONTEND_DIST_DIR = (REPO_ROOT / "frontend" / "dist").resolve()
FLOORPLAN_SVG_DIR = Path(os.getenv("FLOORPLAN_SVG_DIR", str(REPO_ROOT / "data" / "Untitled"))).resolve()
THUMB_CACHE_DIR = Path(os.getenv("THUMB_CACHE_DIR", "/tmp/sgs_thumbs")).resolve()
DEMO_ORIGINAL_DIR = Path(os.getenv("DEMO_ORIGINAL_DIR", str(REPO_ROOT / "data" / "demo"))).resolve()
# When set (e.g. https://cdn.example.com), demo image URLs are absolute OSS/CDN URLs instead of relative paths.
DEMO_DATA_OSS_BASE = os.getenv("DEMO_DATA_OSS_BASE", "").rstrip("/")


def _safe_resolve_under(root: Path, rel: str) -> Path:
    """Resolve `rel` under `root` and reject path traversal."""
    candidate = (root / rel.lstrip("/")).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {rel}") from e
    return candidate


def _demo_original_filename(case_id: str) -> str:
    """Return the original image filename for the given demo case (local-only)."""
    return f"{case_id}.JPG"


def _demo_base(path: str) -> str:
    """Return either OSS/CDN absolute URL or relative path for a demo resource."""
    if DEMO_DATA_OSS_BASE:
        return f"{DEMO_DATA_OSS_BASE}/{path.lstrip('/')}"
    return f"/{path.lstrip('/')}"


def demo_asset_url(relative_path: str) -> str:
    """Build a URL for a demo asset served from local disk or OSS."""
    normalized = relative_path.lstrip("/")
    if DEMO_DATA_OSS_BASE:
        return _demo_base(f"demo_data/{normalized}")
    return f"{DEMO_DATA_URL_PREFIX}/{normalized}"


def demo_thumbnail_url(case_id: str) -> str:
    """Return a thumbnail URL for the case selector grid."""
    if DEMO_DATA_OSS_BASE:
        return _demo_base(f"thumb/orig/{case_id}.jpg")
    return f"{THUMB_URL_PREFIX}/orig/{case_id}.jpg"


def demo_ortho_preview_url(case_id: str) -> str:
    """Return the ortho preview URL for the main viewport."""
    return demo_asset_url(f"{case_id}_ortho.jpg")


def demo_viewport_original_url(case_id: str) -> str:
    """Return the viewport-sized (max edge 1920px) original image URL for the main view."""
    if DEMO_DATA_OSS_BASE:
        return _demo_base(f"viewport/{case_id}/original")
    return f"{VIEWPORT_URL_PREFIX}/{case_id}/original"


def demo_viewport_ortho_url(case_id: str) -> str:
    """Return the viewport-sized (max edge 1920px) ortho image URL for the main view."""
    if DEMO_DATA_OSS_BASE:
        return _demo_base(f"viewport/{case_id}/ortho")
    return f"{VIEWPORT_URL_PREFIX}/{case_id}/ortho"


app = FastAPI(title="NewDemoFacade API")

# In integrated deployments, the frontend is served from the same origin, so CORS
# is only needed for local Vite dev (http://localhost:5173).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _image_size(path: Path) -> List[int]:
    """Return image size as [width, height]."""
    with Image.open(path) as img:
        w, h = img.size
    return [int(w), int(h)]


@app.get(f"{THUMB_URL_PREFIX}" + "/{case_id}.jpg")
async def get_thumb(case_id: str) -> Response:
    """Serve a cached downscaled JPEG thumbnail for the ortho image."""
    src = DEMO_DATA_DIR / f"{case_id}_ortho.jpg"
    if not src.exists():
        raise HTTPException(status_code=404, detail="Ortho image not found")

    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dst = THUMB_CACHE_DIR / f"{case_id}_ortho_thumb.jpg"

    try:
        src_mtime = src.stat().st_mtime
        dst_mtime = dst.stat().st_mtime if dst.exists() else 0
    except Exception:
        src_mtime = 0
        dst_mtime = 0

    if (not dst.exists()) or (dst_mtime < src_mtime):
        with Image.open(src) as img:
            img = img.convert("RGB")
            w, h = img.size

            # Limit both width/height; keep aspect ratio.
            max_w = int(os.getenv("THUMB_MAX_W", "720"))
            max_h = int(os.getenv("THUMB_MAX_H", "480"))
            scale = min(max_w / max(w, 1), max_h / max(h, 1), 1.0)
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            resampling = getattr(Image, "Resampling", Image)
            img = img.resize((new_w, new_h), resampling.LANCZOS)

            img.save(
                dst,
                format="JPEG",
                quality=int(os.getenv("THUMB_QUALITY", "75")),
                optimize=True,
                progressive=False,
            )

    response = FileResponse(str(dst), media_type="image/jpeg")
    response.headers["Cache-Control"] = "public, max-age=604800"  # 7 days
    return response


@app.get(f"{THUMB_URL_PREFIX}" + "/orig/{case_id}.jpg")
async def get_thumb_original(case_id: str) -> Response:
    """Serve a cached, center-cropped thumbnail for the ORIGINAL image.

    This is optimized for the "Select Building" modal: consistent aspect ratio,
    small payload, and no progressive scanning.
    """
    # Prefer the user-specified originals directory; fall back to repo demo_data.
    src = DEMO_ORIGINAL_DIR / f"{case_id}.JPG"
    if not src.exists():
        src = DEMO_DATA_DIR / f"{case_id}.JPG"
    if not src.exists():
        raise HTTPException(status_code=404, detail="Original image not found")

    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dst = THUMB_CACHE_DIR / f"{case_id}_orig_thumb_600x420.jpg"

    try:
        src_mtime = src.stat().st_mtime
        dst_mtime = dst.stat().st_mtime if dst.exists() else 0
    except Exception:
        src_mtime = 0
        dst_mtime = 0

    if (not dst.exists()) or (dst_mtime < src_mtime):
        with Image.open(src) as img:
            # Correct EXIF orientation (these originals are rotated in metadata).
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")

            target_w = int(os.getenv("ORIG_THUMB_W", "600"))
            target_h = int(os.getenv("ORIG_THUMB_H", "420"))  # ~10:7, good for building facades

            w, h = img.size
            scale = max(target_w / max(w, 1), target_h / max(h, 1))
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            resampling = getattr(Image, "Resampling", Image)
            img = img.resize((new_w, new_h), resampling.LANCZOS)

            # Center crop.
            left = max(0, (new_w - target_w) // 2)
            top = max(0, (new_h - target_h) // 2)
            img = img.crop((left, top, left + target_w, top + target_h))

            img.save(
                dst,
                format="JPEG",
                quality=int(os.getenv("ORIG_THUMB_QUALITY", "72")),
                optimize=True,
                progressive=False,
            )

    response = FileResponse(str(dst), media_type="image/jpeg")
    response.headers["Cache-Control"] = "public, max-age=604800"  # 7 days
    return response


def _serve_viewport_image(case_id: str, kind: str) -> Response:
    """Generate or serve a cached viewport-sized (max edge VIEWPORT_MAX_SIZE) image.

    kind is 'original' or 'ortho'. Returns a FileResponse with Cache-Control.
    """
    if kind == "original":
        src = DEMO_ORIGINAL_DIR / f"{case_id}.JPG"
        if not src.exists():
            src = DEMO_DATA_DIR / f"{case_id}.JPG"
        cache_name = f"{case_id}_viewport_orig_{VIEWPORT_MAX_SIZE}.jpg"
    else:
        src = DEMO_DATA_DIR / f"{case_id}_ortho.jpg"
        cache_name = f"{case_id}_viewport_ortho_{VIEWPORT_MAX_SIZE}.jpg"

    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Image not found for case {case_id}")

    THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dst = THUMB_CACHE_DIR / cache_name

    try:
        src_mtime = src.stat().st_mtime
        dst_mtime = dst.stat().st_mtime if dst.exists() else 0
    except Exception:
        src_mtime = 0
        dst_mtime = 0

    if (not dst.exists()) or (dst_mtime < src_mtime):
        with Image.open(src) as img:
            if kind == "original":
                img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            w, h = img.size
            scale = min(VIEWPORT_MAX_SIZE / max(w, 1), VIEWPORT_MAX_SIZE / max(h, 1), 1.0)
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            resampling = getattr(Image, "Resampling", Image)
            img = img.resize((new_w, new_h), resampling.LANCZOS)
            img.save(
                dst,
                format="JPEG",
                quality=int(os.getenv("VIEWPORT_QUALITY", "85")),
                optimize=True,
                progressive=True,
            )

    response = FileResponse(str(dst), media_type="image/jpeg")
    response.headers["Cache-Control"] = "public, max-age=604800"  # 7 days
    return response


@app.get(f"{VIEWPORT_URL_PREFIX}" + "/{case_id}/original")
async def get_viewport_original(case_id: str) -> Response:
    """Serve a viewport-sized (max edge 1920px) original image for the main view."""
    return _serve_viewport_image(case_id, "original")


@app.get(f"{VIEWPORT_URL_PREFIX}" + "/{case_id}/ortho")
async def get_viewport_ortho(case_id: str) -> Response:
    """Serve a viewport-sized (max edge 1920px) ortho image for the main view."""
    return _serve_viewport_image(case_id, "ortho")


if DEMO_DATA_DIR.exists():
    app.mount(
        DEMO_DATA_URL_PREFIX,
        StaticFilesWithCache(directory=str(DEMO_DATA_DIR), cache_control="public, max-age=86400"),
        name="demo_data",
    )

if FLOORPLAN_SVG_DIR.exists():
    app.mount(
        FLOORPLAN_SVG_URL_PREFIX,
        StaticFiles(directory=str(FLOORPLAN_SVG_DIR)),
        name="floorplan_svg",
    )


# IMPORTANT: keep server memory footprint low.
# - `core.image_processor` can import OpenCV and optionally torch/transformers.
# - `core.layout_generator` imports ezdxf.
# For the local demo API, we only need `SemanticAnalyzer`, so we avoid importing
# heavy modules at startup. If/when you re-add upload/DXF endpoints, import and
# initialize them inside those endpoint functions.
semantic_analyzer = SemanticAnalyzer()


STRUCTURAL_CONFIG_PATH = Path(
    os.getenv("STRUCTURAL_CONFIG_PATH", str(REPO_ROOT / "frontend" / "public" / "floorplan_3d_config.json"))
).resolve()


@app.get("/api/structural_config")
async def get_structural_config() -> Dict[str, Any]:
    """Return the current structural elements configuration (floorplan_3d_config.json)."""
    if not STRUCTURAL_CONFIG_PATH.exists():
        return {"wallHeight": 2.8, "floorHeight": 3.0, "structuralElements": {"columns": [], "beams": [], "shearWalls": []}}
    try:
        data = json.loads(STRUCTURAL_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read config: {e}") from e
    return data


@app.post("/api/structural_config")
async def save_structural_config(request: Request) -> Dict[str, str]:
    """Save structural elements configuration to floorplan_3d_config.json."""
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}") from e

    # Validate minimal structure
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    STRUCTURAL_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    STRUCTURAL_CONFIG_PATH.write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"status": "saved"}


@app.get("/api/health")
async def health() -> Dict[str, str]:
    """Return a simple health check payload."""
    return {"status": "ok"}


@app.get("/api/cases")
async def get_cases() -> List[Dict[str, Any]]:
    """Return the curated demo cases shown in the UI (local-only assets)."""
    # Include image dimensions so the frontend can preserve aspect ratios without
    # forcing the browser to decode huge JPEGs for layout.
    dims: Dict[str, Dict[str, list[int]]] = {}
    for case_id in ["IMG_1397", "IMG_1398", "IMG_1399"]:
        dims[case_id] = {}
        ortho_path = DEMO_DATA_DIR / f"{case_id}_ortho.jpg"
        orig_path = DEMO_DATA_DIR / f"{case_id}.JPG"
        if ortho_path.exists():
            dims[case_id]["ortho"] = _image_size(ortho_path)
        if orig_path.exists():
            dims[case_id]["original"] = _image_size(orig_path)

    return [
        {
            "id": "BUILDING_001",
            "name": "Demo Building",
            "facades": [
                {
                    "id": "IMG_1397",
                    "label": "北外立面",
                    "thumbnail": demo_thumbnail_url("IMG_1397"),
                    "ortho_image": demo_ortho_preview_url("IMG_1397"),
                    "original_image": demo_asset_url(_demo_original_filename("IMG_1397")),
                    "viewport_original_url": demo_viewport_original_url("IMG_1397"),
                    "viewport_ortho_url": demo_viewport_ortho_url("IMG_1397"),
                    "ortho_dims": dims.get("IMG_1397", {}).get("ortho"),
                    "original_dims": dims.get("IMG_1397", {}).get("original"),
                },
                {
                    "id": "IMG_1398",
                    "label": "西外立面",
                    "thumbnail": demo_thumbnail_url("IMG_1398"),
                    "ortho_image": demo_ortho_preview_url("IMG_1398"),
                    "original_image": demo_asset_url(_demo_original_filename("IMG_1398")),
                    "viewport_original_url": demo_viewport_original_url("IMG_1398"),
                    "viewport_ortho_url": demo_viewport_ortho_url("IMG_1398"),
                    "ortho_dims": dims.get("IMG_1398", {}).get("ortho"),
                    "original_dims": dims.get("IMG_1398", {}).get("original"),
                },
                {
                    "id": "IMG_1399",
                    "label": "南外立面",
                    "thumbnail": demo_thumbnail_url("IMG_1399"),
                    "ortho_image": demo_ortho_preview_url("IMG_1399"),
                    "original_image": demo_asset_url(_demo_original_filename("IMG_1399")),
                    "viewport_original_url": demo_viewport_original_url("IMG_1399"),
                    "viewport_ortho_url": demo_viewport_ortho_url("IMG_1399"),
                    "ortho_dims": dims.get("IMG_1399", {}).get("ortho"),
                    "original_dims": dims.get("IMG_1399", {}).get("original"),
                },
            ],
            # Shared building-level metadata used by the UI.
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
        }
    ]


@app.post("/api/analyze_demo")
async def analyze_demo(_request: Request, case_id: str = Form(...)) -> Dict[str, Any]:
    """Analyze a bundled demo case and return the computed results (local-only)."""
    demo_data_dir = DEMO_DATA_DIR
    if not demo_data_dir.exists():
        raise HTTPException(
            status_code=500,
            detail=f"DEMO_DATA_DIR not found on disk: {demo_data_dir}",
        )

    json_path = demo_data_dir / f"{case_id}_ortho.json"
    img_path = demo_data_dir / f"{case_id}_ortho.jpg"

    if not json_path.exists():
        raise HTTPException(status_code=404, detail=f"Demo JSON not found: {json_path.name}")
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Demo image not found: {img_path.name}")

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse {json_path.name}: {e}") from e

    bounding_boxes: List[List[Any]] = []
    mask_polygons: List[Dict[str, Any]] = []
    counts = {"window": 0, "ac": 0, "door": 0, "other": 0}

    for shape in data.get("shapes", []):
        label = str(shape.get("label", "unknown"))
        points = shape.get("points", [])
        mask_polygons.append(
            {
                "label": label,
                "points": points,
                "shape_type": shape.get("shape_type", "polygon"),
            }
        )

        pts = np.array(points)
        if pts.size == 0:
            continue
        x_min, y_min = pts.min(axis=0)
        x_max, y_max = pts.max(axis=0)
        w, h = x_max - x_min, y_max - y_min
        bounding_boxes.append([label, int(x_min), int(y_min), int(w), int(h)])

        if "window" in label:
            counts["window"] += 1
        elif "ac" in label:
            counts["ac"] += 1
        elif "door" in label:
            counts["door"] += 1
        else:
            counts["other"] += 1

    with Image.open(img_path) as img:
        image_dims = img.size

    risk_report = semantic_analyzer.analyze(bounding_boxes, image_dims)

    return {
        "status": "success",
        "risk_report": risk_report,
        "counts": counts,
        "masks": mask_polygons,
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


@app.get("/floor_plan.html")
async def floor_plan_html() -> Response:
    """Serve the legacy floorplan HTML from `public/` if present."""
    candidate = PUBLIC_DIR / "floor_plan.html"
    if candidate.exists():
        return FileResponse(str(candidate))
    raise HTTPException(status_code=404, detail="floor_plan.html not found")


@app.get("/")
async def root() -> Response:
    """Serve the frontend entrypoint (React build if present, else legacy HTML)."""
    built_index = FRONTEND_DIST_DIR / "index.html"
    if built_index.exists():
        return FileResponse(str(built_index))

    legacy_index = PUBLIC_DIR / "index.html"
    if legacy_index.exists():
        return FileResponse(str(legacy_index))

    return HTMLResponse(
        "<!doctype html><html><body><h3>Frontend not built.</h3><p>Run: cd frontend && npm install && npm run build</p></body></html>"
    )


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str) -> Response:
    """Serve frontend static files and SPA fallback to index.html.

    This makes React Router (or direct URL access) work when deployed behind a
    single FastAPI process.
    """
    if full_path.startswith("api/") or full_path.startswith("demo_data/"):
        raise HTTPException(status_code=404, detail="Not found")

    built_index = FRONTEND_DIST_DIR / "index.html"
    if not built_index.exists():
        legacy = PUBLIC_DIR / full_path
        if legacy.is_file():
            return FileResponse(str(legacy))
        return await root()

    candidate = _safe_resolve_under(FRONTEND_DIST_DIR, full_path)
    if candidate.is_file():
        return FileResponse(str(candidate))
    return FileResponse(str(built_index))

