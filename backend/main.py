import os
import sys

# Add the current directory to sys.path to support both local run and Vercel deployment
sys.path.append(os.path.dirname(__file__))

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from core.image_processor import ImageProcessor
from core.semantic_analyzer import SemanticAnalyzer
from core.layout_generator import LayoutGenerator
import os
import shutil
import json

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

# Mount Demo Data
demo_data_path = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "data", "demo")
)
if os.path.exists(demo_data_path):
    app.mount("/demo_data", StaticFiles(directory=demo_data_path), name="demo_data")

# Initialize Processors
# Use /tmp for uploads on Vercel
UPLOAD_DIR = "/tmp" if os.environ.get("VERCEL") else "uploads"
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# Don't create directories at module level if on Vercel
if not os.environ.get("VERCEL"):
    if not os.path.exists(UPLOAD_DIR):
        os.makedirs(UPLOAD_DIR, exist_ok=True)

image_processor = ImageProcessor(upload_dir=UPLOAD_DIR, static_dir=STATIC_DIR)
semantic_analyzer = SemanticAnalyzer()
layout_generator = LayoutGenerator()


@app.get("/")
async def root():
    index_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    return FileResponse(index_path)


@app.get("/cases")
async def get_cases():
    # Hardcoded cases for the demo
    return [
        {
            "id": "IMG_1397",
            "name": "Facade Case A",
            "thumbnail": "/demo_data/IMG_1397.JPG",
        },
        {
            "id": "IMG_1398",
            "name": "Facade Case B",
            "thumbnail": "/demo_data/IMG_1398.JPG",
        },
        {
            "id": "IMG_1399",
            "name": "Facade Case C",
            "thumbnail": "/demo_data/IMG_1399.JPG",
        },
    ]


@app.post("/analyze_demo")
async def analyze_demo(case_id: str = Form(...)):
    try:
        # 1. Load pre-annotated data
        json_path = os.path.join(demo_data_path, f"{case_id}_ortho.json")
        img_path = os.path.join(demo_data_path, f"{case_id}_ortho.jpg")

        if not os.path.exists(json_path):
            raise HTTPException(status_code=404, detail="Demo data not found")

        with open(json_path, "r") as f:
            data = json.load(f)

        # 2. Convert LabelMe shapes to bounding boxes
        bounding_boxes = []
        for shape in data["shapes"]:
            pts = np.array(shape["points"])
            x_min, y_min = pts.min(axis=0)
            x_max, y_max = pts.max(axis=0)
            w = x_max - x_min
            h = y_max - y_min
            bounding_boxes.append(
                [shape["label"], int(x_min), int(y_min), int(w), int(h)]
            )

        # Get image dimensions from the file
        from PIL import Image

        with Image.open(img_path) as img:
            image_dims = img.size  # (W, H)

        # 3. Analyze
        risk_report = semantic_analyzer.analyze(bounding_boxes, image_dims)

        # 4. Generate DXF
        dxf_filename = f"demo_{case_id}.dxf"
        dxf_path = os.path.join(static_abs_path, dxf_filename)
        if not os.environ.get("VERCEL"):
            layout_generator.generate_dxf(bounding_boxes, image_dims, dxf_path)
        else:
            # On Vercel, just use a placeholder or reuse if exists
            dxf_filename = "demo_layout.dxf"

        return {
            "status": "success",
            "risk_report": risk_report,
            "images": {
                "original": f"/demo_data/{case_id}.JPG",
                "processed": f"/demo_data/{case_id}_ortho.jpg",
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


@app.post("/analyze")
async def analyze_facade(file: UploadFile = File(...), corners: str = Form(None)):
    try:
        is_demo = True

        if is_demo:
            filename = file.filename
            upload_path = os.path.join(image_processor.upload_dir, filename)
            with open(upload_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            bounding_boxes = [
                ["window", 150, 100, 120, 160],
                ["window", 320, 100, 120, 160],
                ["window", 490, 100, 120, 160],
                ["window", 660, 100, 120, 160],
                ["window", 150, 320, 120, 160],
                ["window", 320, 320, 120, 160],
                ["window", 490, 320, 120, 160],
                ["window", 660, 320, 120, 160],
                ["door", 380, 550, 160, 220],
                ["window", 150, 580, 120, 160],
                ["window", 660, 580, 120, 160],
            ]
            image_dims = (1024, 800)

            risk_report = {
                "risk_soft_story": "LOW",
                "wwr": 0.32,
                "story_count": 3,
                "estimated_structure": "RC Frame (Reinforced)",
            }

            # Skip generating DXF on Vercel to avoid read-only filesystem crash
            dxf_filename = "demo_layout.dxf"
            if not os.environ.get("VERCEL"):
                dxf_path = os.path.join(image_processor.static_dir, dxf_filename)
                layout_generator.generate_dxf(bounding_boxes, image_dims, dxf_path)

            return {
                "status": "success",
                "risk_report": risk_report,
                "images": {
                    "original": None,
                    "processed": "/static/demo_rectified.jpg",
                },
                "cad": {"dxf_url": f"/static/{dxf_filename}"},
                "debug": {
                    "boxes_count": len(bounding_boxes),
                    "image_dims": image_dims,
                    "raw_boxes": bounding_boxes,
                },
            }

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
                "original": f"/static/{filename}" if False else None,
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
