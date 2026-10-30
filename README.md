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

**Model management**
- **Model versions page** – upload new weights, see accuracy and CPU speed side by side, and compare each version against the live one (mAP change in points, "2.6x faster")
- **Hot swap, no restart** – activate a version and every camera uses it on its very next frame; the old model keeps serving until the new one has loaded cleanly, so a bad file can never take detection down
- **One-click rollback** to whichever model was live before
- Uploads are validated before they are accepted: the file must load as YOLO, must contain a fire or smoke class (COCO-style models are rejected), and duplicates are detected by hash

**Also**
- **Analyze Media** – drag-and-drop images or videos with a confidence timeline and peak frame
- **Browser Cam** – quick webcam test from the browser over WebSocket
- **Dashboard** – animated metrics, 24-hour chart (in local time), camera health, recent incidents
- **Light / Dark / System theme** – follows the OS live, remembers your choice, no flash on load, WCAG AA contrast in both themes
- Light-weight SQLite database with automatic in-place migration, model health reporting, 56 automated tests

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
**YOLO11s** fine-tuned on the full D-Fire training set (14,122 images), 40 epochs at 640 px on a Google Colab T4 GPU. Evaluated on the **4,302-image held-out test split**, which was never used for training or model selection.

| Class | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|---|
| all | 0.761 | 0.695 | 0.767 | 0.439 |
| smoke | 0.814 | 0.764 | 0.829 | 0.509 |
| fire | 0.708 | 0.627 | 0.706 | 0.369 |

Figures: [training curves](docs/model/results.png) · [confusion matrix](docs/model/confusion_matrix.png) · [precision-recall curve](docs/model/BoxPR_curve.png)

**Improvement over the first model** (YOLO11n, 3,000-image subset, 480 px, trained on CPU; scored on a 600-image validation subset, so the two evaluation sets differ and the test set is the more reliable one):

| | First model | Current model |
|---|---|---|
| Fire recall | 0.482 | **0.627** |
| Fire mAP50 | 0.541 | **0.706** |
| Smoke recall | 0.673 | **0.764** |
| Overall mAP50 | 0.645 | **0.767** |

**Same 90 unseen test images through the running API** (30 fire, 30 smoke-only, 30 with neither; confidence 0.3):

| | First model | Current model |
|---|---|---|
| Fire found | 24 / 30 | **29 / 30** |
| Smoke found | 22 / 30 | **29 / 30** |
| False alarms on empty images | 3 / 30 | **1 / 30** |

**Speed on a CPU-only PC (Intel i5-9500):** median 175 ms per image, 90th percentile 294 ms, through the API. This model is roughly 3x heavier than the first one; if several cameras lag, lower `SMOKESHIELD_WORKER_FPS`.

**Reading the numbers honestly**
- Fire is harder than smoke: flames vary hugely in size, brightness and shape, and small distant fires are easy to miss. Recall of 0.63 means a single frame can still miss a fire, which is why alarms use temporal confirmation across several frames.
- The training curves show validation loss still falling and mAP still rising at epoch 40 (no overfitting), so a longer run would likely add a little more.
- The confusion matrix is computed by Ultralytics at a confidence of 0.001 so that mAP can be integrated over all thresholds. The large "background" counts therefore reflect that very low threshold, not the behaviour at the 0.3 - 0.4 confidence the app actually uses. Smoke/fire mix-ups are tiny (18 and 20 boxes).
- The first model's weights are kept as `backend/models/best_v1.pt` for rollback.

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
| GET | `/api/models` | registered model versions with accuracy, speed and which one is live |
| POST | `/api/models` | upload weights (multipart `file`, `name`, optional `notes` and metrics as fractions); validated, not activated |
| PATCH | `/api/models/{id}` | edit name, notes and accuracy numbers |
| POST | `/api/models/{id}/activate` | hot-swap the live model |
| POST | `/api/models/rollback` | re-activate the previously live model |
| POST | `/api/models/{id}/benchmark` | re-measure speed and classes on this server |
| DELETE | `/api/models/{id}` | remove a version and its file (not the live one) |
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
56 tests cover confirmation logic, zones, camera CRUD and validation, a video-file camera end to end (upload → worker → confirmed fire → incident), review and export, migration of old databases, and the model registry (upload rules, hot swap, rollback, failed activation keeping the current model, exact class matching, cache headers). They use a fake detector and a temporary data folder, so they need no PyTorch, weights or real data.

## Project layout
```
backend/
  app/
    api/        one router per area: cameras, incidents, stats, detect, events, health
    services/   detector, camera_worker, camera_manager, model_manager, model_registry, confirmation, zones, incidents, imaging
    schemas/    request / response models
    db/         SQLAlchemy models, session, in-place migration
    config.py   main.py
  tests/  train.py  prepare_dataset.py
frontend/src/
  pages/        Dashboard, Monitor, Cameras, Incidents, Models, LiveMonitor, Analyze
  components/   Modal, Toast, StatusPill, Switch, Skeleton, ... plus cameras/ (tile, form, zone editor) and models/ (cards, upload form)
  hooks/        useEvents (shared WebSocket), useCameras, useFramePoll, useTheme
  lib/          api client, alarm sound
```

## Theming
Colors are CSS-variable tokens in `frontend/src/index.css` (`:root` = light, `.dark` = dark), mapped into Tailwind in `tailwind.config.js`, so components use ordinary classes (`bg-ink-900`, `text-slate-400`, `text-heading`) and switch themes automatically. To retheme the app, edit the token values. Rules of thumb:
- Use `text-heading` for headings (not `text-white`); keep `text-white` only on solid colored backgrounds such as the red or orange buttons.
- Anything drawn over video or photos gets the `on-media` class, which keeps dark tokens inside it so overlays stay readable in light mode.
- Charts take colors from the same variables (`rgb(var(--ink-700))`); only `<canvas>` drawing uses fixed colors.

## Model registry notes
- Weights already in `backend/models/` are registered automatically on first start (`best.pt` becomes the live model); uploads are stored in `backend/data/models/`.
- The speed shown is the median over a few runs on this server. It reads higher while cameras are busy, so press *Benchmark* on a quiet server for a fair comparison.
- Accuracy numbers are typed in by whoever trained the model (from the validation table); the server cannot compute them without the dataset.
- Class names are matched exactly (`fire`, `flame`, `smoke`...), never as substrings, so a model that detects a "fire hydrant" is not mistaken for a fire detector.

## Security notes
There is no login yet, so run it on a trusted network. **Model uploads deserve extra care:** PyTorch `.pt` files can execute code when loaded, so anyone who can reach the API could run code on the server by uploading a crafted file. Only expose the app to people you trust, or set `SMOKESHIELD_MODEL_UPLOAD_ENABLED=false` (models already in `backend/models/` are still registered and can be switched). Camera URLs may point at private IPs by design (LAN cameras); only `rtsp`, `rtsps`, `rtmp`, `http`, `https` schemes are accepted. Stream passwords are stored in the local SQLite file in plain text and masked in API responses.

## Ideas to extend
Telegram / e-mail / SMS alerts, login with roles, incident video clips, model-version management, ONNX / OpenVINO export for edge devices.
