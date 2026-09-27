#!/usr/bin/env python3
"""PBR map derivation and QA helpers. Requires Pillow and NumPy.

Subcommands:
  height     <src> <out>            derive a height map from base-color luminance
  normal     <height> <out>         height -> tangent-space normal map (OpenGL Y+)
  rough      <src> <out>            derive a starting roughness map from base color
  ao         <height> <out>         derive ambient occlusion from a height map
  orm        <out> --ao A --rough R --metal M   pack glTF ORM (each a path or constant)
  seamcheck  <src>                  verify the image tiles seamlessly (exit 1 if not)
  maketile   <src> <out>            force-blend edges to tile (last resort, softens look)
  flipnormal <src> <out>            convert DirectX (Y-) normal map to OpenGL (Y+)
  preview    <src> <out> [--n 2]    render an NxN tiled grid for repetition QA
  stats      <src>                  per-channel statistics and histograms
"""
import argparse
import math
import os
import stat
import sys
import tempfile
from pathlib import Path

np = None
Image = None
ImageFilter = None


class ToolError(RuntimeError):
    pass


def fail(message):
    raise ToolError(message)


def require_dependencies():
    global np, Image, ImageFilter
    if np is not None:
        return
    try:
        import numpy as numpy_module
        from PIL import Image as image_module, ImageFilter as image_filter_module
    except ImportError as exc:
        fail(
            "Pillow and NumPy are required. Install them in the active Python "
            "environment before running a PBR command."
        )
    np = numpy_module
    Image = image_module
    ImageFilter = image_filter_module


def finite(name, value, minimum=None, maximum=None):
    if not math.isfinite(value):
        fail(f"{name} must be finite.")
    if minimum is not None and value < minimum:
        fail(f"{name} must be at least {minimum}.")
    if maximum is not None and value > maximum:
        fail(f"{name} must be at most {maximum}.")
    return value


def load(path, mode="RGB"):
    require_dependencies()
    source = Path(path).expanduser()
    if not source.is_file():
        fail(f"input image not found: {source}")
    try:
        with Image.open(source) as image:
            converted = image.convert(mode)
            if converted.width < 1 or converted.height < 1:
                fail(f"input image has invalid dimensions: {source}")
            return np.asarray(converted, dtype=np.float32) / 255.0
    except ToolError:
        raise
    except Exception as exc:
        fail(f"could not read image {source}: {exc}")


def prepare_output(path, force):
    output = Path(path).expanduser()
    if output.suffix.lower() != ".png":
        fail(f"output must end in .png: {output}")
    if output.exists():
        if not output.is_file():
            fail(f"output path is not a file: {output}")
        if not force:
            fail(f"output already exists: {output} (use --force to overwrite)")
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        fail(f"could not create output directory {output.parent}: {exc}")
    if not output.parent.is_dir():
        fail(f"output parent is not a directory: {output.parent}")
    return output


def output_mode(path):
    if path.exists():
        return stat.S_IMODE(path.stat().st_mode) & 0o777
    current_umask = os.umask(0)
    os.umask(current_umask)
    return 0o666 & ~current_umask


def write_image_atomic(image, path, force):
    output = prepare_output(path, force)
    mode = output_mode(output)
    temporary = None
    try:
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{output.stem}-",
            suffix=".png",
            dir=output.parent,
        )
        os.close(fd)
        temporary = Path(temporary_name)
        image.save(temporary, format="PNG")
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        if force:
            os.replace(temporary, output)
        else:
            try:
                os.link(temporary, output)
            except FileExistsError as exc:
                fail(f"output was created before it could be saved: {output}")
            temporary.unlink()
        temporary = None
    except ToolError:
        raise
    except Exception as exc:
        fail(f"could not write image {output}: {exc}")
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    if not output.is_file() or output.stat().st_size == 0:
        fail(f"no non-empty output exists at {output}")
    print(f"wrote {output}")
    return output


def save(path, arr, force):
    require_dependencies()
    image = Image.fromarray(
        (np.clip(arr, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    )
    write_image_atomic(image, path, force)


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def blur(gray, radius):
    im = Image.fromarray((np.clip(gray, 0, 1) * 255).astype(np.uint8), "L")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0


def normalize01(gray):
    lo, hi = float(gray.min()), float(gray.max())
    return (gray - lo) / (hi - lo) if hi > lo else np.zeros_like(gray)


def cmd_height(args):
    finite("--blur", args.blur, 0.0, 256.0)
    prepare_output(args.out, args.force)
    h = luminance(load(args.src))
    if args.blur > 0:
        h = blur(h, args.blur)
    if args.invert:
        h = 1.0 - h
    save(args.out, normalize01(h), args.force)


def cmd_normal(args):
    finite("--strength", args.strength, 0.0, 100.0)
    prepare_output(args.out, args.force)
    h = luminance(load(args.src))
    # wrap-aware central differences keep the normal map itself tileable
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    gy_row = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -args.strength * gx
    ny = args.strength * gy_row  # OpenGL Y+: green bright on the top edge of bumps
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / length, ny / length, nz / length], axis=-1)
    save(args.out, n * 0.5 + 0.5, args.force)


