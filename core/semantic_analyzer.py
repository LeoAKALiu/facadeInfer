import numpy as np


class SemanticAnalyzer:
    def analyze(self, bounding_boxes, image_dims):
        """
        Analyzes bounding boxes to determine risk factors.
        Args:
            bounding_boxes: List of (label, x, y, w, h)
            image_dims: (width, height)
        Returns:
            dict: Risk report
        """
        img_w, img_h = image_dims

        windows = [b for b in bounding_boxes if b[0] == "window"]
        doors = [b for b in bounding_boxes if b[0] == "door"]

        # 1. Window-to-Wall Ratio (WWR)
        total_window_area = sum([b[3] * b[4] for b in windows])
        total_wall_area = img_w * img_h  # Simplified: Image area as facade area
        wwr = total_window_area / total_wall_area if total_wall_area > 0 else 0

        # 2. Estimate Stories (Y-clustering)
        if not windows:
            story_count = 1
        else:
            y_centers = [b[2] + b[4] / 2 for b in windows]
            # Simple histogram approach
            hist, bin_edges = np.histogram(y_centers, bins=10)
            # peaks = number of bins with significant count?
            # Better: KMeans or simply check gaps.
            # Simple heuristic: Split image into N strips, see which have windows.
            # Even simpler: Just hardcode based on mock data logic or count distinct clusters
            # Let's use a crude cluster count: Sort Ys, if diff > threshold, new story
            y_centers.sort()
            clusters = 0
            if y_centers:
                clusters = 1
                last_y = y_centers[0]
                threshold = img_h / 10  # heuristic threshold
                for y in y_centers[1:]:
                    if (y - last_y) > threshold:
                        clusters += 1
                        last_y = y
            story_count = max(1, clusters)

        # 3. Soft Story Risk (Ground Floor Openings)
        ground_floor_threshold = img_h - (img_h / story_count)  # Approx bottom floor

        gf_openings_width = 0

        for b in windows + doors:
            bx, by, bw, bh = b[1:]
            by_center = by + bh / 2
            if by_center > ground_floor_threshold:
                gf_openings_width += bw

        # Approx building width (from boxes)
        all_x = [b[1] for b in windows + doors]
        all_xw = [b[1] + b[3] for b in windows + doors]
        if all_x:
            min_x = min(all_x)
            max_x = max(all_xw)
            building_width = max_x - min_x
        else:
            building_width = img_w

        opening_ratio = gf_openings_width / building_width if building_width > 0 else 0
        soft_story_risk = opening_ratio > 0.6

        return {
            "wwr": round(wwr, 2),
            "story_count": story_count,
            "opening_ratio_gf": round(opening_ratio, 2),
            "risk_soft_story": "HIGH" if soft_story_risk else "LOW",
            "estimated_structure": "Masonry"
            if story_count < 6 and wwr < 0.3
            else "RC Frame",
        }
