"""Generate the Tauri icon set + refresh the legacy `assets/` icon files.

Source: the designer-authored Nexus primary mark at
`assets/nexus-ai-primary_no-background.png` (transparent). This script downsizes the
source into every PNG / ICO / ICNS frame Tauri, the Windows Store tile set,
and macOS expect, writing them under `desktop/src-tauri/icons/`. It also
rewrites the legacy assets under `assets/` so the VS Code extension manifest
and any historical reference to `assets/icon.png` / `assets/icon.ico` /
`assets/icon.svg` / `assets/sidebar-icon.svg` carries the new branding.

Every emitted frame preserves the source alpha (v1.9.0 T201): the mark is
downsized straight from the transparent source and never composited onto an
opaque fill, so no frame reads as a black box. A superellipse (squircle)
alpha mask then rounds each frame's silhouette for the OS taskbar / dock,
trimming only the corners -- the mask multiplies alpha, so transparent stays
transparent and opaque corners can never survive. The result is the
transparent, rounded brand icon the guide's floating mark expects.

Re-run after any branding refresh:

    python scripts/desktop/generate-icons.py

If the source asset is missing, the script falls back to a procedurally-
rendered teal-on-charcoal "N" mark so dev / CI builds keep working.
"""

from __future__ import annotations

import base64
import io
import struct
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

# Repository root resolved from this script's location.
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent
ICONS_DIR = ROOT / "desktop" / "src-tauri" / "icons"
ASSETS_DIR = ROOT / "assets"
SOURCE_PNG = ASSETS_DIR / "nexus-ai-primary_no-background.png"
SOURCE_MONO_PNG = ASSETS_DIR / "nexus-ai-primary_no-background.png"

# Brand colors for the procedural fallback.
BG = (15, 19, 24, 255)
FG = (10, 191, 191, 255)

# Superellipse (squircle) rounding. n ~ 4 is the Apple-style squircle: it keeps
# the edges nearly full and only rounds the corners, so a near-full-bleed mark
# reads as a clean rounded tile without being clipped. Masks are supersampled
# then downscaled so the rounded edge is anti-aliased, and cached by size.
_SUPERELLIPSE_EXPONENT = 4.0
_SUPERELLIPSE_SUPERSAMPLE = 4
_mask_cache: dict[int, Image.Image] = {}


def _superellipse_alpha_mask(size: int) -> Image.Image:
    """Return an anti-aliased 'L' mask (255 inside, 0 outside) for a squircle.

    The boundary is `|x/a|^n + |y/b|^n = 1` with `a = b = size/2` centered on
    the frame. Rather than test every pixel, each row's horizontal half-extent
    is solved directly (`x = a * (1 - |y/b|^n)^(1/n)`) and filled as one span,
    which is O(size) instead of O(size^2). The mask is built at
    `supersample`x and LANCZOS-downscaled so the rounded edge is smooth.
    """
    cached = _mask_cache.get(size)
    if cached is not None:
        return cached
    hi = max(1, size) * _SUPERELLIPSE_SUPERSAMPLE
    mask = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(mask)
    half = hi / 2.0
    n = _SUPERELLIPSE_EXPONENT
    for y in range(hi):
        ny = abs((y + 0.5 - half) / half)
        if ny >= 1.0:
            continue
        x_ext = half * (1.0 - ny**n) ** (1.0 / n)
        draw.line([(half - x_ext, y), (half + x_ext, y)], fill=255)
    result = mask.resize((size, size), Image.Resampling.LANCZOS)
    _mask_cache[size] = result
    return result


def _apply_rounded_corners(img: Image.Image) -> Image.Image:
    """Round an RGBA frame with the squircle mask, preserving transparency.

    The mask is multiplied into the existing alpha channel, so pixels that are
    already transparent stay transparent and the corners are forced to zero --
    the rounding only ever removes alpha, it never paints an opaque fill.
    """
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    mask = _superellipse_alpha_mask(img.size[0])
    r, g, b, a = img.split()
    rounded_alpha = ImageChops.multiply(a, mask)
    img.putalpha(rounded_alpha)
    return img


def _load_source() -> Image.Image | None:
    if not SOURCE_PNG.exists():
        return None
    img = Image.open(SOURCE_PNG)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    return img


def _load_mono_source() -> Image.Image | None:
    if not SOURCE_MONO_PNG.exists():
        return None
    img = Image.open(SOURCE_MONO_PNG)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    return img


def _png_to_svg(png_path: Path, svg_path: Path, size: int = 512) -> None:
    """Wrap a PNG as a minimal SVG that embeds it as a base64 data URI.

    This keeps `assets/icon.svg` + `assets/sidebar-icon.svg` valid drop-in
    replacements for the legacy Gemma Code hand-authored SVGs without
    requiring us to re-derive the X / node-and-arrow shapes in vector form.
    """
    payload = base64.b64encode(png_path.read_bytes()).decode("ascii")
    svg_path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">\n'
        f'  <image href="data:image/png;base64,{payload}" '
        f'width="{size}" height="{size}" />\n'
        f"</svg>\n",
        encoding="utf-8",
    )


