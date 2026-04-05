#!/usr/bin/env python3
import os
import subprocess

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
SOURCE = "app/src/lib/assets/apatosaurus_scroll.png"
OUTPUT_DIR = "app/static/icons"


def convert_png_to_icon(source_path, output_path, size):
    """Convert PNG to icon at specified size using ImageMagick."""
    try:
        # Use ImageMagick to resize PNG to fit within target size, then center on square canvas
        subprocess.run(
            [
                "convert",
                f"{source_path}",
                "-resize",
                f"{size}x{size}",
                "-background",
                "none",
                "-gravity",
                "center",
                "-extent",
                f"{size}x{size}",
                f"png:{output_path}",
            ],
            check=True,
            capture_output=True,
        )
        print(f"✓ Generated {size}x{size} icon")
        return True
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        print(f"✗ Failed to generate {size}x{size} icon: {e}")
        return False


def generate_icons():
    """Generate all icon sizes from the source PNG."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(SOURCE):
        print(f"✗ Source PNG not found: {SOURCE}")
        return False

    print(f"Generating square icons from {SOURCE}...")

    success_count = 0
    for size in SIZES:
        output_path = os.path.join(OUTPUT_DIR, f"icon-{size}x{size}.png")
        if convert_png_to_icon(SOURCE, output_path, size):
            success_count += 1

    print(f"\n✓ Generated {success_count}/{len(SIZES)} icons")
    return success_count == len(SIZES)


if __name__ == "__main__":
    success = generate_icons()
    exit(0 if success else 1)
