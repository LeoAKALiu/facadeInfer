#!/usr/bin/env python3
"""
将矫正图像上的标注映射回原始图像
支持点、矩形框等常见标注类型
"""

import json
import argparse
from pathlib import Path
import numpy as np
from typing import Union, List, Tuple


class AnnotationMapper:
    def __init__(self, transform_json_path):
        """
        初始化标注映射器

        Args:
            transform_json_path: 变换矩阵JSON文件路径
        """
        self.transform_path = Path(transform_json_path)

        with open(self.transform_path, 'r', encoding='utf-8') as f:
            self.data = json.load(f)

        self.M_inv = np.array(self.data['inverse_matrix'], dtype=np.float32)
        self.M = np.array(self.data['transform_matrix'], dtype=np.float32)

        self.rectified_width = self.data['rectified_size']['width']
        self.rectified_height = self.data['rectified_size']['height']

        print(f"加载变换数据: {transform_json_path}")
        print(f"矫正图像尺寸: {self.rectified_width} x {self.rectified_height}")

    def map_point(self, x: float, y: float) -> Tuple[float, float]:
        """
        将单个点从矫正图像映射到原始图像

        Args:
            x, y: 矫正图像上的坐标

        Returns:
            (original_x, original_y): 原始图像上的坐标
        """
        point = np.array([[x], [y], [1]], dtype=np.float32)
        transformed = self.M_inv @ point
        transformed = transformed / transformed[2, 0]
        return float(transformed[0, 0]), float(transformed[1, 0])

    def map_rectangle(self, x1: float, y1: float, x2: float, y2: float,
                      num_edge_points: int = 5) -> dict:
        """
        将矩形框从矫正图像映射到原始图像
        由于透视变换会改变矩形形状，使用四边形表示

        Args:
            x1, y1, x2, y2: 矩形框坐标
            num_edge_points: 每条边上采样的点数（用于计算变换后的边缘）

        Returns:
            包含4个角点的四边形坐标
        """
        # 获取4个角点
        tl = np.array([min(x1, x2), min(y1, y2)])
        tr = np.array([max(x1, x2), min(y1, y2)])
        br = np.array([max(x1, x2), max(y1, y2)])
        bl = np.array([min(x1, x2), max(y1, y2)])

        # 映射4个角点
        tl_mapped = self.map_point(*tl)
        tr_mapped = self.map_point(*tr)
        br_mapped = self.map_point(*br)
        bl_mapped = self.map_point(*bl)

        return {
            'type': 'quadrilateral',
            'points': [tl_mapped, tr_mapped, br_mapped, bl_mapped],
            'original': [x1, y1, x2, y2]
        }

    def map_circle(self, center_x: float, center_y: float, radius: float,
                   num_points: int = 16) -> dict:
        """
        将圆形从矫正图像映射到原始图像
        透视变换后变为椭圆

        Args:
            center_x, center_y: 圆心坐标
            radius: 半径
            num_points: 圆周上的采样点数

        Returns:
            椭圆的近似参数（多个点）
        """
        points = []
        angles = np.linspace(0, 2 * np.pi, num_points, endpoint=False)

        for angle in angles:
            x = center_x + radius * np.cos(angle)
            y = center_y + radius * np.sin(angle)
            points.append(self.map_point(x, y))

        # 计算中心点
        center_mapped = self.map_point(center_x, center_y)

        return {
            'type': 'ellipse',
            'center': center_mapped,
            'boundary_points': points,
            'original': {'center': [center_x, center_y], 'radius': radius}
        }

    def map_polygon(self, points: List[Tuple[float, float]]) -> dict:
        """
        将多边形从矫正图像映射到原始图像

        Args:
            points: 多边形顶点列表 [(x1, y1), (x2, y2), ...]

        Returns:
            映射后的多边形顶点
        """
        mapped_points = [self.map_point(x, y) for x, y in points]

        return {
            'type': 'polygon',
            'points': mapped_points,
            'original': points
        }

    def map_annotation_file(self, annotation_path: str, output_path: str):
        """
        批量映射标注文件中的所有标注

        支持的标注格式（JSON）:
        {
            "image": "rectified.jpg",
            "annotations": [
                {"type": "point", "x": 100, "y": 200, "label": "window"},
                {"type": "rectangle", "x1": 10, "y1": 20, "x2": 110, "y2": 120, "label": "door"},
                {"type": "polygon", "points": [[x1,y1], [x2,y2], ...], "label": "decoration"}
            ]
        }

        Args:
            annotation_path: 标注文件路径
            output_path: 输出文件路径
        """
        with open(annotation_path, 'r', encoding='utf-8') as f:
            annotations = json.load(f)

        mapped_annotations = []

        for ann in annotations.get('annotations', []):
            ann_type = ann.get('type')

            if ann_type == 'point':
                mapped = {
                    **ann,
                    'x', self.map_point(ann['x'], ann['y']),
                    'mapped': True
                }

            elif ann_type == 'rectangle':
                mapped_rect = self.map_rectangle(
                    ann['x1'], ann['y1'], ann['x2'], ann['y2']
                )
                mapped = {
                    **ann,
                    'mapped_shape': mapped_rect,
                    'mapped': True
                }

            elif ann_type == 'circle':
                mapped_circle = self.map_circle(
                    ann['center_x'], ann['center_y'], ann['radius']
                )
                mapped = {
                    **ann,
                    'mapped_shape': mapped_circle,
                    'mapped': True
                }

            elif ann_type == 'polygon':
                mapped_poly = self.map_polygon(ann['points'])
                mapped = {
                    **ann,
                    'mapped_shape': mapped_poly,
                    'mapped': True
                }

            else:
                print(f"警告: 不支持的标注类型 '{ann_type}'，跳过")
                continue

            mapped_annotations.append(mapped)

        output_data = {
            'image': annotations['image'],
            'transform_file': str(self.transform_path),
            'annotations': mapped_annotations
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)

        print(f"已映射 {len(mapped_annotations)} 个标注到: {output_path}")


