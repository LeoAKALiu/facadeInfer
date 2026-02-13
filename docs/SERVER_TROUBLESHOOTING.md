# 云服务器崩溃/断联排查（优先排 OOM）

下面这套流程的目标是：**确认是不是 OOM（内存不足）导致系统把进程杀了/直接卡死**，以及定位是哪个进程占用内存。

## 1) 先看系统是否发生 OOM Kill

在云服务器重新连上后执行：

```bash
free -h
uptime
```

查看上一次启动（或上一次崩溃前）的内核日志：

```bash
sudo dmesg -T | tail -n 200
sudo journalctl -k -b -1 --no-pager | tail -n 200
sudo journalctl -k -b -1 --no-pager | grep -i -E "oom|out of memory|killed process" || true
```

如果看到类似：
- `Out of memory: Killed process ...`
- `Killed process 1234 (python3) total-vm:... rss:...`

基本可以直接判定是 OOM。

## 2) 找出谁在吃内存

```bash
ps aux --sort=-rss | head -n 20
```

如果你用的是 systemd 启动：

```bash
systemctl status <your-service-name> --no-pager
journalctl -u <your-service-name> -b --no-pager | tail -n 200
```

## 3) 结合本项目的高风险点

### 常驻内存风险（启动就加载）

这些库/模块在小内存机器上很容易导致启动即内存飙升：
- OpenCV (`cv2`)
- torch / transformers（模型加载）
- Node/Vite build（`npm install` / `npm run build`）

我已经把后端改成：**默认不在启动时 import/初始化 `ImageProcessor`（OpenCV/torch）和 `LayoutGenerator`（ezdxf）**，只保留 demo 所需的 `SemanticAnalyzer`。

## 4) 建议的“最小风险”部署方式

### 方式 A：只跑后端（先确认稳定）

```bash
python3 run_server.py
```

### 方式 B：前端 build 在内存更大的机器上完成，再把 `frontend/dist` 上传到服务器

服务器上只负责跑 FastAPI（避免 Node build 过程占用内存导致断联）。

## 5) 防止再次断联（止血方案）

### (可选) 增加 swap（小内存机非常推荐）

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
```

> 注意：具体 swap 大小按你的磁盘空间调整。

### 限制 uvicorn worker 数量

不要一上来开多 worker；默认 1 个最稳。确认无 OOM 后再评估扩容/反代。

