# 快速开始指南 (Quick Start Guide)

## 一键启动 (One-Click Start)

### 1. 安装依赖 (Install Dependencies)

```bash
pip install -r requirements.txt
```

需要的包: fastapi, uvicorn, opencv-python, ezdxf, numpy, pandas

### 2. 验证安装 (Verify Installation)

```bash
python3 test_pipeline.py
```

应该看到: `✅ ALL TESTS PASSED`

### 3. 启动服务器 (Start Server)

```bash
cd backend
python3 main.py
```

看到以下信息表示成功:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 4. 打开浏览器 (Open Browser)

访问: http://localhost:8000

### 5. 使用系统 (Use the System)

1. **上传图片**: 点击 "Upload Image" 按钮
2. **运行分析**: 点击 "Run Analysis" 按钮
3. **查看结果**: 
   - 左侧查看风险评估指标
   - 中间查看处理后的图像
   - 点击 "Download DXF" 下载CAD文件

---

## 功能说明 (Features)

### 风险评估指标 (Risk Metrics)

- **窗墙比 (WWR)**: 窗户面积 / 建筑立面面积
- **层数 (Stories)**: 通过窗户Y轴聚类估算
- **底层开口率 (Ground Floor Opening Ratio)**: 底层开口宽度 / 建筑宽度
- **软弱层风险 (Soft Story Risk)**: 底层开口率 > 60% 为 HIGH
- **结构类型 (Structure Type)**: 基于WWR和层数推断

### CAD文件内容 (CAD File Content)

生成的DXF文件包含:
- **WALL图层** (白色): 外墙、隔墙、走廊
- **WINDOW图层** (青色): 窗户位置
- **DOOR图层** (红色): 门位置

---

## 常见问题 (FAQ)

### Q: 需要YOLO模型吗？

A: 不需要。系统默认使用Mock模式，会生成模拟数据。这足以演示所有功能。

### Q: 如何使用真实的YOLO模型？

A: 在 `backend/core/image_processor.py` 中:
1. 将 `mock_mode` 设置为 `False`
2. 提供训练好的YOLOv8模型权重文件路径

### Q: 支持什么图片格式？

A: 支持常见格式: JPG, PNG, BMP等（OpenCV支持的所有格式）

### Q: DXF文件用什么软件打开？

A: 可以用AutoCAD, LibreCAD, FreeCAD等任何CAD软件打开

### Q: 端口8000被占用怎么办？

A: 修改 `backend/main.py` 最后一行的端口号

---

## 测试数据 (Test Data)

项目自带测试图片: `backend/test_data/test_building.jpg`

可以用这个图片测试系统功能。

---

## 系统要求 (System Requirements)

- Python 3.8+
- 2GB RAM (最小)
- 任何操作系统 (Windows, macOS, Linux)

---

## 故障排查 (Troubleshooting)

### 问题: 导入错误 (Import Error)

确保从 `backend/` 目录启动服务器:
```bash
cd backend
python3 main.py
```

### 问题: 端口被占用

```bash
lsof -ti:8000 | xargs kill -9  # macOS/Linux
```

### 问题: 图片上传失败

检查 `backend/uploads/` 目录是否存在且可写

---

## 获取帮助 (Get Help)

查看详细文档: `README.md`

查看完成总结: `COMPLETION_SUMMARY.md`
