import cv2
import numpy as np
import os
import json
import argparse
from pathlib import Path


class FacadeOrthoExpert:
    def __init__(self, image_path, output_dir):
        self.image_path = Path(image_path)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.img = cv2.imread(str(self.image_path))
        if self.img is None:
            raise FileNotFoundError(f"无法加载图像: {image_path}")

        self.points = []
        self.labels = ["TOP Edge", "BOTTOM Edge", "LEFT Edge", "RIGHT Edge"]
        self.window_name = "Expert Facade Rectifier"

    def _get_line_intersection(self, line1, line2):
        x1, y1, x2, y2 = line1
        x3, y3, x4, y4 = line2
        denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
        if denom == 0:
            return None
        ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom
        return int(x1 + ua * (x2 - x1)), int(y1 + ua * (y2 - y1))

    def _mouse_callback(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            if len(self.points) < 8:
                self.points.append((x, y))
        elif event == cv2.EVENT_RBUTTONDOWN:
            if self.points:
                self.points.pop()

    def run(self):
        cv2.namedWindow(self.window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(self.window_name, self._mouse_callback)

        print(f"正在处理: {self.image_path.name}")
        print(
            "操作: 依次为 [上、下、左、右] 边缘各点 2 个点。按 'c' 执行，按 'q' 退出。"
        )

        while True:
            display = self.img.copy()
            for i, pt in enumerate(self.points):
                cv2.circle(display, pt, 5, (0, 0, 255), -1)
                if i % 2 == 1:
                    cv2.line(
                        display, self.points[i - 1], self.points[i], (0, 255, 0), 2
                    )

            curr_step = len(self.points) // 2
            msg = (
                f"Task: {self.labels[curr_step]}"
                if curr_step < 4
                else "Ready! Press 'c'"
            )
            cv2.putText(
                display, msg, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2
            )

            cv2.imshow(self.window_name, display)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("c") and len(self.points) == 8:
                break
            elif key == ord("q"):
                return

        top_l, bot_l = (
            (*self.points[0], *self.points[1]),
            (*self.points[2], *self.points[3]),
        )
        lef_l, rig_l = (
            (*self.points[4], *self.points[5]),
            (*self.points[6], *self.points[7]),
        )
        tl, tr = (
            self._get_line_intersection(top_l, lef_l),
            self._get_line_intersection(top_l, rig_l),
        )
        br, bl = (
            self._get_line_intersection(bot_l, rig_l),
            self._get_line_intersection(bot_l, lef_l),
        )

        src_pts = np.array([tl, tr, br, bl], dtype="float32")

        def dist(p1, p2):
            return np.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)

        scale = 1.5
        w_max = max(dist(tl, tr), dist(bl, br))
        w_min = min(dist(tl, tr), dist(bl, br))
        aspect = w_max / w_min if w_min > 0 else 1.0

        w_val = w_max * scale
        h_val = ((dist(tl, bl) + dist(tr, br)) / 2) * scale * aspect

        max_dim = 8000
        if w_val > max_dim or h_val > max_dim:
            f = max_dim / max(w_val, h_val)
            w_val *= f
            h_val *= f
            print(f"警告: 输出尺寸过大，已等比缩放至 {max_dim} 像素以内")

        w, h = int(w_val), int(h_val)
        print(f"输出图像尺寸: {w}x{h}")

        dst_pts = np.array(
            [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype="float32"
        )

        M = cv2.getPerspectiveTransform(src_pts, dst_pts)
        M_inv = cv2.getPerspectiveTransform(dst_pts, src_pts)

        rectified = cv2.warpPerspective(
            self.img,
            M,
            (w, h),
            flags=cv2.INTER_LANCZOS4,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0),
        )

        base_name = self.image_path.stem
        img_out = self.output_dir / f"{base_name}_ortho.jpg"
        meta_out = self.output_dir / f"{base_name}_transform.json"

        success = cv2.imwrite(str(img_out), rectified)
        if not success:
            print(f"错误: 无法保存图像到 {img_out}")

        transform_data = {
            "image": str(self.image_path.name),
            "output_size": [w, h],
            "matrix": M.tolist(),
            "inverse_matrix": M_inv.tolist(),
            "source_pts": src_pts.tolist(),
        }
        with open(meta_out, "w") as f:
            json.dump(transform_data, f, indent=4)

        print(f"图像尺寸: {w}x{h}")
        print(f"成功！\n图像: {img_out}\n数据: {meta_out}")
        cv2.destroyAllWindows()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input", required=True, help="输入图像路径")
    parser.add_argument("-o", "--output", default="./output", help="输出目录")
    args = parser.parse_args()

    FacadeOrthoExpert(args.input, args.output).run()
