"""Subsample a YOLO-format fire/smoke dataset so it trains in reasonable time on a CPU.

    python prepare_dataset.py --src datasets/raw --train 3000 --val 600

Expects <src>/{train,val|valid|test}/{images,labels}  (D-Fire and Roboflow exports both fit).
Writes datasets/firesmoke/ and a data.yaml for train.py.
Class order defaults to D-Fire (0=smoke, 1=fire); for Roboflow exports pass --names matching their data.yaml.
"""

import argparse
import random
import shutil
from pathlib import Path

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}


def find_split(src: Path, candidates: list[str]) -> Path:
    for c in candidates:
        if (src / c / "images").is_dir():
            return src / c
    raise SystemExit(f"None of {candidates} found with an images/ folder under {src}")


def copy_subset(split: Path, out: Path, name: str, n: int, rng: random.Random) -> int:
    imgs = sorted(p for p in (split / "images").iterdir() if p.suffix.lower() in IMG_EXT)
    rng.shuffle(imgs)
    (out / name / "images").mkdir(parents=True, exist_ok=True)
    (out / name / "labels").mkdir(parents=True, exist_ok=True)
    for img in imgs[:n]:
        shutil.copy(img, out / name / "images" / img.name)
        label = split / "labels" / (img.stem + ".txt")
        # a missing label file is a valid "background" image (no fire/smoke)
        if label.exists():
            shutil.copy(label, out / name / "labels" / label.name)
    return min(n, len(imgs))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=Path("datasets/firesmoke"))
    ap.add_argument("--train", type=int, default=3000)
    ap.add_argument("--val", type=int, default=600)
    ap.add_argument("--names", default="smoke,fire", help="comma-separated class names in label-id order")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    rng = random.Random(a.seed)
    if a.out.exists():
        shutil.rmtree(a.out)
    nt = copy_subset(find_split(a.src, ["train"]), a.out, "train", a.train, rng)
    nv = copy_subset(find_split(a.src, ["val", "valid", "test"]), a.out, "val", a.val, rng)

    names = [n.strip() for n in a.names.split(",")]
    yaml = f"path: {a.out.resolve().as_posix()}\ntrain: train/images\nval: val/images\nnames:\n"
    yaml += "".join(f"  {i}: {n}\n" for i, n in enumerate(names))
    (a.out / "data.yaml").write_text(yaml)
    print(f"train={nt} val={nv} classes={names}\nNext: python train.py --data {a.out / 'data.yaml'} --imgsz 480 --epochs 30")


if __name__ == "__main__":
    main()