def _procedural(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, size // 8)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=radius,
        fill=BG,
        outline=FG,
        width=max(1, size // 32),
    )
    try:
        font = ImageFont.truetype("arial.ttf", size=int(size * 0.55))
    except OSError:
        font = ImageFont.load_default()
    text = "N"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_w = right - left
    text_h = bottom - top
    draw.text(
        ((size - text_w) / 2 - left, (size - text_h) / 2 - top),
        text,
        font=font,
        fill=FG,
    )
    return img


def render_square(
    size: int, source: Image.Image | None, rounded: bool = True
) -> Image.Image:
    if source is None:
        img = _procedural(size)
    else:
        # Use Lanczos resampling so the soft-glow + ring details stay crisp at
        # 32 px while keeping the 256 px frame visually identical to the source.
        img = source.resize((size, size), Image.Resampling.LANCZOS)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    if rounded:
        img = _apply_rounded_corners(img)
    return img


def write_png(path: Path, size: int, source: Image.Image | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render_square(size, source).save(path, format="PNG")


def write_ico(path: Path, source: Image.Image | None) -> None:
    """ICO containing 16/32/48/64/128/256 px frames.

    Pillow's ICO writer picks the smallest frame that fits each requested
    size from the source image -- so we pass the largest rendering and the
    full size matrix in `sizes=`. Passing many small frames via
    `append_images=` does NOT pack multi-size ICOs reliably (it tends to
    keep only the first frame).
    """
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    largest = render_square(256, source)
    # BMP frames load via Win32 LoadImage; PNG-in-ICO often paints as the
    # generic application glyph on the Windows taskbar.
    try:
        largest.save(path, format="ICO", sizes=sizes, bitmap_format="bmp")
    except TypeError:
        largest.save(path, format="ICO", sizes=sizes)


def _build_icns_image_block(
    size: int,
    type_code: bytes,
    source: Image.Image | None,
) -> bytes:
    """Pack a single PNG image as an `icns` block (`type_code` + length + PNG)."""
    img = render_square(size, source)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    payload = buf.getvalue()
    return type_code + struct.pack(">I", 8 + len(payload)) + payload


def write_icns(path: Path, source: Image.Image | None) -> None:
    """Minimal ICNS file. Covers icp4/icp5/icp6 + ic07/ic08 frames."""
    blocks: list[bytes] = [
        _build_icns_image_block(16, b"icp4", source),
        _build_icns_image_block(32, b"icp5", source),
        _build_icns_image_block(64, b"icp6", source),
        _build_icns_image_block(128, b"ic07", source),
        _build_icns_image_block(256, b"ic08", source),
    ]
    body = b"".join(blocks)
    header = b"icns" + struct.pack(">I", 8 + len(body))
    path.write_bytes(header + body)


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    source = _load_source()
    if source is None:
        print(
            f"warning: {SOURCE_PNG} not found; using procedural fallback "
            f"art. Re-run after committing the source asset."
        )
    else:
        print(f"using source asset: {SOURCE_PNG} ({source.size[0]}x{source.size[1]})")

    pngs = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        # v1.9.0 Phase 9 (T034): the runtime window/taskbar icon the Tauri shell
        # loads via `include_bytes!("../icons/window-icon.png")` in lib.rs (also
        # the default source for the in-app <FloatingLogo/>). Emitting it here
        # keeps it from going stale on a rebrand -- it was previously
        # hand-committed and outside this generator.
        "window-icon.png": 256,
    }
    for name, size in pngs.items():
        write_png(ICONS_DIR / name, size, source)

    store = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in store.items():
        write_png(ICONS_DIR / name, size, source)

    write_ico(ICONS_DIR / "icon.ico", source)
    write_icns(ICONS_DIR / "icon.icns", source)

    written = sorted(p.name for p in ICONS_DIR.iterdir() if p.is_file())
    print(f"Wrote {len(written)} icon assets to {ICONS_DIR}")
    for name in written:
        print(f"  - {name}")

    _refresh_legacy_assets(source)


def _refresh_legacy_assets(source: Image.Image | None) -> None:
    """Rewrite the legacy `assets/` icon files with the new branding.

    `assets/icon.png` and `assets/icon.ico` are the VS Code extension manifest
    references (see `package.json` `"icon"` and `"viewsContainers"`). The two
    SVGs are kept as PNG-embedding wrappers so they stay valid drop-in
    replacements without re-authoring vector paths.
    """
    if source is None:
        print("warning: no source asset; skipping legacy `assets/` refresh.")
        return

    icon_png = ASSETS_DIR / "icon.png"
    icon_ico = ASSETS_DIR / "icon.ico"
    icon_svg = ASSETS_DIR / "icon.svg"
    sidebar_svg = ASSETS_DIR / "sidebar-icon.svg"

    # icon.png: 512x512 PNG -- the VS Code Marketplace + extension list use this.
    render_square(512, source).save(icon_png, format="PNG")

    # icon.ico: multi-frame ICO for any Windows-side use that still references it.
    write_ico(icon_ico, source)

    # icon.svg: PNG-embedded SVG so any historical reference resolves to the new mark.
    _png_to_svg(icon_png, icon_svg, size=512)

    # sidebar-icon.svg: VS Code sidebar viewContainer icon. Use the monochrome
    # variant when it exists; that matches VS Code's monochrome-icon UX
    # (Codicons render in a single foreground colour).
    mono = _load_mono_source()
    if mono is not None:
        mono_png = ASSETS_DIR / ".sidebar-icon.png"
        try:
            mono.resize((512, 512), Image.Resampling.LANCZOS).save(mono_png, format="PNG")
            _png_to_svg(mono_png, sidebar_svg, size=512)
        finally:
            if mono_png.exists():
                mono_png.unlink()
    else:
        _png_to_svg(icon_png, sidebar_svg, size=512)

    print(f"Refreshed legacy assets in {ASSETS_DIR}:")
    for path in (icon_png, icon_ico, icon_svg, sidebar_svg):
        size_kb = path.stat().st_size / 1024
        print(f"  - {path.name} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
