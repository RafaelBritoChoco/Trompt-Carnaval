#!/usr/bin/env python3
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public" / "sources"
OUTPUT_DIR = ROOT / "tmp" / "omr-inputs"

# Crop away the heavy page frame, then enlarge the music itself so the OMR
# engine sees a reliable staff interline rather than the surrounding artwork.
SOURCES = {
    "vai-malandra": {
        "filename": "vai-malandra.png",
        "crop": (50, 285, 1755, 1245),
        "scale": 3.0,
        "staff_lines": [(363, 486), (831, 952), (1298, 1420), (1765, 1887), (2232, 2355), (2700, 2822)],
    },
    "eu-vou-pro-baile-da-gaiola": {
        "filename": "eu-vou-pro-baile-da-gaiola.jpeg",
        "crop": (45, 225, 1555, 1100),
        "scale": 2.25,
        "staff_lines": [(332, 440), (710, 820), (1090, 1198), (1470, 1578), (1848, 1958)],
    },
    "morto-muito-louco": {
        "filename": "morto-muito-louco.png",
        "crop": (60, 400, 1760, 1225),
        "scale": 2.0,
        "staff_lines": [(191, 365), (832, 1006), (1474, 1648)],
    },
}


def staff_only(image, staff_lines: list[tuple[int, int]]):
    """Remove printed piston labels while preserving complete note stems."""
    cleaned = image.copy()
    cleaned[:] = 255
    for first_line, last_line in staff_lines:
        top = max(0, first_line - 70)
        bottom = min(image.shape[0], last_line + 95)
        cleaned[top:bottom, :] = image[top:bottom, :]
    return cleaned


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for stem, config in SOURCES.items():
        filename = config["filename"]
        crop = config["crop"]
        scale = config["scale"]
        image = cv2.imread(str(SOURCE_DIR / filename), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise FileNotFoundError(SOURCE_DIR / filename)
        x1, y1, x2, y2 = crop
        cropped = image[y1:y2, x1:x2]
        enlarged = cv2.resize(cropped, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        prepared = cv2.copyMakeBorder(enlarged, 80, 80, 80, 80, cv2.BORDER_CONSTANT, value=255)
        output = OUTPUT_DIR / f"{stem}.png"
        if not cv2.imwrite(str(output), prepared):
            raise RuntimeError(f"Could not write {output}")
        print(f"{stem}: {prepared.shape[1]}x{prepared.shape[0]} -> {output}")

        music_only = staff_only(prepared, config["staff_lines"])
        music_output = OUTPUT_DIR / f"{stem}-staff-only.png"
        if not cv2.imwrite(str(music_output), music_only):
            raise RuntimeError(f"Could not write {music_output}")
        print(f"{stem}: staff-only -> {music_output}")


if __name__ == "__main__":
    main()