def main():
    parser = argparse.ArgumentParser(description='标注坐标映射工具')
    parser.add_argument('transform', help='变换矩阵JSON文件路径')
    parser.add_argument('-p', '--point', nargs=2, type=float,
                       metavar=('X', 'Y'), help='映射单个点')
    parser.add_argument('-r', '--rectangle', nargs=4, type=float,
                       metavar=('X1', 'Y1', 'X2', 'Y2'), help='映射矩形框')
    parser.add_argument('-f', '--file', help='映射标注文件')
    parser.add_argument('-o', '--output', help='输出文件路径（用于文件模式）')

    args = parser.parse_args()

    mapper = AnnotationMapper(args.transform)

    if args.point:
        # 映射单个点
        x, y = args.point
        orig_x, orig_y = mapper.map_point(x, y)
        print(f"\n矫正图像坐标: ({x}, {y})")
        print(f"原始图像坐标: ({orig_x:.2f}, {orig_y:.2f})")

    elif args.rectangle:
        # 映射矩形框
        rect = mapper.map_rectangle(*args.rectangle)
        print(f"\n矫正图像矩形: {args.rectangle}")
        print(f"原始图像四边形:")
        for i, point in enumerate(rect['points']):
            print(f"  点{i+1}: ({point[0]:.2f}, {point[1]:.2f})")

    elif args.file:
        if not args.output:
            parser.error("-f/--file 需要 -o/--output 参数")
        # 映射标注文件
        mapper.map_annotation_file(args.file, args.output)

    else:
        # 交互模式
        print("\n交互模式 - 输入坐标进行映射（输入 'q' 退出）:")
        while True:
            line = input("\n矫正图像坐标 (x y): ").strip()
            if line.lower() == 'q':
                break

            try:
                x, y = map(float, line.split())
                orig_x, orig_y = mapper.map_point(x, y)
                print(f"原始图像坐标: ({orig_x:.2f}, {orig_y:.2f})")
            except (ValueError, KeyboardInterrupt):
                print("输入格式错误，请使用: x y")
                continue


if __name__ == '__main__':
    main()