def cmd_rough(args):
    finite("--base", args.base, 0.0, 1.0)
    finite("--range", args.range, 0.0, 1.0)
    prepare_output(args.out, args.force)
    lum = luminance(load(args.src))
    detail = np.abs(lum - blur(lum, 4))
    detail = normalize01(blur(detail, 2))
    rough = args.base + args.range * (detail - float(detail.mean()))
    if args.invert:
        rough = args.base - (rough - args.base)
    save(args.out, rough, args.force)


def cmd_ao(args):
    finite("--strength", args.strength, 0.0, 1.0)
    prepare_output(args.out, args.force)
    h = luminance(load(args.src))
    occ = np.zeros_like(h)
    for radius in (4, 8, 16, 32):
        occ += np.maximum(0.0, blur(h, radius) - h)
    occ = normalize01(occ)
    save(args.out, 1.0 - args.strength * occ, args.force)


def channel(spec, shape):
    try:
        value = finite("ORM channel constant", float(spec), 0.0, 1.0)
        return np.full(shape, value, dtype=np.float32)
    except ValueError:
        arr = luminance(load(spec))
        if arr.shape != shape:
            fail(f"{spec} is {arr.shape[::-1]}, expected {shape[::-1]}")
        return arr


def cmd_orm(args):
    prepare_output(args.out, args.force)
    ref = None
    for spec in (args.ao, args.rough, args.metal):
        try:
            finite("ORM channel constant", float(spec), 0.0, 1.0)
        except ValueError:
            shape = luminance(load(spec)).shape
            if ref is None:
                ref = shape
            elif shape != ref:
                fail(f"ORM input is {shape[::-1]}, expected {ref[::-1]}")
    if ref is None:
        fail("at least one of --ao/--rough/--metal must be an image path")
    orm = np.stack([channel(args.ao, ref), channel(args.rough, ref), channel(args.metal, ref)], axis=-1)
    save(args.out, orm, args.force)


def cmd_seamcheck(args):
    finite("--threshold", args.threshold, 0.0, 255.0)
    img = load(args.src)
    if img.shape[0] < 2 or img.shape[1] < 2:
        fail("seamcheck requires an image at least 2x2 pixels.")
    edge_x = float(np.abs(img[:, 0] - img[:, -1]).mean()) * 255
    edge_y = float(np.abs(img[0, :] - img[-1, :]).mean()) * 255
    interior_x = float(np.abs(np.diff(img, axis=1)).mean()) * 255
    interior_y = float(np.abs(np.diff(img, axis=0)).mean()) * 255
    limit_x = max(args.threshold, 3.0 * interior_x)
    limit_y = max(args.threshold, 3.0 * interior_y)
    print(f"horizontal wrap diff: {edge_x:.2f}  vertical wrap diff: {edge_y:.2f}")
    print(f"horizontal baseline: {interior_x:.2f}  limit: {limit_x:.2f}")
    print(f"vertical baseline: {interior_y:.2f}  limit: {limit_y:.2f}")
    if edge_x > limit_x or edge_y > limit_y:
        print("FAIL: visible seam when tiled")
        raise SystemExit(1)
    print("ok: tiles seamlessly")


