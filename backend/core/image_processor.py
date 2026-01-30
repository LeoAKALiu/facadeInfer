try:
    import cv2
except ImportError:
    cv2 = None
import os
import logging
import numpy as np
from PIL import Image, ImageOps


class ImageProcessor:
    def __init__(self, upload_dir="backend/uploads", static_dir="backend/static"):
        self.upload_dir = upload_dir
        self.static_dir = static_dir

        # Only create directories if not on Vercel
        if not os.environ.get("VERCEL"):
            os.makedirs(self.upload_dir, exist_ok=True)
            os.makedirs(self.static_dir, exist_ok=True)

        self.logger = logging.getLogger(__name__)

        self.feature_extractor = None
        self.model = None
        self.device = None
        self.label_map = {3: "window", 4: "door", 7: "balcony", 12: "shop"}

    def _init_model(self):
        if self.model is not None:
            return
        try:
            import torch
            from transformers import (
                SegformerImageProcessor,
                SegformerForSemanticSegmentation,
            )

            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model_name = "Xpitfire/segformer-finetuned-segments-cmp-facade"
            self.token = os.getenv("HF_TOKEN")

            self.logger.info(f"Loading model {self.model_name} on {self.device}...")
            self.feature_extractor = SegformerImageProcessor.from_pretrained(
                self.model_name, token=self.token
            )
            self.model = SegformerForSemanticSegmentation.from_pretrained(
                self.model_name, token=self.token
            )
            self.model.to(self.device)
            self.model.eval()
        except ImportError:
            self.logger.warning(
                "Heavy AI dependencies not found. AI processing will be disabled."
            )

    def process(self, image_path: str, corners: list = None):
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        if cv2 is None or os.environ.get("VERCEL"):
            # Return demo data if on Vercel or no OpenCV
            return "static/demo_rectified.jpg", [], (1024, 800)

        pil_img = Image.open(image_path).convert("RGB")
        pil_img = ImageOps.exif_transpose(pil_img)
        img_np = np.array(pil_img)

        # 1. Perspective Rectification if corners provided
        if corners and len(corners) >= 3:
            src_pts = np.array(corners, dtype="float32")
            s = src_pts.sum(axis=1)
            diff = np.diff(src_pts, axis=1)
            tl = src_pts[np.argmin(s)]
            br = src_pts[np.argmax(s)]
            tr = src_pts[np.argmin(diff)]
            bl = src_pts[np.argmax(diff)]

            rect_src = np.array([tl, tr, br, bl], dtype="float32")
            width = 1024
            side_w1 = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
            side_w2 = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
            max_width = max(int(side_w1), int(side_w2), 1)
            side_h1 = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
            side_h2 = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
            max_height = max(int(side_h1), int(side_h2), 1)

            aspect_ratio = max_height / max_width
            target_height = int(width * aspect_ratio)

            dst_pts = np.array(
                [
                    [0, 0],
                    [width - 1, 0],
                    [width - 1, target_height - 1],
                    [0, target_height - 1],
                ],
                dtype="float32",
            )
            M = cv2.getPerspectiveTransform(rect_src, dst_pts)
            warped = cv2.warpPerspective(img_np, M, (width, target_height))

            if len(corners) > 4:
                mask = np.zeros((target_height, width), dtype=np.uint8)
                warped_poly = cv2.perspectiveTransform(src_pts.reshape(-1, 1, 2), M)
                cv2.fillPoly(mask, [warped_poly.astype(np.int32)], 255)
                warped = cv2.bitwise_and(warped, warped, mask=mask)

            pil_img = Image.fromarray(warped)
            target_width = width
        else:
            target_width = 1024
            orig_w, orig_h = pil_img.size
            scale = target_width / orig_w
            target_height = int(orig_h * scale)
            pil_img = pil_img.resize(
                (target_width, target_height), Image.Resampling.LANCZOS
            )

        img_cv2 = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
        processed_filename = f"processed_{os.path.basename(image_path)}"
        processed_path = os.path.join(self.static_dir, processed_filename)
        cv2.imwrite(processed_path, img_cv2)

        boxes = []
        return processed_path, boxes, (target_width, target_height)

    def _split_vertically(self, mask, x, y, m_w, m_h):
        if m_h < 50:
            return [(x, y, m_w, m_h)]
        sub_mask = mask[y : y + m_h, x : x + m_w]
        proj = np.sum(sub_mask, axis=1)
        threshold = np.max(proj) * 0.4
        is_object = proj > threshold
        segments = []
        start = None
        for i in range(len(is_object)):
            if is_object[i] and start is None:
                start = i
            elif not is_object[i] and start is not None:
                if (i - start) > 10:
                    segments.append((start, i - start))
                start = None
        if start is not None and (m_h - start) > 10:
            segments.append((start, m_h - start))
        if len(segments) > 1:
            results = []
            for s_y, s_h in segments:
                results.extend(self._split_horizontally(mask, x, y + s_y, m_w, s_h))
            return results
        return self._split_horizontally(mask, x, y, m_w, m_h)

    def _split_horizontally(self, mask, x, y, m_w, m_h):
        if m_w < 50:
            return [(x, y, m_w, m_h)]
        sub_mask = mask[y : y + m_h, x : x + m_w]
        proj = np.sum(sub_mask, axis=0)
        threshold = np.max(proj) * 0.4
        is_object = proj > threshold
        segments = []
        start = None
        for i in range(len(is_object)):
            if is_object[i] and start is None:
                start = i
            elif not is_object[i] and start is not None:
                if (i - start) > 10:
                    segments.append((start, i - start))
                start = None
        if start is not None and (m_w - start) > 10:
            segments.append((start, m_w - start))
        if len(segments) > 1:
            return [(x + s_x, y, s_w, m_h) for s_x, s_w in segments]
        return [(x, y, m_w, m_h)]
