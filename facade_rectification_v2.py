#!/usr/bin/env python3
"""
建筑外立面透视矫正工具（改进版）
添加详细的调试信息和更智能的点选择
"""

import cv2
import numpy as np
import json
import os
from pathlib import Path


class FacadeRectifier:
    def __init__(self, image_path, output_dir='./output'):
        self.image_path = Path(image_path)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.original = cv2.imread(str(self.image_path))
        if self.original is None:
            raise ValueError(f"无法读取图像: {image_path}")

        self.height, self.width = self.original.shape[:2]
        self.points = []

        print(f"图像尺寸: {self.width} x {self.height}")
        print(f"\n操作说明:")
        print("  - 左键点击: 标注参考点（可以标注任意数量的点）")
        print("    建议沿建筑立面边缘标注多个点")
        print("  - 右键点击: 删除最后一个点")
        print("  - 'r' 键: 重置所有标注")
        print("  - 'c' 键: 完成标注，自动选择4个角点后执行矫正")
        print("  - 'q' 键: 退出")

    def on_mouse(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            self.points.append([x, y])
            print(f"添加点 {len(self.points)}: ({x}, {y})")

        elif event == cv2.EVENT_RBUTTONDOWN:
            if self.points:
                removed = self.points.pop()
                print(f"删除点: {removed}")

        self.update_display()

    def update_display(self):
        display = self.original.copy()

        # 绘制标注点 - 按顺序用不同颜色
        colors = [(0, 0, 255), (0, 255, 0), (255, 0, 0), (0, 255, 255), (255, 0, 255)]
        labels = ['1', '2', '3', '4', '5']

        for i, point in enumerate(self.points):
            color = colors[i % len(colors)]
            label = labels[i % len(labels)]

            cv2.circle(display, tuple(point), 12, color, -1)
            cv2.circle(display, tuple(point), 15, (255, 255, 255), 2)
            cv2.putText(display, label,
                       (point[0]+20, point[1]),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

        # 绘制连接线
        if len(self.points) >= 2:
            pts = np.array(self.points, np.int32)
            pts = pts.reshape((-1, 1, 2))
            cv2.polylines(display, [pts], len(self.points) == 4, (255, 255, 0), 3)

        # 提示信息
        info = f"已标注: {len(self.points)} 个点"
        cv2.putText(display, info, (20, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)

        if len(self.points) < 3:
            hint = "至少需要3个点..."
            cv2.putText(display, hint, (20, 70),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

        cv2.imshow('Annotation', display)

    def order_points_simple(self, pts):
        """
        简化的点排序 - 适用于用户按正确顺序标注的情况
        """
        pts = np.array(pts, dtype=np.float32)

        # 计算中心
        center_x = np.mean(pts[:, 0])
        center_y = np.mean(pts[:, 1])

        # 分类四个点
        quadrants = {
            'tl': None, 'tr': None, 'br': None, 'bl': None
        }

        for pt in pts:
            if pt[0] <= center_x and pt[1] <= center_y:
                quadrants['tl'] = pt
            elif pt[0] >= center_x and pt[1] <= center_y:
                quadrants['tr'] = pt
            elif pt[0] >= center_x and pt[1] >= center_y:
                quadrants['br'] = pt
            else:
                quadrants['bl'] = pt

        return np.array([
            quadrants['tl'],
            quadrants['tr'],
            quadrants['br'],
            quadrants['bl']
        ], dtype=np.float32)

    def fit_rectangle(self):
        if len(self.points) < 3:
            raise ValueError("至少需要标注3个点")

        print(f"\n标注点分析:")
        for i, pt in enumerate(self.points):
            print(f"  原始点{i+1}: ({pt[0]:.1f}, {pt[1]:.1f})")

        pts = np.array(self.points, dtype=np.float32)

        if len(self.points) == 4:
            print("使用用户标注的4个点")
            src_points = self.order_points_simple(pts)

            # 打印排序后的点
            labels = ['左上(TL)', '右上(TR)', '右下(BR)', '左下(BL)']
            print("\n排序后的点:")
            for i, (label, pt) in enumerate(zip(labels, src_points)):
                print(f"  {label}: ({pt[0]:.1f}, {pt[1]:.1f})")
        else:
            print(f"标注了 {len(self.points)} 个点，需要提取4个角点")
            src_points = self.extract_corners(pts)

        # 计算目标尺寸
        # 上边宽度（左上到右上的距离）
        top_width = np.linalg.norm(src_points[1] - src_points[0])
        # 下边宽度（右下到左下的距离）
        bottom_width = np.linalg.norm(src_points[3] - src_points[2])
        target_width = int(max(top_width, bottom_width))

        print(f"上边宽度: {top_width:.1f}")
        print(f"下边宽度: {bottom_width:.1f}")
        print(f"使用宽度: {target_width}")

        # 目标四边形（矩形）
        dst_points = np.array([
            [0, 0],                             # 左上
            [target_width, 0],                 # 右上
            [target_width, self.height],       # 右下
            [0, self.height]                   # 左下
        ], dtype=np.float32)

        return src_points, dst_points, (target_width, self.height)

    def extract_corners(self, pts):
        """从多个标注点中提取最合适的4个角点"""
        from scipy.spatial import ConvexHull
        import itertools

        # 转浮点
        pts = np.array(pts, dtype=np.float64)

        print(f"原始标注点数: {len(pts)}")

        # 去重（容忍5像素误差）
        unique_pts = []
        for pt in pts:
            is_duplicate = False
            for existing in unique_pts:
                if np.linalg.norm(pt - existing) < 5:
                    is_duplicate = True
                    break
            if not is_duplicate:
                unique_pts.append(pt)

        unique_pts = np.array(unique_pts)

        if len(unique_pts) < 3:
            raise ValueError(f"去重后只有{len(unique_pts)}个有效点，至少需要3个")

        print(f"去重后有效点数: {len(unique_pts)}")

        if len(unique_pts) == 4:
            print("恰好4个点，直接使用")
            return self.order_points_simple(unique_pts)

        if len(unique_pts) == 3:
            print("只有3个不同的点，尝试推断第4个点")
            return self.infer_4th_corner(unique_pts)

        # 多个点的情况，智能选择最佳4个角点
        print(f"有{len(unique_pts)}个点，分析并选择最佳4个角点")
        return self.select_best_corners(unique_pts)

    def select_best_corners(self, pts):
        """从多个点中选择最佳的4个角点"""
        from scipy.spatial import ConvexHull

        # 方法：计算凸包，然后按角度变化找4个最大转角的点
        hull = ConvexHull(pts)
        hull_pts = pts[hull.vertices]

        print(f"凸包顶点数: {len(hull_pts)}")

        if len(hull_pts) <= 4:
            print("凸包顶点<=4，直接使用所有凸包顶点")
            return self.order_points_simple(hull_pts[:4])

        # 计算凸包上每段的距离，找出很长的边（可能是主要边缘）
        hull_poly = np.vstack([hull_pts, hull_pts[0]])  # 闭合多边形
        edge_lengths = []
        for i in range(len(hull_pts)):
            p1 = hull_pt = hull_pts[i]
            p2 = hull_pts[(i + 1) % len(hull_pts)]
            length = np.linalg.norm(p2 - p1)
            edge_lengths.append(length)

        edge_lengths = np.array(edge_lengths)
        # 找4条最长的边对应的端点
        top_4_indices = np.argsort(edge_lengths)[-4:]

        # 收集这些边涉及的点
        corner_candidates = set()
        for idx in top_4_indices:
            corner_candidates.add(int(hull.vertices[idx]))
            corner_candidates.add(int(hull.vertices[(idx + 1) % len(hull.vertices)]))

        if len(corner_candidates) >= 4:
            # 如果找到至少4个不同的候选点，选择其中最合适的4个
            candidate_pts = hull_pts[list(corner_candidates)]
            print(f"基于最长边找到{len(candidate_pts)}个候选角点")
        else:
            # 否则使用最极端的4个点
            candidate_pts = hull_pts
            print(f"候选角点不够，使用所有凸包顶点")

        # 如果候选点还是多于4个，使用简化方法：找最极端的4个方向
        if len(candidate_pts) > 4:
            print(f"候选点{len(candidate_pts)}个，选择最极端的4个")
            extreme_indices = [
                np.argmin(candidate_pts[:, 1]),  # 最上
                np.argmax(candidate_pts[:, 1]),  # 最下
                np.argmin(candidate_pts[:, 0]),  # 最左
                np.argmax(candidate_pts[:, 0]),  # 最右
            ]

            # 去重
            extreme_indices = list(set(extreme_indices))
            selected_pts = candidate_pts[extreme_indices]
        else:
            selected_pts = candidate_pts

        # 如果还是超过4个，再选择一次
        if len(selected_pts) > 4:
            print(f"仍有{len(selected_pts)}个候选，使用凸包顶点的前4个")
            selected_pts = hull_pts[:4]

        # 确保4个点
        if len(selected_pts) < 4:
            print(f"只有{len(selected_pts)}个候选点，推断第4个")
            return self.infer_4th_corner(selected_pts)

        print(f"选中的角点:")
        for i, pt in enumerate(selected_pts):
            print(f"  点{i+1}: ({pt[0]:.1f}, {pt[1]:.1f})")

        return self.order_points_simple(selected_pts)

    def infer_4th_corner(self, pts):
        """从3个点推断第4个点"""
        # 按y排序找到最上、最下
        sorted_by_y = pts[np.argsort(pts[:, 1])]
        top_pt = sorted_by_y[0]
        bottom_pt = sorted_by_y[2]
        middle_pt = sorted_by_y[1]

        print(f"上部点: ({top_pt[0]:.0f}, {top_pt[1]:.0f})")
        print(f"中部点: ({middle_pt[0]:.0f}, {middle_pt[1]:.0f})")
        print(f"下部点: ({bottom_pt[0]:.0f}, {bottom_pt[1]:.0f})")

        # 判断形状
        # 如果上部点在最左边，则缺右上
        if top_pt[0] <= middle_pt[0]:
            # 上左存在，需要推断上右
            # 方法：下部点的x减去(上左-下左)的差
            inferred_x = top_pt[0] + (bottom_pt[0] - middle_pt[0])
            inferred_y = top_pt[1]
            inferred = [inferred_x, inferred_y]
            print(f"推断右上点: ({inferred_x:.0f}, {inferred_y:.0f})")
            corners = np.array([top_pt, inferred, bottom_pt, middle_pt], dtype=np.float64)
        else:
            # 上右存在，需要推断上左
            inferred_x = top_pt[0] - (middle_pt[0] - bottom_pt[0])
            inferred_y = top_pt[1]
            inferred = [inferred_x, inferred_y]
            print(f"推断左上点: ({inferred_x:.0f}, {inferred_y:.0f})")
            corners = np.array([inferred, top_pt, middle_pt, bottom_pt], dtype=np.float64)

        return self.order_points_simple(corners)

    def rectify(self):
        """执行透视矫正"""
        print("\n" + "="*60)
        print("开始透视矫正")
        print("="*60)

        src_points, dst_points, (target_width, target_height) = self.fit_rectangle()

        print(f"\n最终选中的4个角点:")
        labels = ['左上(TL)', '右上(TR)', '右下(BR)', '左下(BL)']
        for i, (label, pt) in enumerate(zip(labels, src_points)):
            print(f"  {label}: ({pt[0]:.1f}, {pt[1]:.1f})")

        print(f"\n目标尺寸: {target_width} x {target_height}")

        # 创建调试图像
        debug_image = self.original.copy()

        # 先绘制所有标注点（用白色小圆）
        for i, point in enumerate(self.points):
            cv2.circle(debug_image, tuple(point), 6, (255, 255, 255), -1)
            cv2.putText(debug_image, str(i+1), (point[0]-5, point[1]-10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        # 绘制选中的4个角点（用大彩色圆）
        corner_colors = [(0, 0, 255), (0, 255, 0), (255, 0, 0), (0, 255, 255)]
        for i, (label, pt) in enumerate(zip(labels, src_points)):
            pt_int = (int(pt[0]), int(pt[1]))
            cv2.circle(debug_image, pt_int, 15, corner_colors[i], -1)
            cv2.circle(debug_image, pt_int, 3, (255, 255, 255), -1)
            cv2.putText(debug_image, label, (pt_int[0]+20, pt_int[1]),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, corner_colors[i], 2)

        # 绘制连接线
        pts_int = np.array(src_points, np.int32)
        cv2.polylines(debug_image, [pts_int], True, (255, 255, 0), 3)

        debug_path = self.output_dir / f"{self.image_path.stem}_debug.jpg"
        cv2.imwrite(str(debug_path), debug_image)
        print(f"\n调试图像: {debug_path}")
        print("说明:")
        print("  ⚪ 白色小点: 所有标注点（按标注顺序编号）")
        print("  🔴 红色大点: 选中左上角 (Top-Left)")
        print("  🟢 绿色大点: 选中右上角 (Top-Right)")
        print("  🔵 蓝色大点: 选中右下角 (Bottom-Right)")
        print("  🟡 黄色大点: 选中左下角 (Bottom-Left)")
        print("  ↩️ 黄色连线: 最终使用的四边形边界")

        cv2.imshow('Debug', debug_image)
        print("\n按任意键继续...")
        cv2.waitKey(0)
        cv2.destroyWindow('Debug')

        # 计算变换矩阵
        M = cv2.getPerspectiveTransform(src_points, dst_points)
        M_inv = cv2.getPerspectiveTransform(dst_points, src_points)

        # 执行透视变换
        rectified = cv2.warpPerspective(
            self.original, M, (target_width, target_height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(200, 200, 200)
        )

        # 检查结果
        gray_rect = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
        gray_pixels = np.sum((gray_rect > 100) & (gray_rect < 150))
        total_pixels = gray_rect.shape[0] * gray_rect.shape[1]
        gray_ratio = gray_pixels / total_pixels

        if gray_ratio > 0.5:
            print(f"\n⚠️ 警告: {gray_ratio*100:.1f}% 是灰色")
            print("这通常意味着标注点位置不正确")

        # 保存结果
        base_name = self.image_path.stem
        output_path = self.output_dir / f"{base_name}_rectified.jpg"
        cv2.imwrite(str(output_path), rectified, [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(f"\n✓ 矫正图像: {output_path}")

        # 保存变换数据
        meta_path = self.output_dir / f"{base_name}_transform.json"
        transform_data = {
            "source_image": str(self.image_path),
            "rectified_image": str(output_path),
            "original_size": {"width": self.width, "height": self.height},
            "rectified_size": {"width": target_width, "height": target_height},
            "source_points": src_points.tolist(),
            "destination_points": dst_points.tolist(),
            "transform_matrix": M.tolist(),
            "inverse_matrix": M_inv.tolist()
        }

        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(transform_data, f, indent=2, ensure_ascii=False)
        print(f"✓ 变换数据: {meta_path}")

        cv2.imshow('Rectified', rectified)
        cv2.waitKey(3000)

        return rectified, transform_data

    def run(self):
        cv2.namedWindow('Annotation')
        cv2.setMouseCallback('Annotation', self.on_mouse)
        self.update_display()

        print("\n开始标注...")
        while True:
            key = cv2.waitKey(1) & 0xFF

            if key == ord('r'):
                self.points = []
                print("已重置")
                self.update_display()

            elif key == ord('c'):
                cv2.destroyAllWindows()
                try:
                    return self.rectify()
                except Exception as e:
                    print(f"\n错误: {e}")
                    print("请重新标注")
                    cv2.namedWindow('Annotation')
                    cv2.setMouseCallback('Annotation', self.on_mouse)
                    self.update_display()

            elif key == ord('q'):
                cv2.destroyAllWindows()
                return None, None

        cv2.destroyAllWindows()


def main():
    import argparse
    parser = argparse.ArgumentParser(description='建筑外立面透视矫正工具（改进版）')
    parser.add_argument('image', help='输入图像路径')
    parser.add_argument('-o', '--output', default='./output', help='输出目录')
    args = parser.parse_args()

    rectifier = FacadeRectifier(args.image, args.output)
    rectified, _ = rectifier.run()


if __name__ == '__main__':
    main()
