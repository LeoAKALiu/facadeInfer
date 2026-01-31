import os
import sys
import json
import numpy as np
from typing import Any
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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


@app.get("/cases")
async def get_cases() -> list[dict[str, Any]]:
    """Return the curated demo cases shown in the UI."""
    return [
        {
            "id": "IMG_1397",
            "name": "Commercial Office A",
            "thumbnail": "/demo_data/IMG_1397.JPG",
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
            "thumbnail": "/demo_data/IMG_1398.JPG",
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
            "thumbnail": "/demo_data/IMG_1399.JPG",
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
async def analyze_demo(case_id: str = Form(...)) -> dict[str, Any]:
    """Analyze a bundled demo case and return the computed results."""
    try:
        demo_data_dir = os.path.join(static_abs_path, "demo_data")
        json_path = os.path.join(demo_data_dir, f"{case_id}_ortho.json")
        img_path = os.path.join(demo_data_dir, f"{case_id}_ortho.jpg")

        if not os.path.exists(json_path):
            raise HTTPException(status_code=404, detail="Demo data not found")

        with open(json_path, "r") as f:
            data = json.load(f)

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

        with Image.open(img_path) as img:
            image_dims = img.size

        risk_report = semantic_analyzer.analyze(bounding_boxes, image_dims)

        return {
            "status": "success",
            "risk_report": risk_report,
            "counts": counts,
            "images": {
                # The `public/` directory is served at `/` in production.
                "original": f"{DEMO_DATA_URL_PREFIX}/{case_id}.JPG",
                "processed": f"{DEMO_DATA_URL_PREFIX}/{case_id}_ortho.jpg",
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
