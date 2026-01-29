
# SVI-to-CAD & Risk Assessment Demo：技术实现路线图

## 1. 系统核心功能定义 (Scope)
输入一张建筑街景图片（SVI），系统自动执行以下单一线性流程，最终输出一份评估报告（JSON）和一个其CAD文件（DXF）。

*   **Input:** 单张建筑立面图像（JPG/PNG）。
*   **Pipeline:** 图像矫正 -> 语义分割 -> 规则推演 -> 矢量化绘图。
*   **Output:**
    1.  **RiskReport.json**: 包含窗墙比、软弱层风险判定、预估年代。
    2.  **Layout.dxf**: 初步生成的建筑平面布局图。

---

## 2. 技术栈选型 (Tech Stack)
告诉Coding AI强制使用以下Python库，确保快速落地：
*   **图像处理**: `OpenCV` (`cv2`) - 用于透视变换、图像预处理。
*   **AI推理**: `Ultralytics YOLOv8` - 用于以最快速度实现建筑轮廓和门窗的实例分割（Instance Segmentation）。
*   **矢量绘图**: `ezdxf` - 用于生成标准的CAD文件。
*   **数据科学**: `NumPy`, `Pandas` - 用于几何计算。

---

## 3. 分步实现路径 (Step-by-Step Implementation)

### 步骤一：图像预处理与透视矫正 (Image Rectification)
*痛点解决：街景通常是仰视或侧视，导致测量不准。需要先把它“拉直”。*

*   **逻辑：**
    1.  加载图像。
    2.  利用OpenCV的边缘检测（Canny）或者霍夫变换找到建筑的主要垂直线和水平线。
    3.  计算透视变换矩阵（Homography Matrix），将梯形视角的立面校正为矩形正立面。
    4.  **MVP简化策略：** 若自动校正太复杂，先假设输入图片已基本裁切正对（MVP阶段手动选正对图片），只做灰度化和尺寸归一化（Resize to 1024px width）。

### 步骤二：立面要素感知 (Facade Parsing)
*利用YOLOv8-seg提取结构要素。*

*   **模型加载：** 指令AI使用预训练的 `yolov8x-seg.pt`（通用模型）或尝试加载能够识别 `window`, `door`, `building` 的模型。
    *   *注：如果没有现成权重的建筑模型，让Coding AI写一个脚本去推理通用物体，或者模拟mock数据（假设mask区域）。*
*   **提取结果：**
    *   获得 `Building_Mask`（整栋楼的轮廓）。
    *   获得 `Window_Masks`（所有窗户的坐标列表）。
    *   获得 `Door_Masks`（所有门的坐标列表）。
*   **关键计算：**
    *   **层数估算 (Story Counting)：** 统计 `Window_Masks` 在Y轴上的聚类分布（使用K-Means或直方图峰值），峰值数量即为层数。
    *   **窗墙比 (WWR)：** $\text{WWR} = \frac{\sum \text{Area}_{\text{windows}}}{\text{Area}_{\text{building}}}$。

### 步骤三：结构风险逻辑判定 (Risk Logic)
*将视觉特征转化为工程指标。*

*   **软弱底层 (Soft Story) 判定算法：**
    1.  提取底层区域（Ground Floor）：图像底部 height/stories 区域。
    2.  计算底层开口率：$\text{OpeningRatio}_{GF} = \frac{\text{Width}_{\text{doors}} + \text{Width}_{\text{windows}}}{\text{Width}_{\text{building}}}$。
    3.  **规则：** 如果 $\text{OpeningRatio}_{GF} > 0.6$（例如全是商铺大玻璃），或底层层高明显高于上层（>1.5倍），标记 `Risk_SoftStory = HIGH`。
*   **结构类型推断（简化规则）：**
    *   若 WWR > 0.7 $\rightarrow$ 玻璃幕墙/钢结构。
    *   若 WWR < 0.3 且层数 < 6 $\rightarrow$ 砌体结构（Masonry）。
    *   其他 $\rightarrow$ RC框架结构。

