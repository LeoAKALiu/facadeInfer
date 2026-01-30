#!/usr/bin/env python3
"""
建筑外立面图像透视矫正工具
支持手动标注角点、保持高度自适应宽度、保存变换矩阵
"""

import cv2
import numpy as np
import json
import os
from pathlib import Path


class FacadeRectifier:
    def __init__(self, image_path, output_dir='./output'):
        """
        初始化矫正工具

        Args:
            image_path: 输入图像路径
            output_dir: 输出目录
        """
        self.image_path = Path(image_path)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 读取原始图像
        self.original = cv2.imread(str(self.image_path))
        if self.original is None:
            raise ValueError(f"无法读取图像: {image_path}")

        self.height, self.width = self.original.shape[:2]
        self.points = []  # 存储标注的点

        print(f"图像尺寸: {self.width} x {self.height}")
        print(f"\n操作说明:")
        print("  - 左键点击: 标注角点（至少3个点，推荐4个）")
        print("  - 右键点击: 删除最后一个点")
        print("  - 'r' 键: 重置所有标注")
        print("  - 'v' 键: 预览标注区域（未标注区域显示黑色）")
        print("  - 'c' 键: 完成标注，执行矫正")
        print("  - 'q' 键: 退出")

    def on_mouse(self, event, x, y, flags, param):
        """鼠标回调函数"""
        if event == cv2.EVENT_LBUTTONDOWN:
            self.points.append([x, y])
            print(f"添加点 {len(self.points)}: ({x}, {y})")

        elif event == cv2.EVENT_RBUTTONDOWN:
            if self.points:
                removed = self.points.pop()
                print(f"删除点: {removed}")

        # 更新显示
        self.update_display()

    def preview_rectification(self):
        """预览将要矫正的区域（显示遮罩）"""
        if len(self.points) < 3:
            print("至少需要3个点才能预览")
            return

        try:
            # 创建遮罩
            mask = np.zeros((self.height, self.width), dtype=np.uint8)

            # 从标注点提取四边形
            pts = np.array(self.points, dtype=np.int32)

            if len(self.points) == 3:
                # 3个点临时构成三角形
                pts = pts.reshape((-1, 1, 2))
                cv2.fillPoly(mask, [pts], 255)
            elif len(self.points) >= 4:
                # 使用凸包
                from scipy.spatial import ConvexHull
                hull = ConvexHull(self.points)
                hull_pts = self.points[hull.vertices].reshape((-1, 1, 2))
                cv2.fillPoly(mask, [hull_pts], 255)

            # 创建预览图像
            preview = self.original.copy()
            preview[mask == 0] = 0  # 未标注区域设为黑色

            # 在预览图上叠加原始标注点
            for i, point in enumerate(self.points):
                cv2.circle(preview, tuple(point), 8, (0, 255, 255), -1)
                cv2.putText(preview, str(i+1), (point[0]+12, point[1]),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

            cv2.putText(preview, "PREVIEW - Press any key to close",
                       (20, self.height - 20),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

            cv2.imshow('Preview', preview)
            cv2.waitKey(0)
            cv2.destroyWindow('Preview')
            self.update_display()

        except Exception as e:
            print(f"预览失败: {e}")
            self.update_display()

    def update_display(self):
        """更新显示窗口，包含标注点和连接线"""
        display = self.original.copy()

        # 绘制标注点
        for i, point in enumerate(self.points):
            cv2.circle(display, tuple(point), 8, (0, 255, 255), -1)
            cv2.circle(display, tuple(point), 10, (0, 0, 255), 2)
            cv2.putText(display, str(i+1), (point[0]+12, point[1]),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

        # 绘制连接线（按顺序连接点）
        if len(self.points) >= 2:
            pts = np.array(self.points, np.int32)
            pts = pts.reshape((-1, 1, 2))
            cv2.polylines(display, [pts], True, (0, 255, 0), 2)

        # 显示提示信息
        info = f"已标注: {len(self.points)} 个点"
        cv2.putText(display, info, (20, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(display, info, (20, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 1)

        cv2.imshow('Annotation', display)

    def fit_rectangle(self):
        """
        将标注点拟合为矩形
        处理不完整的情况（可能没拍全）

        Returns:
            src_points: 源图像中的4个角点（排序后）
            dst_points: 目标图像中的矩形4个角点
        """
        if len(self.points) < 3:
            raise ValueError("至少需要标注3个点")

        pts = np.array(self.points, dtype=np.float32)

        # 如果正好4个点，直接使用
        if len(self.points) == 4:
            src_points = self.order_points(pts)
        else:
            # 少于或多于4个点，需要拟合/选择
            print(f"标注了 {len(self.points)} 个点，正在拟合矩形...")
            src_points = self.extract_corners_from_points(pts)

        # 计算矩形尺寸
        # 计算上下边长度的平均值（作为宽度）
        top_width = np.linalg.norm(src_points[1] - src_points[0])
        bottom_width = np.linalg.norm(src_points[3] - src_points[2])
        target_width = int(max(top_width, bottom_width))

        # 保持图像高度
        target_height = self.height

        # 目标点：从左上开始顺时针
        dst_points = np.array([
            [0, 0],  # 左上
            [target_width, 0],  # 右上
            [target_width, target_height],  # 右下
            [0, target_height]  # 左下
        ], dtype=np.float32)

        return src_points, dst_points, (target_width, target_height)

    def order_points(self, pts):
        """
        对4个点按顺序排列：左上、右上、右下、左下

        Args:
            pts: 4个点的数组 (N x 2)

        Returns:
            排序后的4个点: [左上, 右上, 右下, 左下]
        """
        # 转换为numpy数组
        pts = np.array(pts, dtype=np.float32)

        # 计算中心点
        center_x = np.mean(pts[:, 0])
        center_y = np.mean(pts[:, 1])

        # 根据相对于中心点的位置分类
        # 左上：x < center_x 且 y < center_y
        # 右上：x > center_x 且 y < center_y
        # 右下：x > center_x 且 y > center_y
        # 左下：x < center_x 且 y > center_y

        top_left = None
        top_right = None
        bottom_right = None
        bottom_left = None

        for pt in pts:
            if pt[0] < center_x and pt[1] < center_y:
                top_left = pt
            elif pt[0] >= center_x and pt[1] < center_y:
                top_right = pt
            elif pt[0] >= center_x and pt[1] >= center_y:
                bottom_right = pt
            else:  # pt[0] < center_x and pt[1] >= center_y
                bottom_left = pt

        # 返回排序后的四个点 [左上, 右上, 右下, 左下]
        return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)

    def extract_corners_from_points(self, pts):
        """
        从任意数量的标注点中提取建筑物角点
        计算凸包，然后找到最接近矩形的4个角点

        Args:
            pts: 标注点 (N x 2)

        Returns:
            4个角点，按顺序排列: 左上、右上、右下、左下
        """
        from scipy.spatial import ConvexHull
        import itertools

        # 转为浮点数组
        pts = np.array(pts, dtype=np.float64)

        # 如果恰好是4个点，直接排序返回
        if len(pts) == 4:
            return self.order_points(pts)

        # 计算凸包
        hull = ConvexHull(pts)
        hull_points = pts[hull.vertices]

        # 如果凸包只有3个点，需要推断第4个点
        if len(hull_points) == 3:
            # 找到每个方向的最极端点
            top_idx = np.argmin(hull_points[:, 1])
            bottom_idx = np.argmax(hull_points[:, 1])
            left_idx = np.argmin(hull_points[:, 0])
            right_idx = np.argmax(hull_points[:, 0])

            top_pt = hull_points[top_idx]
            bottom_pt = hull_points[bottom_idx]
            left_pt = hull_points[left_idx]
            right_pt = hull_points[right_idx]

            # 检查是否有重复（某个点同时是多个极端点）
            extremes = [top_idx, bottom_idx, left_idx, right_idx]
            unique_idx = []
            for i, idx in enumerate(extremes):
                if idx not in unique_idx:
                    unique_idx.append(idx)

            unique_points = hull_points[unique_idx]

            # 如果有4个不同的点，直接排序
            if len(unique_points) == 4:
                return self.order_points(unique_points)

            # 只有3个不同的点，推断第4个
            # 根据已有的3个点，推断缺失的那个角点
            has_top = (top_idx in unique_idx)
            has_bottom = (bottom_idx in unique_idx)
            has_left = (left_idx in unique_idx)
            has_right = (right_idx in unique_idx)

            if has_top and has_left and not has_bottom:
                # 有上、左、右（或只有两个），缺左下或右下
                # 找到另一个点
                if has_right:
                    # 有上、左、右，缺左下或右下
                    # 判断缺哪个：看左右哪个是垂直的
                    pass
                # 默认：用上和左推断左下，或用上和右推断右下
                # 这里简化处理：如果没有下，就推断左下和右下的平均值位置
                inferred_x = (left_pt[0] + right_pt[0]) / 2
                inferred_y = max(np.max(pts[:, 1]), left_pt[1] + (top_pt[1] - left_pt[1]) * 2)
            else:
                # 其他情况，尝试推断
                inferred_x = (left_pt[0] + right_pt[0]) / 2
                inferred_y = (top_pt[1] + bottom_pt[1]) / 2

            inferred_point = np.array([inferred_x, inferred_y])
            unique_points = np.vstack([unique_points, inferred_point])
            return self.order_points(unique_points[:4])

        # 凸包超过4个点的情况
        if len(hull_points) > 4:
            # 我们需要从凸包中选4个最能代表建筑立面的角点
            # 方法：按反时针顺序遍历凸包，找到变化最大的4个点（角点）
            # 这里使用简化的方法：找最极端的4个方向

            # 找4个方向最极端的点
            top_pt = hull_points[np.argmin(hull_points[:, 1])]
            bottom_pt = hull_points[np.argmax(hull_points[:, 1])]
            left_pt = hull_points[np.argmin(hull_points[:, 0])]
            right_pt = hull_points[np.argmax(hull_points[:, 0])]

            # 去重
            corners_list = []
            seen_positions = []

            for pt in [top_pt, bottom_pt, left_pt, right_pt]:
                pos = (int(pt[0]), int(pt[1]))
                is_duplicate = False
                for seen_pos in seen_positions:
                    if abs(pos[0] - seen_pos[0]) < 10 and abs(pos[1] - seen_pos[1]) < 10:
                        is_duplicate = True
                        break
                if not is_duplicate:
                    corners_list.append(pt)
                    seen_positions.append(pos)

            # 如果去重后少于4个点，需要推断
            if len(corners_list) < 4:
                # 缺少角点，继续用这个函数递归处理
                return self.extract_corners_from_points(corners_list)

            return self.order_points(np.array(corners_list, dtype=np.float64))

        # 默认情况
        return self.order_points(hull_points[:4])

    def rectify(self):
        """执行透视矫正"""
        # 打印标注点信息
        print(f"\n标注点数量: {len(self.points)}")
        for i, pt in enumerate(self.points):
            print(f"  点{i+1}: ({pt[0]:.1f}, {pt[1]:.1f})")

        src_points, dst_points, (target_width, target_height) = self.fit_rectangle()

        # 详细打印排序后的点
        print(f"\n源四边形 (排序后):")
        labels = ['左上', '右上', '右下', '左下']
        for i, (label, pt) in enumerate(zip(labels, src_points)):
            print(f"  {label} (点{i+1}): ({pt[0]:.1f}, {pt[1]:.1f})")

        print(f"\n目标四边形:")
        for i, (label, pt) in enumerate(zip(labels, dst_points)):
            print(f"  {label}: ({pt[0]:.1f}, {pt[1]:.1f})")

        print(f"\n矫正尺寸: {target_width} x {target_height}")

        # 创建可视化：在原图上标注排序后的角点
        debug_image = self.original.copy()
        colors = [(0, 0, 255), (0, 255, 0), (255, 0, 0), (255, 255, 0)]  # 红、绿、蓝、黄
        for i, (label, pt) in enumerate(zip(labels, src_points)):
            pt_int = (int(pt[0]), int(pt[1]))
            cv2.circle(debug_image, pt_int, 15, colors[i], -1)
            cv2.putText(debug_image, f"{label}", (pt_int[0]+20, pt_int[1]),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, colors[i], 3)

        # 绘制连接线
        pts_int = np.array(src_points, np.int32)
        cv2.polylines(debug_image, [pts_int], True, (255, 255, 255), 3)

        # 保存调试图像
        debug_path = self.output_dir / f"{self.image_path.stem}_debug.jpg"
        cv2.imwrite(str(debug_path), debug_image)
        print(f"\n调试图像已保存: {debug_path}")
        print("请检查调试图像中的角点标注是否正确对应:")
        print("  红色=左上, 绿色=右上, 蓝色=右下, 黄色=左下")
        print("\n如果不正确，请重新运行并调整标注点的位置")

        # 显示调试图像
        cv2.imshow('Debug - 正确的角点应该: 红色=左上, 绿色=右上, 蓝色=右下, 黄色=左下', debug_image)
        print("\n按任意键继续...")
        cv2.waitKey(0)
        cv2.destroyWindow('Debug - 正确的角点应该: 红色=左上, 绿色=右上, 蓝色=右下, 黄色=左下')

        # 检查源点是否有效（不应该有重复或共线）
        src_np = np.array(src_points)
        # 计算四边形的面积
        def polygon_area(points):
            x = points[:, 0]
            y = points[:, 1]
            return 0.5 * np.abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))

        area = polygon_area(src_np)
        print(f"源四边形面积: {area:.2f}")

        if area < 1000:  # 面积太小，可能是无效标注
            print("\n警告: 标注的四个点围成的面积太小，可能是无效标注！")
            print("请确保标注的是建筑立面的四个角点，并且按顺序标注。")

        # 计算透视变换矩阵
        M = cv2.getPerspectiveTransform(src_points, dst_points)
        M_inv = cv2.getPerspectiveTransform(dst_points, src_points)

        # 执行透视变换
        rectified = cv2.warpPerspective(
            self.original, M, (target_width, target_height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(200, 200, 200)  # 灰色背景
        )

        # 检查结果是否大部分是灰色
        gray_rect = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
        gray_pixels = np.sum((gray_rect > 100) & (gray_rect < 150))
        total_pixels = gray_rect.shape[0] * gray_rect.shape[1]
        gray_ratio = gray_pixels / total_pixels

        if gray_ratio > 0.5:
            print(f"\n警告: 结果图像中 {gray_ratio*100:.1f}% 是灰色！")
            print("这通常意味着:")
            print("  1. 标注点没有正确包围建筑立面的实际区域")
            print("  2. 建筑在原始图像中没有被完全拍到")
            print("  3. 透视变换参数计算有误")
            print("\n建议: 重新标注，确保4个点都在建筑立面的边界上")

        # 保存结果
        base_name = self.image_path.stem
        output_path = self.output_dir / f"{base_name}_rectified.jpg"
        cv2.imwrite(str(output_path), rectified, [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(f"矫正图像已保存: {output_path}")

        # 保存原始标注点和变换矩阵
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
        print(f"变换矩阵已保存: {meta_path}")

        # 显示结果
        cv2.imshow('Rectified', rectified)
        cv2.waitKey(3000)

        return rectified, transform_data

    def run(self):
        """运行交互式标注流程"""
        cv2.namedWindow('Annotation')
        cv2.setMouseCallback('Annotation', self.on_mouse)

        self.update_display()

        print("\n开始标注...")
        while True:
            key = cv2.waitKey(1) & 0xFF

            if key == ord('r'):  # 重置
                self.points = []
                print("已重置所有标注")
                self.update_display()

            elif key == ord('v'):  # 预览
                self.preview_rectification()

            elif key == ord('c'):  # 完成，执行矫正
                cv2.destroyAllWindows()
                try:
                    return self.rectify()
                except Exception as e:
                    print(f"\n错误: {e}")
                    print("请重新标注至少3个点")
                    cv2.namedWindow('Annotation')
                    cv2.setMouseCallback('Annotation', self.on_mouse)
                    self.update_display()

            elif key == ord('q'):  # 退出
                cv2.destroyAllWindows()
                return None, None

        cv2.destroyAllWindows()


def map_annotation_to_original(annotation_x, annotation_y, transform_json_path):
    """
    将矫正图像上的标注坐标映射回原始图像

    Args:
        annotation_x, annotation_y: 矫正图像上的坐标
        transform_json_path: 变换矩阵JSON文件路径

    Returns:
        (original_x, original_y): 原始图像上的坐标
    """
    with open(transform_json_path, 'r') as f:
        data = json.load(f)

    M_inv = np.array(data['inverse_matrix'], dtype=np.float32)

    # 构建齐次坐标
    point = np.array([[annotation_x], [annotation_y], [1]], dtype=np.float32)

    # 应用逆变换
    transformed = M_inv @ point
    transformed = transformed / transformed[2, 0]  # 归一化

    return float(transformed[0, 0]), float(transformed[1, 0])


def main():
    import argparse

    parser = argparse.ArgumentParser(description='建筑外立面透视矫正工具')
    parser.add_argument('image', help='输入图像路径')
    parser.add_argument('-o', '--output', default='./output', help='输出目录')
    args = parser.parse_args()

    print("=" * 60)
    print("建筑外立面透视矫正工具")
    print("=" * 60)

    rectifier = FacadeRectifier(args.image, args.output)
    rectified, transform_data = rectifier.run()

    if rectified is not None:
        print("\n" + "=" * 60)
        print("矫正完成！")
        print("=" * 60)
        print(f"原始图像: {args.image}")
        print(f"矫正图像: {transform_data['rectified_image']}")
        print(f"变换数据: {transform_data['rectified_image'].replace('_rectified.jpg', '_transform.json')}")


if __name__ == '__main__':
    main()
