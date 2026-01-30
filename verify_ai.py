import os
import logging
from backend.core.image_processor import ImageProcessor

logging.basicConfig(level=logging.INFO)

def test_ai_integration():
    processor = ImageProcessor()
    test_image = "backend/test_data/test_building.jpg"
    
    if not os.path.exists(test_image):
        print(f"Test image not found at {test_image}")
        return

    print(f"Processing {test_image} with SegFormer...")
    processed_path, boxes, dims = processor.process(test_image)
    
    print(f"Processed image saved at: {processed_path}")
    print(f"Image dimensions: {dims}")
    print(f"Detected {len(boxes)} elements:")
    for label, x, y, w, h in boxes[:10]:
        print(f"  - {label}: [{x}, {y}, {w}, {h}]")
    if len(boxes) > 10:
        print(f"  ... and {len(boxes) - 10} more.")

if __name__ == "__main__":
    test_ai_integration()
