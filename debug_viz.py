import cv2
import os
import numpy as np
from backend.core.image_processor import ImageProcessor

def debug_viz():
    processor = ImageProcessor()
    test_image = "backend/uploads/IMG_1397.JPG"
    
    if not os.path.exists(test_image):
        print(f"Test image not found at {test_image}")
        return

    print(f"Processing {test_image} and drawing boxes...")
    processed_path, boxes, dims = processor.process(test_image)
    
    # Load the processed image (which is 1024 wide)
    img = cv2.imread(processed_path)
    
    for label, x, y, w, h in boxes:
        color = (0, 255, 0) if label == "window" else (0, 0, 255)
        cv2.rectangle(img, (x, y), (x + w, y + h), color, 2)
        cv2.putText(img, label, (x, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

    debug_output = "backend/static/debug_boxes.jpg"
    cv2.imwrite(debug_output, img)
    print(f"Debug image saved to {debug_output}")

if __name__ == "__main__":
    debug_viz()
