# SVI-to-CAD & Risk Assessment Demo Initialization Plan

## TL;DR

> **Quick Summary**: Initialize a FastAPI-based "SVI-to-CAD" demo project. The system takes a facade image, processes it (Rectification -> YOLOv8 Segmentation -> Logic), and outputs a Risk Report (JSON) and CAD Layout (DXF). Includes a "Mock Mode" for segmentation and integrates the existing `Dashboard.html`.
>
> **Deliverables**:
> - Fully structured Python project with `FastAPI` backend.
> - Core Logic Modules: `ImageProcessor`, `SemanticAnalyzer`, `LayoutGenerator`, `DxfExporter`.
> - Integrated Frontend: `Dashboard.html` served via static files/templates.
> - Working "Mock Mode" for logic verification without model weights.
> - Sample execution script and tests.
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 Waves
> **Critical Path**: Core Logic -> API Integration -> Frontend Verification

---

## Context

### Original Request
Initialize 'SVI-to-CAD & Risk Assessment Demo' using `infor.md` (logic) and `Dashboard.html` (UI).
- Tech: Python, OpenCV, YOLOv8, ezdxf, FastAPI.
- Logic: Rectification -> Segmentation -> Risk/Layout -> DXF.
- Special Requirement: "Mock Mode" for segmentation.

### Metis Review (Self-Correction)
**Identified Gaps & Decisions**:
- **Framework**: Selected **FastAPI** over Flask (modern, better type safety, async support).
- **Structure**: Modular design (`app/core`, `app/api`, `static`) rather than a single `main.py` script, ensuring scalability.
- **Mock Mode**: Explicitly planned as a fallback within `ImageProcessor` to return hardcoded/randomized bounding boxes if the model is missing.
- **Frontend**: `Dashboard.html` will be moved to `app/static` or served as a template. API endpoints will match the dashboard's expected data format.

---

## Work Objectives

### Core Objective
Build a functional MVP that ingests an image and produces analysis results (JSON + DXF) using a modular Python architecture.

### Concrete Deliverables
- Project Structure (`app/`, `tests/`, `requirements.txt`)
- Core Logic Implementation (`app/core/*.py`)
- API Implementation (`app/main.py`)
- Frontend Integration (served at `/`)
- Verification Script (`demo.py`)

### Definition of Done
- [ ] `uvicorn app.main:app --reload` starts without errors.
- [ ] `Dashboard.html` loads at `http://localhost:8000`.
- [ ] Uploading an image triggers the pipeline and returns JSON data.
- [ ] "Mock Mode" works: pipeline runs successfully without actual YOLO weights.
- [ ] DXF file is generated and saved.

### Must Have
- **Mock Mode**: Essential for immediate testing.
- **FastAPI**: For the backend.
- **Type Hints**: strict Python typing.

### Must NOT Have
- Complex DB setup (keep it stateless for now).
- Full Model Training (inference only).

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO (New Project)
- **User wants tests**: YES (Implicit in "Testing/Verification")
- **Framework**: `pytest`
- **Approach**: TDD (Red-Green-Refactor) for core logic.

### Automated Verification (Agent-Executable)

**Backend/API**:
```bash
# Agent runs:
curl -X POST "http://localhost:8000/api/analyze" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@test_image.jpg"
# Assert: HTTP 200
# Assert: JSON contains "risk_report" and "layout_dxf" keys
```

**Core Logic**:
```bash
# Agent runs:
pytest tests/test_core.py
# Assert: All tests pass
```

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation & Core):
├── Task 1: Project Skeleton & Dependency Setup (Standard)
├── Task 2: Core - ImageProcessor & Rectification (Logic)
├── Task 3: Core - SemanticAnalyzer (Logic)
└── Task 4: Core - LayoutGenerator & DxfExporter (Logic)

