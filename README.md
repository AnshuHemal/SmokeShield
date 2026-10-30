# SmokeShield — Fire & Smoke Detection with YOLO

Real-time fire and smoke detection platform: a **FastAPI + Ultralytics YOLO** backend and a **React + TypeScript + Tailwind** dashboard.

## Features
- **Live Monitor** – webcam frames streamed over WebSocket, boxes drawn in real time, alarm sound, FPS/latency stats
- **Analyze Media** – drag-and-drop images or videos; video results include a confidence timeline and peak frame
- **Incident log** – every detection saved to SQLite with an annotated snapshot; filter, preview, delete, export CSV
- **Dashboard** – totals, 24-hour chart, recent incidents
- Adjustable confidence threshold, model health reporting, automated API tests

## Architecture
```
Browser (React) ──REST──► FastAPI ──► YOLO (Ultralytics) ──► SQLite + snapshots
        └────WebSocket /ws/stream (JPEG frames ⇄ JSON detections)────┘
```

| Layer    | Tech |
|----------|------|
| Model    | Ultralytics YOLO (YOLO11n by default, any YOLOv8+ weights work) |
| Backend  | Python 3.11, FastAPI, Uvicorn, SQLAlchemy, OpenCV, pydantic-settings |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Recharts, lucide-react |

## Quick start

### 1. Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows  (source .venv/bin/activate on Linux/macOS)
pip install -r requirements.txt
cp .env.example .env            # optional
```
Put your trained weights at **`backend/models/best.pt`** (classes must include `fire` and `smoke`), then:
```bash
uvicorn app.main:app --reload --port 8000
```
Interactive API docs: http://localhost:8000/docs

> No weights yet? Train them (below). Without `best.pt` the API runs but reports `model_missing` and the UI shows a banner.

### 2. Frontend
```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```
For a single-process deployment run `npm run build`; the backend then serves `frontend/dist` at `/`.

### 3. Train your model
Download a fire/smoke dataset in YOLO format (e.g. D-Fire, or Roboflow Universe "fire smoke detection"), then:
```bash
cd backend
python train.py --data path/to/data.yaml --base yolo11n.pt --epochs 50
```
The best weights are copied to `models/best.pt` and validation mAP is printed — include it in your report.

### 4. Docker (optional)
```bash
docker compose up --build        # http://localhost:8000
```
Mount your weights in `backend/models/best.pt`; the incident DB and snapshots persist in a named volume. (Docker setup is untested on this machine.)

## Model results
YOLO11n fine-tuned on a 3,000-image subset of D-Fire (600 validation images), 30 epochs, 480 px, CPU only.

| Class | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|---|
| all | 0.726 | 0.578 | 0.645 | 0.343 |
| smoke | 0.807 | 0.673 | 0.749 | 0.426 |
| fire | 0.646 | 0.482 | 0.541 | 0.260 |

Sanity check on 30 unseen test images per group (conf 0.3): fire found in 24/30, smoke found in 22/30, false alarms on 3/30 empty images. Inference is about 35 ms/image on the CPU.
Training on the full 14k-image set and a larger model (`yolo11s`) would raise recall, especially for fire.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | model status, classes, device |
| POST | `/api/detect/image?conf=0.4` | multipart image → detections + annotated image |
| POST | `/api/detect/video?conf=0.4` | multipart video → timeline + peak frame |
| WS | `/ws/stream?conf=0.4` | binary JPEG in → JSON detections out |
| GET | `/api/incidents` | list (filter `label=fire\|smoke`) |
| DELETE | `/api/incidents/{id}` | remove incident + snapshot |
| GET | `/api/stats` | totals and hourly buckets |

## Tests
```bash
cd backend && pytest
```
Tests use a fake detector, so they run without PyTorch or weights.

## Project layout
```
backend/   app/ (main, detector, database, schemas, config)  train.py  tests/
frontend/  src/ (pages, components, lib/api.ts)
```

## Ideas to extend
Telegram/e‑mail/SMS alerts on new incidents, RTSP/IP camera input, multi-camera grid, Docker Compose, export to ONNX/TensorRT for edge devices.