### 步骤四：逆向生成户型逻辑 (Generation Algorithm)
*这是最难的一步，Demo阶段采用“基于开间的投影法” (Projection-based Heuristics)。*

*   **逻辑：** 假设这是一栋单进深的板楼（最典型场景）。
*   **算法伪代码：**
    1.  **定义进深：** 设定默认进深 `Depth = 10米`（按像素比例换算）。
    2.  **定义开间 (Bay)：** 将X轴上的每一列窗户视为一个“房间”的中心。
    3.  **生成轴网 (Grid)：**
        *   在每两个横向相邻窗户的中点，画一条垂直的**隔墙线**（Partition Wall）。
        *   在建筑Mask的最左和最右，画**外墙线**。
        *   在进深的一半处，画一条水平的**走廊/内墙线**。
    4.  **生成门：** 在推断出的房间背面（走廊侧）生成符号化的门。

### 步骤五：DXF文件输出 (Export)
*利用 `ezdxf` 库将上述几何数据写入文件。*

*   **图层设置 (Layers)：**
    *   `WALL` (白色, 线宽0.5): 绘制外轮廓和内部隔墙。
    *   `WINDOW` (青色): 对应识别到的窗户位置，插入块（Block）。
    *   `ANNOTATION` (黄色): 标注房间可能的名称（如根据窗户大小猜测：大窗->Living Room, 小窗->Bedroom/Toilet）。
*   **保存：** 输出 `project_output.dxf`。

---

## 4. 给Coding AI的直接提示词 (Prompt Template)

**刘博，您可以直接复制下面的文字发送给您的AI程序员：**

```markdown
Role: 你是一位精通Python、OpenCV、Computer Vision和AutoCAD自动化开发的资深工程师。

Objective: 我需要你帮我实现一个"街景立面转CAD及结构风险评估"的MVP Demo系统。

Input: 本地路径的一张JPG建筑立面照片。

Task Breakdown:
请编写一个完整的Python脚本（main.py），使用面向对象编程，包含以下Class：

1. ImageProcessor:
   - 使用opencv读取图片。
   - 实现一个简单的按照灰度阈值或Canny边缘提取建筑主体轮廓的方法。
   - *Mock数据模式*：为了演示代码跑通，如果暂时没有训练好的YOLO模型，请在代码中手动Mock（硬编码）几个矩形坐标来代表识别到的[窗户]和[门]的Bounding Box，格式为(x, y, w, h)。

2. SemanticAnalyzer:
   - 接收bounding box数据。
   - 计算"窗墙比(WWR)"。
   - 实现一个函数 `check_soft_story_risk()`: 如果底层（图像下部1/N区域）的开口宽度总和超过建筑总宽度的60%，返回True。
   - 估算层数（根据窗户在Y轴的分布聚类）。

3. LayoutGenerator (核心):
   - 这是一个简化的规则生成器。
   - 假设建筑进深为固定值（例如按比例换算为12000mm）。
   - 根据窗户的X轴中心，推断"开间(Bay)"。
   - 在相邻窗户中间生成"隔墙"坐标。
   - 生成外墙坐标。
   - 数据结构输出为简单的几何线条列表 [(start_x, start_y, end_x, end_y), ...]。

4. DxfExporter:
   - 使用 `ezdxf` 库。
   - 将LayoutGenerator生成的线条画在 "WALL" 图层。
   - 将识别到的窗户画在 "WINDOW" 图层。
   - 保存为 "result.dxf"。

Constraints:
- 代码必须可直接运行，依赖库仅限：opencv-python, numpy, ezdxf。
- 请在代码中做好详细注释，说明每一步的工程逻辑（特别是从像素坐标到CAD坐标的转换逻辑）。
- 最后打印出一个JSON格式的Risk Report到控制台。

```
