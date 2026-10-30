"""Train / fine-tune a fire & smoke YOLO model.

    python train.py --data path/to/data.yaml --base yolo11n.pt --epochs 50

data.yaml must list two classes, e.g. `names: [fire, smoke]`. Public datasets: Roboflow Universe
("fire smoke detection"), D-Fire. The best weights are copied to models/best.pt, which the API loads.
"""

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data")
    ap.add_argument("--resume", metavar="LAST_PT", help="resume an interrupted run from its last.pt")
    ap.add_argument("--base", default="yolo11n.pt")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="")
    a = ap.parse_args()

    if a.resume:
        model = YOLO(a.resume)
        model.train(resume=True)  # reuses the original data/epochs/imgsz settings
    else:
        if not a.data:
            ap.error("--data is required unless --resume is given")
        model = YOLO(a.base)
        model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, device=a.device or None,
                    project="runs", name="smokeshield", exist_ok=True)
    metrics = model.val()
    print(f"mAP50={metrics.box.map50:.3f}  mAP50-95={metrics.box.map:.3f}")

    best = Path(model.trainer.best)  # Ultralytics may nest the run dir (runs/detect/...), so don't hardcode
    out = Path("models/best.pt")
    out.parent.mkdir(exist_ok=True)
    shutil.copy(best, out)
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
