#!/usr/bin/env python3
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from backend.core.image_processor import ImageProcessor
from backend.core.semantic_analyzer import SemanticAnalyzer
from backend.core.layout_generator import LayoutGenerator
import json


def test_pipeline():
    print("=" * 60)
    print("SVI-to-CAD Pipeline Test")
    print("=" * 60)

    test_image = "backend/test_data/test_building.jpg"

    if not os.path.exists(test_image):
        print(f"❌ Test image not found: {test_image}")
        return False

    print(f"✓ Test image found: {test_image}")

    print("\n[1/4] Initializing processors...")
    image_processor = ImageProcessor()
    semantic_analyzer = SemanticAnalyzer()
    layout_generator = LayoutGenerator()
    print("✓ All processors initialized (Mock mode: enabled)")

    print("\n[2/4] Processing image...")
    try:
        processed_path, bounding_boxes, image_dims = image_processor.process(test_image)
        print(f"✓ Image processed: {os.path.basename(processed_path)}")
        print(f"  - Dimensions: {image_dims}")
        print(f"  - Detected elements: {len(bounding_boxes)}")

        for label in set([b[0] for b in bounding_boxes]):
            count = sum(1 for b in bounding_boxes if b[0] == label)
            print(f"    • {label}: {count}")
    except Exception as e:
        print(f"❌ Image processing failed: {e}")
        return False

    print("\n[3/4] Running semantic analysis...")
    try:
        risk_report = semantic_analyzer.analyze(bounding_boxes, image_dims)
        print("✓ Risk assessment complete:")
        print(json.dumps(risk_report, indent=2))
    except Exception as e:
        print(f"❌ Semantic analysis failed: {e}")
        return False

    print("\n[4/4] Generating CAD layout...")
    dxf_path = "backend/static/test_layout.dxf"
    try:
        layout_generator.generate_dxf(bounding_boxes, image_dims, dxf_path)
        if os.path.exists(dxf_path):
            size_kb = os.path.getsize(dxf_path) / 1024
            print(f"✓ DXF file generated: {dxf_path}")
            print(f"  - File size: {size_kb:.2f} KB")
        else:
            print(f"❌ DXF file not created")
            return False
    except Exception as e:
        print(f"❌ CAD generation failed: {e}")
        import traceback

        traceback.print_exc()
        return False

    print("\n" + "=" * 60)
    print("✅ ALL TESTS PASSED")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Start server: python3 backend/main.py")
    print("2. Open browser: http://localhost:8000")
    print("3. Upload an image and click 'Run Analysis'")
    return True


if __name__ == "__main__":
    success = test_pipeline()
    sys.exit(0 if success else 1)
