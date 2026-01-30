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
cd backend
python3 main.py
```

Server will start on http://localhost:8000

### 4. Use the Web Interface

1. Open http://localhost:8000 in your browser
2. Click "Upload Image" and select a building facade image
3. Click "Run Analysis"
4. View the risk assessment results and download the generated DXF file

## Project Structure

```
NewDemoFacade/
├── backend/
│   ├── core/
│   │   ├── image_processor.py    # Image processing and mock segmentation
│   │   ├── semantic_analyzer.py  # Risk assessment logic
│   │   └── layout_generator.py   # DXF generation
│   ├── main.py                    # FastAPI application
│   ├── static/
│   │   └── index.html            # Dashboard UI
│   ├── uploads/                   # Uploaded images (gitignored)
│   └── test_data/                # Test images
├── test_pipeline.py              # Pipeline verification script
└── requirements.txt              # Python dependencies
```

## API Endpoints

### `POST /analyze`

Upload and analyze a building facade image.

**Request**: multipart/form-data with `file` field

**Response**:
```json
{
  "status": "success",
  "risk_report": {
    "wwr": 0.21,
    "story_count": 3,
    "opening_ratio_gf": 1.13,
    "risk_soft_story": "HIGH",
    "estimated_structure": "Masonry"
  },
  "images": {
    "original": null,
    "processed": "/static/processed_test_building.jpg"
  },
  "cad": {
    "dxf_url": "/static/layout_test_building.dxf"
  },
  "debug": {
    "boxes_count": 13,
    "image_dims": [1024, 1365]
  }
}
```

### `GET /static/{filename}`

Access generated files (processed images, DXF files)

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
