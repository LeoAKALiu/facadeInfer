# SVI-to-CAD & Risk Assessment Demo

A FastAPI-based system that converts street view facade images into CAD layouts and performs structural risk assessment.

## Features

- **Image Processing**: Automatic facade rectification and element detection
- **Semantic Analysis**: Window-to-wall ratio (WWR), story counting, soft-story risk assessment
- **CAD Generation**: Automatic DXF layout generation with walls, windows, and doors
- **Mock Mode**: Built-in mock data mode for testing without YOLO model weights
- **Web Interface**: Interactive dashboard for image upload and result visualization

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Test the Pipeline

```bash
python3 test_pipeline.py
```

Expected output: All tests pass with mock data

### 3. Start the Server

```bash
python3 run_server.py
```

Server will start on http://localhost:8000 (or `http://<YOUR_PUBLIC_IP>:8000` on a server)

### 4. Build & Serve the Modern Frontend (React + Vite + TypeScript)

For production (single-process deployment via FastAPI):

```bash
cd frontend
npm install
npm run build
cd ..
python3 run_server.py
```

Then open `http://localhost:8000` (or `http://<YOUR_PUBLIC_IP>:8000`).

For local development (hot reload):

```bash
# Terminal A
python3 run_server.py

# Terminal B
cd frontend
npm install
npm run dev
```

Vite will run on `http://localhost:5173` and proxy `/api/*` and `/demo_data/*` to the backend.

## Project Structure

```
NewDemoFacade/
├── api/
│   └── index.py                  # FastAPI app (serves /api/* + frontend + /demo_data/*)
├── core/                         # Image processing + semantic analysis logic
├── public/
│   └── demo_data/                # Local demo assets (images + *_ortho.json)
├── frontend/                     # React + Vite + TypeScript frontend
│   ├── src/
│   └── dist/                     # Build output (served by FastAPI) [generated]
├── test_pipeline.py              # Pipeline verification script
├── run_server.py                 # Start FastAPI server on 0.0.0.0:8000
└── requirements.txt              # Python dependencies
```

## API Endpoints

### `GET /api/cases`

Return the curated demo cases shown in the UI.

### `POST /api/analyze_demo`

Analyze a bundled demo case from local `public/demo_data/`.

**Request**: multipart/form-data with `case_id` field

**Response**:
```json
{
  "status": "success",
  "risk_report": {},
  "counts": { "window": 0, "ac": 0, "door": 0, "other": 0 },
  "masks": [],
  "images": { "original": "/demo_data/CASE.JPG", "processed": "/demo_data/CASE_ortho.jpg" },
  "debug": { "boxes_count": 0, "image_dims": [0, 0], "raw_boxes": [] }
}
```

### `GET /demo_data/{filename}`

Access local demo assets (images and JSON annotations)

## Mock Mode

The system runs in mock mode by default, generating synthetic bounding boxes without requiring YOLO model weights. This allows immediate testing and demonstration.

Mock data includes:
- 1 building outline
- 12 windows (3 stories × 4 windows)
- 1 door

## Risk Assessment Logic

- **Window-to-Wall Ratio (WWR)**: Total window area / Total facade area
- **Story Count**: Clustering windows by Y-axis position
- **Soft Story Risk**: Ground floor opening ratio > 60%
- **Structure Type**: Inferred from WWR and story count

## CAD Output

Generated DXF files include:
- **WALL layer** (white): External walls, internal partitions, corridor
- **WINDOW layer** (cyan): Window elements from facade
- **DOOR layer** (red): Door elements from facade

Scale: 1 pixel = 10mm (configurable in `layout_generator.py`)

## 梁板柱结构构件编辑器（隐藏入口）

用于在 2D 户型图上可视化放置柱、梁、板，并保存到 `floorplan_3d_config.json`，供 BIM 视图展示。

- **默认入口地址**：在站点根 URL 后加查询参数 `?page=editor`，例如  
  `http://localhost:8000/?page=editor` 或 `http://localhost:5173/?page=editor`（开发时）。
- **自定义入口**：可通过环境变量指定查询参数值（需在构建前端时生效）：  
  `VITE_STRUCTURAL_EDITOR_PAGE=自定义值`  
  则入口为 `?page=自定义值`（如 `structural-editor` 则访问 `?page=structural-editor`）。  
  构建示例：`cd frontend && VITE_STRUCTURAL_EDITOR_PAGE=structural-editor npm run build`

该页面不在主导航中显示，仅通过上述 URL 直接访问。

## Development

### Run Tests

```bash
python3 test_pipeline.py
```

### Check Diagnostics

```bash
ruff check backend/
```

## Future Enhancements

- [ ] Integration with trained YOLOv8 segmentation model
- [ ] Advanced perspective correction using vanishing points
- [ ] 3D model generation
- [ ] Multi-facade analysis
- [ ] Database storage for analysis history
