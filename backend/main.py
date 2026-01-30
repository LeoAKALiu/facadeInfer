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
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize Processors
# Use /tmp for uploads on Vercel
UPLOAD_DIR = "/tmp" if os.environ.get("VERCEL") else "uploads"
STATIC_DIR = "static"

if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR, exist_ok=True)

image_processor = ImageProcessor(upload_dir=UPLOAD_DIR, static_dir=STATIC_DIR)
semantic_analyzer = SemanticAnalyzer()
layout_generator = LayoutGenerator()


@app.get("/")
async def root():
    return FileResponse("static/index.html")


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

            dxf_filename = f"demo_layout_{os.path.splitext(filename)[0]}.dxf"
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