def crossfade_axis(img, axis):
    # Pull each opposing edge pair toward the same value, then ease that
    # correction back to the untouched interior. Applying this on both axes
    # makes the first and last rows/columns identical without stretching.
    n = img.shape[axis]
    if n < 2:
        return img.copy()
    out = img.copy()
    band = max(1, n // 4)
    for offset in range(band):
        blend = offset / band
        blend = blend * blend * (3.0 - 2.0 * blend)
        left_index = [slice(None)] * img.ndim
        right_index = [slice(None)] * img.ndim
        left_index[axis] = offset
        right_index[axis] = n - 1 - offset
        left = img[tuple(left_index)]
        right = img[tuple(right_index)]
        seam = (left + right) * 0.5
        out[tuple(left_index)] = seam * (1.0 - blend) + left * blend
        out[tuple(right_index)] = seam * (1.0 - blend) + right * blend
    return out


def cmd_maketile(args):
    prepare_output(args.out, args.force)
    img = load(args.src)
    save(args.out, crossfade_axis(crossfade_axis(img, 1), 0), args.force)


def cmd_flipnormal(args):
    prepare_output(args.out, args.force)
    img = load(args.src)
    img[..., 1] = 1.0 - img[..., 1]
    save(args.out, img, args.force)


def cmd_preview(args):
    require_dependencies()
    if args.n < 1 or args.n > 8:
        fail("--n must be between 1 and 8.")
    prepare_output(args.out, args.force)
    source = Path(args.src).expanduser()
    if not source.is_file():
        fail(f"input image not found: {source}")
    try:
        with Image.open(source) as opened:
            im = opened.convert("RGB")
    except Exception as exc:
        fail(f"could not read image {source}: {exc}")
    sheet = Image.new("RGB", (im.width * args.n, im.height * args.n))
    for r in range(args.n):
        for c in range(args.n):
            sheet.paste(im, (c * im.width, r * im.height))
    output = write_image_atomic(sheet, args.out, args.force)
    print(f"preview: {args.n}x{args.n} tiles at {output}")


def cmd_stats(args):
    require_dependencies()
    img = load(args.src) * 255.0
    for i, name in enumerate("RGB"):
        ch = img[..., i]
        print(f"{name}: min {ch.min():.0f}  mean {ch.mean():.1f}  max {ch.max():.0f}  std {ch.std():.1f}")
        counts, _ = np.histogram(ch, bins=np.linspace(0.0, 256.0, 17))
        print(f"{name} histogram (16 bins, 0-255): {' '.join(str(int(value)) for value in counts)}")

    if args.kind == "normal":
        decoded = img / 127.5 - 1.0
        lengths = np.linalg.norm(decoded, axis=-1)
        means = decoded.mean(axis=(0, 1))
        print(
            "normal decoded mean: "
            f"({means[0]:.4f}, {means[1]:.4f}, {means[2]:.4f})"
        )
        print(
            f"normal length: mean {lengths.mean():.4f}  "
            f"std {lengths.std():.4f}  "
            f"outside 0.9-1.1 {100.0 * np.mean((lengths < 0.9) | (lengths > 1.1)):.2f}%"
        )
        print("normal Y convention cannot be inferred statistically; verify a known slope or lit render.")
    elif args.kind in {"roughness", "metallic"}:
        gray = img[..., 0]
        channel_delta = np.abs(img - gray[..., None]).max()
        print(f"maximum RGB channel disagreement: {channel_delta:.0f}")
        if args.kind == "metallic":
            binary = (gray <= 5.0) | (gray >= 250.0)
            print(
                f"metallic near 0/1: {100.0 * binary.mean():.2f}%  "
                f"midrange: {100.0 * (~binary).mean():.2f}%"
            )
    elif args.kind == "orm":
        metal = img[..., 2]
        binary = (metal <= 5.0) | (metal >= 250.0)
        print(
            "ORM channels: R=AO G=roughness B=metallic; "
            f"metallic near 0/1 {100.0 * binary.mean():.2f}%"
        )


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("height"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--blur", type=float, default=1.0); s.add_argument("--invert", action="store_true")
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_height)

    s = sub.add_parser("normal"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--strength", type=float, default=2.0)
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_normal)

    s = sub.add_parser("rough"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--base", type=float, default=0.7); s.add_argument("--range", type=float, default=0.35)
    s.add_argument("--invert", action="store_true")
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_rough)

    s = sub.add_parser("ao"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--strength", type=float, default=0.8)
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_ao)

    s = sub.add_parser("orm"); s.add_argument("out")
    s.add_argument("--ao", default="1.0"); s.add_argument("--rough", default="0.5"); s.add_argument("--metal", default="0.0")
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_orm)

    s = sub.add_parser("seamcheck"); s.add_argument("src")
    s.add_argument("--threshold", type=float, default=12.0)
    s.set_defaults(fn=cmd_seamcheck)

    s = sub.add_parser("maketile"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_maketile)

    s = sub.add_parser("flipnormal"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_flipnormal)

    s = sub.add_parser("preview"); s.add_argument("src"); s.add_argument("out")
    s.add_argument("--n", type=int, default=2)
    s.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    s.set_defaults(fn=cmd_preview)

    s = sub.add_parser("stats"); s.add_argument("src")
    s.add_argument(
        "--kind",
        choices=["generic", "normal", "roughness", "metallic", "orm"],
        default="generic",
        help="Add map-specific diagnostics.",
    )
    s.set_defaults(fn=cmd_stats)

    args = p.parse_args()
    try:
        args.fn(args)
    except ToolError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
