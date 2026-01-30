import os
import sys
import json
import shutil
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Add the current directory to sys.path to support both local run and Vercel deployment
sys.path.append(os.path.dirname(__file__))

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

# Static Files
static_abs_path = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_abs_path), name="static")

# Initialize Processors
UPLOAD_DIR = (
    "/tmp"
    if os.environ.get("VERCEL")
    else os.path.join(os.path.dirname(__file__), "uploads")
)
STATIC_DIR = static_abs_path

if not os.environ.get("VERCEL") and not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR, exist_ok=True)

image_processor = ImageProcessor(upload_dir=UPLOAD_DIR, static_dir=STATIC_DIR)
semantic_analyzer = SemanticAnalyzer()
layout_generator = LayoutGenerator()


@app.get("/")
async def root():
    return FileResponse(os.path.join(static_abs_path, "index.html"))


@app.get("/cases")
async def get_cases():
    # Hardcoded rich metadata for the 4-step demo
    return [
        {
            "id": "IMG_1397",
            "name": "Commercial Office A",
            "thumbnail": "/static/demo_data/IMG_1397.JPG",
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
            "thumbnail": "/static/demo_data/IMG_1398.JPG",
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
            "thumbnail": "/static/demo_data/IMG_1399.JPG",
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
async def analyze_demo(case_id: str = Form(...)):
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
            w = x_max - x_min
            h = y_max - y_min
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
                "original": f"/static/demo_data/{case_id}.JPG",
                "processed": f"/static/demo_data/{case_id}_ortho.jpg",
            },
            "debug": {
                "boxes_count": len(bounding_boxes),
                "image_dims": image_dims,
                "raw_boxes": bounding_boxes,
            },
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze")
async def analyze_facade(file: UploadFile = File(...), corners: str = Form(None)):
    try:
        parsed_corners = None
        if corners:
            parsed_corners = json.loads(corners)

        filename = file.filename
        upload_path = os.path.join(image_processor.upload_dir, filename)
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        processed_path, bounding_boxes, image_dims = image_processor.process(
            upload_path, corners=parsed_corners
        )

        # 3. Analyze Semantics (Risk Assessment)
        risk_report = semantic_analyzer.analyze(bounding_boxes, image_dims)

        # 4. Generate CAD Layout
        dxf_filename = f"layout_{os.path.splitext(filename)[0]}.dxf"
        dxf_path = os.path.join(image_processor.static_dir, dxf_filename)
        layout_generator.generate_dxf(bounding_boxes, image_dims, dxf_path)

        # 5. Construct Response
        return {
            "status": "success",
            "risk_report": risk_report,
            "images": {
                "original": None,
                "processed": f"/static/{os.path.basename(processed_path)}",
            },
            "cad": {"dxf_url": f"/static/{dxf_filename}"},
            "debug": {
                "boxes_count": len(bounding_boxes),
                "image_dims": image_dims,
                "raw_boxes": bounding_boxes,
            },
        }
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
