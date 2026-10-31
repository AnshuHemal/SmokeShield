import asyncio
import json
import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect

from ..config import settings
from ..schemas.detection import ImageResult, TimelinePoint, VideoResult
from ..services.confirmation import AlarmTracker
from ..services.detector import DetectorLike, timed_predict
from ..services.episodes import EpisodeRecorder
from ..services.imaging import annotate, data_url, decode_image, encode_jpeg
from ..services.incidents import log_incident
from .deps import get_detector

router = APIRouter(tags=["detect"])


async def read_upload(file: UploadFile) -> bytes:
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
    return data


@router.post("/api/detect/image", response_model=ImageResult)
async def detect_image(
    file: UploadFile = File(...),
    conf: float = Query(settings.confidence, ge=0.05, le=0.95),
    detector: DetectorLike = Depends(get_detector),
):
    try:
        frame = decode_image(await read_upload(file))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    dets, ms = await asyncio.to_thread(timed_predict, detector, frame, conf)
    inc = await asyncio.to_thread(log_incident, frame, dets, "image")
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


@router.post("/api/detect/video", response_model=VideoResult)
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


ALLOWED_IMGSZ = {640, 960, 1280}


@router.websocket("/ws/stream")
async def stream(ws: WebSocket, conf: float = settings.confidence, imgsz: int | None = None):
    """Browser-webcam stream: the client sends JPEG frames (binary), the server replies with JSON per frame.

    The client should wait for each reply before sending the next frame (natural back-pressure).
    Reply fields:
      detections  confirmed boxes; `held: true` marks the last known box kept on screen after a missed frame
      pending     seen but not confirmed yet ("verifying")
      weak        below your confidence threshold: never alarms, shown so you can tune sensitivity
      alert       a hazard is confirmed right now
    A text message {"conf": 0.3, "imgsz": 960} changes the threshold / inference size while streaming.
    """
    await ws.accept()
    det: DetectorLike = ws.app.state.detector
    if not det.loaded:
        await ws.send_json({"error": "model_missing"})
        await ws.close(code=1011)
        return
    size = imgsz if imgsz in ALLOWED_IMGSZ else None
    tracker = AlarmTracker(settings.confirm_frames, settings.confirm_window)
    recorder = EpisodeRecorder("live", None, "Browser Cam", settings.incident_cooldown, ws.app.state.manager.publish)
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes") is None:
                if msg.get("text"):
                    try:
                        data = json.loads(msg["text"])
                        if "conf" in data:
                            conf = min(0.95, max(0.05, float(data["conf"])))
                        if "imgsz" in data:
                            size = data["imgsz"] if data["imgsz"] in ALLOWED_IMGSZ else None
                    except (ValueError, TypeError):
                        pass
                continue
            frame = cv2.imdecode(np.frombuffer(msg["bytes"], np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                continue
            # Run down to a low floor so sub-threshold candidates can be reported as "weak".
            raw, ms = await asyncio.to_thread(timed_predict, det, frame, min(conf, settings.weak_floor), size)
            strong = [d for d in raw if d.confidence >= conf]
            weak = [d for d in raw if d.confidence < conf]
            result = tracker.update(strong)
            await asyncio.to_thread(recorder.process, frame, result)
            await ws.send_json(
                {
                    "detections": [d.model_dump() for d in result.shown],
                    "pending": [d.model_dump() for d in result.pending],
                    "weak": [d.model_dump() for d in weak],
                    "latency_ms": ms,
                    "alert": bool(result.active),
                    "confirmed": sorted(result.active),
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        await asyncio.to_thread(recorder.close_all)  # leaving the page must not leave an incident looking "ongoing"
