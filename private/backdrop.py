#!/usr/bin/env python3
"""Put the car from whole-car exterior photos onto a showroom backdrop (free, local rembg model), for photo slideshows.

The car is cut out, scaled to the same size in every picture and stood on the floor of the backdrop with a soft
contact shadow under it. Built-in backdrops are seamless studio sweeps (no floor line to line up): 'studio' (charcoal)
and 'white'. An uploaded backdrop photo is filled to the frame and the car stands at its floor line (floor, 0-1 from
the top, default 0.86).
stdin JSON: {"items": [{"src": path, "out": path}, ...], "backdrop": "studio" | "white" | path, "floor": 0.86,
            "width": 1600, "height": 1200} (built-in sweeps are drawn at the video's own size)
stdout JSON: {"files": [path, ...]} (pictures that could not be cut keep no output: the caller uses the original).
Run with the Python of a venv that has rembg (config cutout_python, e.g. ~/golden-auto-cutout/bin/python).
"""
import json
import sys

W, H = 1600, 1200


def sweep(top, bottom, glow):
    """A seamless studio sweep: a vertical gradient with a soft light behind the car and darker corners."""
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = (y / (H - 1)) ** 1.4
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    light = Image.new('L', (W, H), 0)
    ImageDraw.Draw(light).ellipse([W * .12, H * .18, W * .88, H * .92], fill=255)
    light = light.filter(ImageFilter.GaussianBlur(W * .12))
    return Image.composite(Image.new('RGB', (W, H), glow), im, light.point(lambda v: v * 0.55))


def backdrop(spec):
    from PIL import Image, ImageOps
    if spec == 'studio':
        return sweep((38, 42, 50), (118, 122, 130), (150, 154, 162))
    if spec == 'white':
        return sweep((214, 216, 220), (246, 247, 249), (255, 255, 255))
    with Image.open(spec) as im:
        return ImageOps.fit(ImageOps.exif_transpose(im).convert('RGB'), (W, H))


def keep_car(cut):
    """Only the car: thin things the cut-out kept with it (a sign post or pole behind the roof) are opened away and
    only the largest piece is kept. Fine edges stay as the model cut them wherever the car is kept."""
    import numpy as np
    from scipy import ndimage
    from PIL import Image
    a = np.asarray(cut.split()[3]) > 24
    k = max(3, round(min(a.shape) * 0.012))
    opened = ndimage.binary_opening(a, structure=np.ones((k, k)))
    labels, n = ndimage.label(opened)
    if n == 0:
        return cut
    sizes = ndimage.sum(opened, labels, range(1, n + 1))
    car = labels == (1 + int(np.argmax(sizes)))
    # Grow back what the opening shaved off the car's own outline (not the removed post).
    keep = ndimage.binary_dilation(car, structure=np.ones((k + 2, k + 2))) & a
    out = np.asarray(cut).copy()
    out[..., 3] = np.where(keep, out[..., 3], 0)
    return Image.fromarray(out, 'RGBA')


def place(cut, bg, floor):
    """The cut-out car, scaled to a steady size and centred, standing at the floor line with a contact shadow."""
    from PIL import Image, ImageDraw, ImageFilter
    cut = keep_car(cut)
    alpha = cut.split()[3].point(lambda v: 255 if v > 24 else 0)
    box = alpha.getbbox()
    if not box or (box[2] - box[0]) * (box[3] - box[1]) < cut.width * cut.height * 0.05:
        return None   # nothing car-sized found: keep the original photo
    car = cut.crop(box)
    # Wide frames: smaller, so the showroom around it shows; tall frames: as wide as fits.
    scale = min(W * (.84 if H > W else .7) / car.width, H * (.6 if H > W else .5) / car.height)
    car = car.resize((max(1, round(car.width * scale)), max(1, round(car.height * scale))), Image.LANCZOS)
    x, bottom = (W - car.width) // 2, round(H * floor)
    y = bottom - car.height
    out = bg.convert('RGBA')
    mask = car.split()[3]
    cw, ch = car.size

    def squash(top, height, alpha, blur):
        """The bottom part of the car's own outline, flattened onto the floor: a shadow that follows the wheels."""
        part = mask.crop((0, round(ch * top), cw, ch)).resize((cw, max(2, round(ch * height))), Image.LANCZOS)
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        layer.paste(Image.new('RGBA', part.size, (0, 0, 0, alpha)), (x, bottom - part.height // 2), part)
        return layer.filter(ImageFilter.GaussianBlur(max(2, ch * blur)))

    # A soft ambient shadow under the whole car, the body's outline flattened, and dark spots where the tyres touch.
    ambient = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ambient).ellipse([x - cw * .02, bottom - ch * .06, x + cw * 1.02, bottom + ch * .06], fill=(0, 0, 0, 70))
    out.alpha_composite(ambient.filter(ImageFilter.GaussianBlur(max(4, ch * .05))))
    out.alpha_composite(squash(0.7, 0.10, 110, 0.025))
    # Contact shadow where each tyre really is (the far wheel of a three-quarter view stands higher in the picture):
    # the car's own outline nudged down and blurred, so it shows only just under the tyres and the sills.
    drop = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    drop.paste(Image.new('RGBA', car.size, (0, 0, 0, 200)), (x, y + max(2, round(ch * .018))), mask)
    out.alpha_composite(drop.filter(ImageFilter.GaussianBlur(max(2, ch * .012))))
    out.alpha_composite(car, (x, y))
    return out.convert('RGB')


def main():
    global W, H
    data = json.load(sys.stdin)
    W, H = min(4000, max(320, int(data.get('width') or 1600))), min(4000, max(320, int(data.get('height') or 1200)))
    items = [i for i in data.get('items', []) if isinstance(i, dict)][:40]
    floor = min(0.95, max(0.5, float(data.get('floor') or 0.86)))
    from PIL import Image, ImageOps
    from rembg import remove, new_session
    session = new_session('isnet-general-use')
    bg = backdrop(str(data['backdrop']))
    files = []
    for item in items:
        try:
            with Image.open(item['src']) as im:
                cut = remove(ImageOps.exif_transpose(im).convert('RGB'), session=session, post_process_mask=True)
            pic = place(cut, bg, floor)
        except Exception:
            pic = None
        if pic is not None:
            pic.save(item['out'], quality=92)
            files.append(item['out'])
    json.dump({'files': files}, sys.stdout)


if __name__ == '__main__':
    main()
