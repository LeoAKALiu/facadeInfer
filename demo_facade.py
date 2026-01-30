#!/usr/bin/env python3
"""
演示脚本：展示如何使用透视矫正和标注映射的完整流程
"""

import json
from facade_rectification import FacadeRectifier
from map_annotation import AnnotationMapper
import cv2
import numpy as np


def demo_workflow():
    """
    完整的工作流程演示
    """

    # ============================================================
    # 步骤1: 透视矫正
    # ============================================================
    print("\n" + "="*70)
    print("步骤1: 透视矫正")
    print("="*70)

    # 假设你已经运行了交互式标注流程
    # facade_rectification.py 会生成以下文件：
    #   - building_rectified.jpg (矫正后的图像)
    #   - building_transform.json (变换数据)

    image_path = "building.jpg"  # 替换为你的图像路径
    transform_file = "output/building_transform.json"

    # 如果还没有运行矫正，取消下面的注释
    # rectifier = FacadeRectifier(image_path, output_dir='./output')
    # rectified, transform_data = rectifier.run()

    # ============================================================
    # 步骤2: 在矫正后的图像上进行标注
    # ============================================================
    print("\n" + "="*70)
    print("步骤2: 在矫正后的图像上标注")
    print("="*70)

    # 示例标注数据（在实际应用中，这些通常来自标注工具）
    annotations = {
        "image": "building_rectified.jpg",
        "annotations": [
            {
                "type": "rectangle",
                "x1": 150, "y1": 100,
                "x2": 250, "y2": 300,
                "label": "window_1_main_floor"
            },
            {
                "type": "rectangle",
                "x1": 300, "y1": 100,
                "x2": 400, "y2": 300,
                "label": "window_2_main_floor"
            },
            {
                "type": "rectangle",
                "x1": 450, "y1": 100,
                "x2": 550, "y2": 300,
                "label": "window_3_main_floor"
            },
            {
                "type": "rectangle",
                "x1": 200, "y1": 350,
                "x2": 500, "y2": 600,
                "label": "entrance_door"
            },
            {
                "type": "polygon",
                "points": [[50, 50], [600, 50], [600, 650], [50, 650]],
                "label": "facade_boundary"
            }
        ]
    }

    # 保存标注到文件
    annotation_file = "output/building_annotations.json"
    with open(annotation_file, 'w') as f:
        json.dump(annotations, f, indent=2)

    print(f"✓ 示例标注已保存到: {annotation_file}")
    print(f"  - {len(annotations['annotations'])} 个标注")

    # ============================================================
    # 步骤3: 将标注映射回原始图像
    # ============================================================
    print("\n" + "="*70)
    print("步骤3: 将标注映射回原始图像")
    print("="*70)

    # 创建映射器
    mapper = AnnotationMapper(transform_file)

    # 映射标注文件
    mapped_file = "output/building_annotations_mapped.json"
    mapper.map_annotation_file(annotation_file, mapped_file)

    # ============================================================
    # 步骤4: 显示映射结果
    # ============================================================
    print("\n" + "="*70)
    print("步骤4: 映射结果详情")
    print("="*70)

    with open(mapped_file, 'r') as f:
        mapped_data = json.load(f)

    for i, ann in enumerate(mapped_data['annotations'], 1):
        print(f"\n标注 {i}: {ann['label']}")

        if ann['type'] == 'rectangle':
            print(f"  矫正图像: {ann['x1']}, {ann['y1']}, {ann['x2']}, {ann['y2']}")
            print(f"  原始图像（四边形）:")
            for j, pt in enumerate(ann['mapped_shape']['points']):
                print(f"    角点{j+1}: ({pt[0]:.2f}, {pt[1]:.2f})")

        elif ann['type'] == 'polygon':
            print(f"  矫正图像: {len(ann['points'])} 个顶点")
            print(f"  原始图像:")
            for j, pt in enumerate(ann['mapped_shape']['points'][:3]):
                print(f"    顶点{j+1}: ({pt[0]:.2f}, {pt[1]:.2f})")
            print(f"    ... ({len(ann['mapped_shape']['points'])-3} 更多顶点)")

    # ============================================================
    # 步骤5: 可视化（可选）
    # ============================================================
    print("\n" + "="*70)
    print("步骤5: 可视化映射结果")
    print("="*70)

    try:
        # 读取矫正后的图像
        rectified = cv2.imread("output/building_rectified.jpg")

        # 在矫正图像上绘制原始标注
        for ann in annotations['annotations']:
            if ann['type'] == 'rectangle':
                cv2.rectangle(rectified,
                             (ann['x1'], ann['y1']),
                             (ann['x2'], ann['y2']),
                             (0, 255, 0), 2)
                cv2.putText(rectified, ann['label'],
                           (ann['x1'], ann['y1']-5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        # 保存可视化结果
        viz_file = "output/building_visualized.jpg"
        cv2.imwrite(viz_file, rectified)
        print(f"✓ 矫正图像+标注已保存: {viz_file}")

    except Exception as e:
        print(f"⚠ 可视化失败（可能还没有矫正图像）: {e}")

    # ============================================================
    # 总结
    # ============================================================
    print("\n" + "="*70)
    print("完成！")
    print("="*70)
    print("生成的文件:")
    print(f"  1. {annotation_file} - 矫正图像上的标注")
    print(f"  2. {mapped_file} - 映射到原始图像的标注")
    print(f"  3. {viz_file if 'viz_file' in locals() else 'N/A'} - 可视化结果")


def demo_point_mapping():
    """演示单个点的映射"""

    print("\n" + "="*70)
    print("单个点映射示例")
    print("="*70)

    # 创建映射器（假设已有变换文件）
    try:
        mapper = AnnotationMapper('output/building_transform.json')

        # 矫正图像上的窗户中心
        rectified_center_x, rectified_center_y = 200, 200

        # 映射回原始图像
        orig_x, orig_y = mapper.map_point(rectified_center_x, rectified_center_y)

        print(f"矫正图像坐标: ({rectified_center_x}, {rectified_center_y})")
        print(f"原始图像坐标: ({orig_x:.2f}, {orig_y:.2f})")

        return orig_x, orig_y

    except FileNotFoundError:
        print("⚠ 需要先运行 facad_rectification.py 生成变换文件")
        return None, None


def demo_rectangle_mapping():
    """演示矩形框的映射"""

    print("\n" + "="*70)
    print("矩形框映射示例")
    print("="*70)

    try:
        mapper = AnnotationMapper('output/building_transform.json')

        # 矫正图像上的窗户矩形
        x1, y1, x2, y2 = 150, 100, 250, 300

        # 映射四边形
        quad = mapper.map_rectangle(x1, y1, x2, y2)

        print(f"\n矫正图像矩形: ({x1}, {y1}) -> ({x2}, {y2})")
        print(f"尺寸: {x2-x1} x {y2-y1}")
        print(f"\n原始图像四边形:")
        for i, (x, y) in enumerate(quad['points'], 1):
            print(f"  角点{i}: ({x:.2f}, {y:.2f})")

        return quad

    except FileNotFoundError:
        print("⚠ 需要先运行 facad_rectification.py 生成变换文件")
        return None


def visualize_on_original():
    """
    在原始图像上可视化映射后的标注
    """

    print("\n" + "="*70)
    print("在原始图像上可视化")
    print("="*70)

    try:
        # 加载数据
        mapper = AnnotationMapper('output/building_transform.json')
        with open('output/building_annotations.json') as f:
            annotations = json.load(f)

        # 读取原始图像
        original = cv2.imread('output/building.jpg')

        if original is None:
            print("⚠ 找不到原始图像")
            return

        # 在原始图像上绘制映射后的标注
        for ann in annotations['annotations']:
            if ann['type'] == 'rectangle':
                # 矩形框映射为四边形
                quad = mapper.map_rectangle(
                    ann['x1'], ann['y1'], ann['x2'], ann['y2']
                )

                # 绘制四边形
                pts = np.array([p for p in quad['points']], np.int32)
                pts = pts.reshape((-1, 1, 2))

                cv2.polylines(original, [pts], True, (0, 255, 0), 3)

                # 计算中心点用于显示标签
                center_x = np.mean([p[0] for p in quad['points']])
                center_y = np.mean([p[1] for p in quad['points']])

                cv2.putText(original, ann['label'],
                           (int(center_x)-20, int(center_y)),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # 保存结果
        output_path = "output/building_original_with_labels.jpg"
        cv2.imwrite(output_path, original)
        print(f"✓ 原始图像+映射标注已保存: {output_path}")

    except Exception as e:
        print(f"⚠ 可视化失败: {e}")


if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1:
        mode = sys.argv[1]
    else:
        mode = 'full'

    if mode == 'full':
        demo_workflow()
    elif mode == 'point':
        demo_point_mapping()
    elif mode == 'rectangle':
        demo_rectangle_mapping()
    elif mode == 'visualize':
        visualize_on_original()
    else:
        print(f"未知模式: {mode}")
        print("可用模式: full, point, rectangle, visualize")