Wave 2 (Integration & UI):
├── Task 5: API Implementation (FastAPI) (Integration)
├── Task 6: Frontend Integration (Dashboard.html) (UI)
└── Task 7: End-to-End Verification (QA)
```

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1 | `delegate_task(category="quick", skills=["python-programmer"], ...)` |
| 1 | 2, 3, 4 | `delegate_task(category="ultrabrain", skills=["python-programmer"], ...)` |
| 2 | 5, 6 | `delegate_task(category="visual-engineering", skills=["frontend-ui-ux"], ...)` |
| 2 | 7 | `delegate_task(category="quick", skills=["playwright"], ...)` |

---

## TODOs

### Wave 1: Foundation & Core Logic

- [ ] 1. Project Skeleton & Dependencies
  **What to do**:
  - Create directory structure: `app/core`, `app/api`, `app/static`, `tests`, `data`.
  - Create `requirements.txt`: `fastapi`, `uvicorn`, `python-multipart`, `opencv-python-headless`, `ultralytics`, `ezdxf`, `numpy`, `pandas`, `pytest`.
  - Create `pyproject.toml` or `pytest.ini`.
  - Create `app/__init__.py`.
  
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`python-programmer`]

  **Verification**:
  ```bash
  pip install -r requirements.txt && python -c "import cv2, ultralytics, ezdxf, fastapi"
  # Expected: No errors
  ```

- [ ] 2. Core - ImageProcessor & Rectification
  **What to do**:
  - Create `app/core/image_processor.py`.
  - Class `ImageProcessor`:
    - `__init__(mock_mode=True)`
    - `load_image(path/bytes)`: Reads image using cv2.
    - `rectify()`: Implements basic rectification (or dummy resize if simplified).
    - `segment()`: 
      - IF `mock_mode`: Returns hardcoded boxes [(x,y,w,h,class_id)].
      - ELSE: Loads YOLOv8 and runs inference.
  
  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
  - **Skills**: [`python-programmer`]
  
  **Verification**:
  ```bash
  pytest tests/test_image_processor.py
  # Expected: Passes mock segmentation test
  ```

- [ ] 3. Core - SemanticAnalyzer
  **What to do**:
  - Create `app/core/analyzer.py`.
  - Class `SemanticAnalyzer`:
    - `calculate_wwr(building_area, window_areas)`
    - `estimate_stories(window_boxes)`
    - `check_soft_story(door_boxes, window_boxes, building_width)`
    - `generate_report()`: Returns dict with all metrics.
  
  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
  - **Skills**: [`python-programmer`]

  **Verification**:
  ```bash
  pytest tests/test_analyzer.py
  # Expected: Passes calculation logic tests
  ```

- [ ] 4. Core - LayoutGenerator & DxfExporter
  **What to do**:
  - Create `app/core/generator.py` & `app/core/exporter.py`.
  - `LayoutGenerator`: Implements "Projection-based Heuristics" from `infor.md`.
    - Generates: Walls, Grid lines, Doors.
  - `DxfExporter`: Uses `ezdxf` to draw the layout.
    - Layers: WALL (White), WINDOW (Cyan), ANNOTATION (Yellow).
  
  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
  - **Skills**: [`python-programmer`]

  **Verification**:
  ```bash
  python -c "from app.core.exporter import DxfExporter; DxfExporter().export([], 'test.dxf'); import os; print(os.path.exists('test.dxf'))"
  # Expected: True
  ```

### Wave 2: Integration & Frontend

- [ ] 5. API Implementation (FastAPI)
  **What to do**:
  - Create `app/main.py`.
  - Endpoint: `POST /api/analyze`
    - Accepts file upload.
    - Orchestrates: ImageProcessor -> SemanticAnalyzer -> LayoutGenerator -> DxfExporter.
    - Returns: JSON report + link to download DXF.
  - Endpoint: `GET /api/download/{filename}`: Serves generated DXF.
  
  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`python-programmer`]

  **Verification**:
  ```bash
  curl -X POST http://localhost:8000/api/analyze ...
  # Expected: JSON response
  ```

- [ ] 6. Frontend Integration
  **What to do**:
  - Move `Dashboard.html` to `app/static/index.html`.
  - Configure FastAPI to serve static files (`StaticFiles`).
  - **Edit** `Dashboard.html` (if needed) to fetch data from `/api/analyze` instead of using mock JS data (or set up the wiring). *Note: For MVP, ensuring it loads is step 1. Wiring is step 2.*
  
  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`]

  **Verification**:
  ```bash
  curl http://localhost:8000/
  # Expected: HTML content
  ```

- [ ] 7. End-to-End Verification
  **What to do**:
  - Create `demo.py` script that runs the full pipeline locally (CLI mode).
  - Run the server and test via browser.
  
  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`playwright`]

  **Verification**:
  ```bash
  python demo.py --input sample.jpg
  # Expected: "Analysis Complete. Report: ... Saved: result.dxf"
  ```

---

## Success Criteria

- [ ] Server runs on port 8000.
- [ ] Mock mode allows running without GPU/Model.
- [ ] DXF file is readable by standard CAD viewers (or ezdxf check).
- [ ] Risk Report JSON matches expected schema.
