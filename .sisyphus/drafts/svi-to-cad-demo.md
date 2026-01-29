# Draft: SVI-to-CAD & Risk Assessment Demo Initialization

## Requirements (Initial)
- Input: Building facade image.
- Pipeline: Rectification -> Segmentation (YOLOv8) -> Logic -> Vectorization.
- Output: RiskReport.json, Layout.dxf.
- Tech Stack: Python, OpenCV, YOLOv8, ezdxf, NumPy/Pandas.
- Structure: `main.py` with classes `ImageProcessor`, `SemanticAnalyzer`, `LayoutGenerator`, `DxfExporter`.
- Mock Mode: Required for segmentation if no model available.
- UI: `Dashboard.html` integrated with a backend (FastAPI/Flask).

## Open Questions
- Backend Framework: FastAPI or Flask? (Prompt mentioned both)
- Project Structure: Single directory or modular?
- Dependency Management: venv + requirements.txt?
- Mock Mode Details: Random data or fixed template?
- Logic Details: What specific "Logic" transforms segmentation to vectorization?
