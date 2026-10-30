import asyncio
import base64
import logging
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import BASE_DIR, settings
from .database import Incident, SessionLocal, init_db, utcnow
from .detector import DetectorLike, YoloDetector, annotate, encode_jpeg, timed_predict
from .schemas import (
    Detection,
    HealthOut,
    HourBucket,
    ImageResult,
    IncidentOut,
    StatsOut,
    TimelinePoint,
    VideoResult,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("smokeshield")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if not hasattr(app.state, "detector"):  # tests inject their own
        detector = YoloDetector(settings.model_file, settings.image_size, settings.device)
        await asyncio.to_thread(detector.load)
        app.state.detector = detector
    yield


app = FastAPI(title="SmokeShield API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/snapshots", StaticFiles(directory=settings.snapshot_dir), name="snapshots")


# ---------- helpers ----------

def get_db():
    with SessionLocal() as db:
        yield db


def get_detector() -> DetectorLike:
    det: DetectorLike = app.state.detector
    if not det.loaded:
        raise HTTPException(503, f"Model weights not found at {settings.model_file}. See README for training/setup.")
    return det


def decode_image(data: bytes) -> np.ndarray:
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Could not decode image")
    return frame


def data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


def log_incident(frame: np.ndarray, dets: list[Detection], source: str) -> Incident | None:
    """Persist the strongest detection with an annotated snapshot."""
    if not dets:
        return None
    top = max(dets, key=lambda d: d.confidence)
    name = f"{uuid.uuid4().hex}.jpg"
    (settings.snapshot_dir / name).write_bytes(encode_jpeg(annotate(frame, dets)))
    with SessionLocal() as db:
        inc = Incident(label=top.label, confidence=top.confidence, source=source, snapshot=name)
        db.add(inc)
        db.commit()
        return inc


def to_out(inc: Incident) -> IncidentOut:
    return IncidentOut(
        id=inc.id,
        created_at=inc.created_at,
        label=inc.label,  # type: ignore[arg-type]
        confidence=inc.confidence,
        source=inc.source,  # type: ignore[arg-type]
        snapshot_url=f"/snapshots/{inc.snapshot}" if inc.snapshot else None,
    )


async def read_upload(file: UploadFile) -> bytes:
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
    return data


# ---------- routes ----------

@app.get("/api/health", response_model=HealthOut)
def health():
    det: DetectorLike = app.state.detector
    return HealthOut(
        status="ok" if det.loaded else "model_missing",
        model_loaded=det.loaded,
        model_path=str(settings.model_file),
        classes=det.classes,
        device=det.device,
    )


@app.post("/api/detect/image", response_model=ImageResult)
async def detect_image(
    file: UploadFile = File(...),
    conf: float = Query(settings.confidence, ge=0.05, le=0.95),
    detector: DetectorLike = Depends(get_detector),
):
    frame = decode_image(await read_upload(file))
    dets, ms = await asyncio.to_thread(timed_predict, detector, frame, conf)
    inc = log_incident(frame, dets, "image")
    return ImageResult(
        detections=dets,
        latency_ms=ms,
        alert=bool(dets),
        annotated=data_url(encode_jpeg(annotate(frame, dets))),
        incident_id=inc.id if inc else None,
    )


def _analyse_video(path: str, detector: DetectorLike, conf: float) -> VideoResult:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise HTTPException(400, "Could not open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    step = max(1, total // settings.max_video_frames) if total else 5

    timeline: list[TimelinePoint] = []
    fire_frames = smoke_frames = analysed = 0
    peak_conf, peak_frame, peak_dets = 0.0, None, []
    idx = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step == 0:
                dets = detector.predict(frame, conf)
                analysed += 1
                f = max((d.confidence for d in dets if d.label == "fire"), default=0.0)
                s = max((d.confidence for d in dets if d.label == "smoke"), default=0.0)
                fire_frames += f > 0
                smoke_frames += s > 0
                timeline.append(TimelinePoint(time_s=round(idx / fps, 2), fire=f, smoke=s))
                if max(f, s) > peak_conf:
                    peak_conf, peak_frame, peak_dets = max(f, s), frame, dets
            idx += 1
    finally:
        cap.release()

    inc = log_incident(peak_frame, peak_dets, "video") if peak_frame is not None else None
    return VideoResult(
        frames_analysed=analysed,
        duration_s=round(idx / fps, 2),
        fire_frames=fire_frames,
        smoke_frames=smoke_frames,
        peak_confidence=round(peak_conf, 4),
        alert=peak_frame is not None,
        timeline=timeline,
        peak_frame=data_url(encode_jpeg(annotate(peak_frame, peak_dets))) if peak_frame is not None else None,
        incident_id=inc.id if inc else None,
    )


@app.post("/api/detect/video", response_model=VideoResult)
async def detect_video(
    file: UploadFile = File(...),
    conf: float = Query(settings.confidence, ge=0.05, le=0.95),
    detector: DetectorLike = Depends(get_detector),
):
    data = await read_upload(file)
    suffix = Path(file.filename or "clip.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
    try:
        return await asyncio.to_thread(_analyse_video, tmp.name, detector, conf)
    finally:
        Path(tmp.name).unlink(missing_ok=True)


@app.websocket("/ws/stream")
async def stream(ws: WebSocket, conf: float = settings.confidence):
    """Client sends JPEG frames (binary); server replies with JSON detections per frame.

    The client should wait for each reply before sending the next frame (natural back-pressure).
    """
    await ws.accept()
    det: DetectorLike = app.state.detector
    if not det.loaded:
        await ws.send_json({"error": "model_missing"})
        await ws.close(code=1011)
        return
    last_logged: dict[str, float] = {}
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes") is None:
                if msg.get("text"):  # allow live threshold changes: {"conf": 0.5}
                    try:
                        import json

                        conf = min(0.95, max(0.05, float(json.loads(msg["text"])["conf"])))
                    except (ValueError, KeyError, TypeError):
                        pass
                continue
            frame = cv2.imdecode(np.frombuffer(msg["bytes"], np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                continue
            dets, ms = await asyncio.to_thread(timed_predict, det, frame, conf)
            incident_id = None
            now = time.monotonic()
            fresh = [d for d in dets if now - last_logged.get(d.label, -1e9) >= settings.incident_cooldown]
            if fresh:
                for d in fresh:
                    last_logged[d.label] = now
                inc = await asyncio.to_thread(log_incident, frame, dets, "live")
                incident_id = inc.id if inc else None
            await ws.send_json(
                {
                    "detections": [d.model_dump() for d in dets],
                    "latency_ms": ms,
                    "alert": bool(dets),
                    "incident_id": incident_id,
                }
            )
    except WebSocketDisconnect:
        pass


@app.get("/api/incidents", response_model=list[IncidentOut])
def list_incidents(
    limit: int = Query(50, ge=1, le=500),
    label: str | None = Query(None, pattern="^(fire|smoke)$"),
    db: Session = Depends(get_db),
):
    q = select(Incident).order_by(Incident.created_at.desc()).limit(limit)
    if label:
        q = q.where(Incident.label == label)
    return [to_out(i) for i in db.scalars(q)]


@app.delete("/api/incidents/{incident_id}", status_code=204)
def delete_incident(incident_id: int, db: Session = Depends(get_db)):
    inc = db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    if inc.snapshot:
        (settings.snapshot_dir / inc.snapshot).unlink(missing_ok=True)
    db.delete(inc)
    db.commit()


@app.get("/api/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Incident)))
    now = utcnow()
    start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=23)
    buckets = {start + timedelta(hours=i): {"fire": 0, "smoke": 0} for i in range(24)}
    for r in rows:
        key = r.created_at.replace(minute=0, second=0, microsecond=0)
        if key in buckets:
            buckets[key][r.label] += 1
    return StatsOut(
        total=len(rows),
        fire=sum(r.label == "fire" for r in rows),
        smoke=sum(r.label == "smoke" for r in rows),
        last_24h=sum(b["fire"] + b["smoke"] for b in buckets.values()),
        avg_confidence=round(sum(r.confidence for r in rows) / len(rows), 4) if rows else 0.0,
        hourly=[HourBucket(start=k.strftime("%Y-%m-%dT%H:00:00Z"), **v) for k, v in buckets.items()],
    )


# Serve the built frontend (npm run build) when present, for single-process deployment.
_dist = BASE_DIR.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
