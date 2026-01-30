# 建筑外立面透视矫正工具

用于将广角镜头拍摄的建筑外立面图像矫正为正面视角，支持交互式标注和坐标映射回原始图像。

## 安装依赖

```bash
pip install opencv-python numpy scipy
```

## 使用方法

### 1. 透视矫正

```bash
python facade_rectification.py <图像路径> [-o 输出目录]
```

**交互操作：**
- 左键点击：标注角点（至少3个点，推荐4个）
- 右键点击：删除最后一个点
- `r` 键：重置所有标注
- `c` 键：完成标注，执行矫正
- `q` 键：退出

**示例：**
```bash
python facade_rectification.py facade.jpg -o ./output
```

**输出文件：**
- `facade_rectified.jpg`：矫正后的图像
- `facade_transform.json`：变换数据（包含矩阵、坐标等）

### 2. 标注坐标映射

将矫正图像上标注的窗、门、墙等元素的坐标映射回原始图像。

#### 映射单个点

```bash
python map_annotation.py facade_transform.json -p 100 200
```

#### 映射矩形框（矩形框在透视下会变成四边形）

```bash
python map_annotation.py facade_transform.json -r 10 20 110 120
```

#### 映射标注文件

创建标注文件 `annotations.json`：
```json
{
  "image": "facade_rectified.jpg",
  "annotations": [
    {"type": "point", "x": 100, "y": 200, "label": "window_center"},
    {"type": "rectangle", "x1": 50, "y1": 100, "x2": 150, "y2": 200, "label": "window"},
    {"type": "polygon", "points": [[10,10], [50,10], [50,50], [10,50]], "label": "decoration"}
  ]
}
```

执行映射：
```bash
python map_annotation.py facade_transform.json -f annotations.json -o mapped_annotations.json
```

## 完整工作流示例

```bash
# 1. 矫正图像
python facade_rectification.py building_facade.jpg -o ./output

# 2. 在 output/building_facade_rectified.jpg 上标注（使用标注工具或手动测量）
# 假设标注了一个窗户在坐标 (150, 100, 200, 180)

# 3. 将标注映射回原始图像
python map_annotation.py output/building_facade_transform.json \
    -r 150 100 200 180

# 输出示例：
# 矫正图像矩形: [150.0, 100.0, 200.0, 180.0]
# 原始图像四边形:
#   点1: (142.35, 98.67)
#   点2: (195.22, 97.89)
#   点3: (198.45, 176.34)
#   点4: (145.67, 177.12)
```

## Python API 使用

### 透视矫正

```python
from facade_rectification import FacadeRectifier

# 创建矫正器
rectifier = FacadeRectifier('building.jpg', output_dir='./output')

# 添加标注点（可手动添加或使用交互模式）
rectifier.points = [[100, 50], [500, 60], [480, 400], [120, 390]]

# 执行矫正
rectified, transform_data = rectifier.rectify()
```

### 标注映射

```python
from map_annotation import AnnotationMapper

# 创建映射器
mapper = AnnotationMapper('output/building_transform.json')

# 映射单个点
orig_x, orig_y = mapper.map_point(150, 200)

# 映射矩形框
quad = mapper.map_rectangle(100, 150, 200, 250)
print(f"四边形顶点: {quad['points']}")

# 映射多边形
poly = mapper.map_polygon([[10,10], [50,10], [50,50], [10,50]])
```

## 变换矩阵数据结构

`*_transform.json` 文件包含以下信息：

```json
{
  "source_image": "原始图像路径",
  "rectified_image": "矫正图像路径",
  "original_size": {"width": 1920, "height": 1080},
  "rectified_size": {"width": 1200, "height": 1080},
  "source_points": [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],  // 原始图中的4个角点
  "destination_points": [[x1,y1], [x2,y2], [x3,y3], [x4,y4]], // 矫正图中的矩形角点
  "transform_matrix": [[...]],  // 正向变换矩阵（矫正图 → 原图）
  "inverse_matrix": [[...]]     // 反向变换矩阵（原图 → 矫正图）
}
```

## 特点

- ✅ 保持图像高度，自适应调整宽度
- ✅ 支持交互式标注（左键添加、右键删除）
- ✅ 自动处理不完整标注（3个点自动拟合矩形）
- ✅ 保存变换矩阵用于后续坐标映射
- ✅ 支持点、矩形框、多边形、圆形等多种标注类型
- ✅ 透视变换保持语义信息（如窗的透视形状）

## 注意事项

1. **标注点顺序不重要**：脚本会自动识别角点位置
2. **至少需要3个点**：少于4个点会自动拟合矩形
3. **转角建筑**：可以标注两个可见平面，脚本会提取最外轮廓
4. **图像分辨率**：矫正后保持和原始图像相同的高度

## 常见问题

**Q: 标注了4个点但矫正结果不对？**
A: 确保标注的点是建筑物立面的4个角点，且按顺时针或逆时针方向。脚本会自动排序，但标注应该对应立面的实际角点。

**Q: 转角建筑如何标注？**
A: 标注可见的两个平面的外轮廓角点即可，脚本会提取凸包的4个最极端点。

**Q: 矫正后图像有黑边？**
A: 如果建筑在原图中没拍全，矫正后可能出现空白区域，这是正常的。
