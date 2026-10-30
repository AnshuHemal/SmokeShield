# SmokeShield — Fire & Smoke Detection with YOLO

Real-time fire and smoke detection platform: a **FastAPI + Ultralytics YOLO** backend and a **React + TypeScript + Tailwind** dashboard.

## Features
**Monitoring**
- **Multi-camera grid** – live annotated view of every camera with status (Monitoring / Smoke / Fire / Offline / Paused), FPS and latency, a pulsing alarm state, and a one-click expanded view
- **Camera management** – add, edit, pause and delete cameras; sources are **RTSP/HTTP streams, uploaded video files (looped, processed on the server) or a server webcam**; stream passwords are masked in the API
- **Auto-reconnect** – each camera runs in its own worker with exponential back-off, so one dead camera never affects the others
- **Real-time toasts and alarm sound** from anywhere in the app when a hazard is confirmed

**Fewer false alarms**
- **Temporal confirmation** – an alarm needs the hazard in *N of the last M frames* (default 3 of 5); one-frame glitches never trigger
- **Per-camera sensitivity** – confidence, confirmation window, cooldown, with *Sensitive / Balanced / Strict* presets
- **Detection zones** – draw a polygon on a live preview; detections outside it are ignored
- **Incident review** – mark each incident *Real* or *False alarm*; the dashboard shows the false-alarm rate, and reviewed incidents export as a **YOLO training set** (real = boxes, false alarm = negative example) for retraining

**Also**
- **Analyze Media** – drag-and-drop images or videos with a confidence timeline and peak frame
- **Browser Cam** – quick webcam test from the browser over WebSocket
- **Dashboard** – animated metrics, 24-hour chart (in local time), camera health, recent incidents
- Light-weight SQLite database with automatic in-place migration, model health reporting, 23 automated tests

## Architecture
```
                  ┌── CameraWorker (thread per camera) ──┐
RTSP / file / USB ┤   grab → YOLO → zone → N-of-M check  ├─► incidents (SQLite + snapshots)
                  └──────────────┬───────────────────────┘
                                 │ shared, lock-protected model
Browser (React) ◄─ REST (cameras, incidents, stats, latest frame)
        ◄─────────── WebSocket /ws/events  (camera states + incident alerts, 1 Hz)
        ◄──────────► WebSocket /ws/stream  (browser-webcam test)
```

| Layer    | Tech |
|----------|------|
| Model    | Ultralytics YOLO (YOLO11n by default, any YOLOv8+ weights work) |
| Backend  | Python 3.11, FastAPI, Uvicorn, SQLAlchemy, OpenCV, pydantic-settings |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Recharts, lucide-react |

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
| GET | `/api/health` | model status, classes, device, cameras online |
| GET/POST | `/api/cameras` | list / create a camera |
| GET/PATCH/DELETE | `/api/cameras/{id}` | read / partially update / remove |
| GET | `/api/cameras/status` | live state of every camera |
| GET | `/api/cameras/{id}/frame` | latest annotated frame (JPEG, 204 if none yet) |
| GET | `/api/cameras/{id}/snapshot` | clean frame, used by the zone editor |
| POST | `/api/cameras/preview` | grab one frame from a not-yet-saved source |
| POST | `/api/cameras/upload-video` | upload a video file to use as a camera source |
| GET | `/api/incidents` | list; filters `label`, `status`, `camera_id`, `limit`, `offset` |
| PATCH | `/api/incidents/{id}/review` | `{"status": "real" \| "false_alarm" \| "new"}` |
| GET | `/api/incidents/export/training` | reviewed incidents as a YOLO dataset (zip) |
| DELETE | `/api/incidents/{id}` | remove incident + snapshots |
| GET | `/api/stats` | totals, hourly buckets, review metrics, camera counts |
| POST | `/api/detect/image?conf=0.4` | image → detections + annotated image |
| POST | `/api/detect/video?conf=0.4` | video → timeline + peak frame |
| WS | `/ws/events` | camera states and new-incident events |
| WS | `/ws/stream?conf=0.4` | browser webcam: binary JPEG in → JSON detections out |

### Choosing sensitivity
| Preset | Confidence | Confirmation | Use for |
|---|---|---|---|
| Sensitive | 30% | 2 of 3 frames | kitchens, labs - miss nothing |
| Balanced | 40% | 3 of 5 frames | offices, warehouses |
| Strict | 55% | 4 of 6 frames | outdoors, steam / dust / headlights |

At the default 4 inferences per second, "3 of 5" confirms a real fire in about 0.75 s. Change the rate with `SMOKESHIELD_WORKER_FPS`.

## Tests
```bash
cd backend && pytest
```
23 tests cover confirmation logic, zones, camera CRUD and validation, a video-file camera end to end (upload → worker → confirmed fire → incident), review and export, and migration of old databases. They use a fake detector and a temporary data folder, so they need no PyTorch, weights or real data.

## Project layout
```
backend/
  app/
    api/        one router per area: cameras, incidents, stats, detect, events, health
    services/   detector, camera_worker, camera_manager, confirmation, zones, incidents, imaging
    schemas/    request / response models
    db/         SQLAlchemy models, session, in-place migration
    config.py   main.py
  tests/  train.py  prepare_dataset.py
frontend/src/
  pages/        Dashboard, Monitor, Cameras, Incidents, LiveMonitor, Analyze
  components/   Modal, Toast, StatusPill, Switch, Skeleton, ... and cameras/ (tile, form, zone editor)
  hooks/        useEvents (shared WebSocket), useCameras, useFramePoll
  lib/          api client, alarm sound
```

## Security notes
There is no login yet, so run it on a trusted network. Camera URLs may point at private IPs by design (LAN cameras); only `rtsp`, `rtsps`, `rtmp`, `http`, `https` schemes are accepted. Stream passwords are stored in the local SQLite file in plain text and masked in API responses.

## Ideas to extend
Telegram / e-mail / SMS alerts, login with roles, incident video clips, model-version management, ONNX / OpenVINO export for edge devices.
