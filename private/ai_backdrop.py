#!/usr/bin/env python3
"""AI showroom backgrounds for photo slideshows (PAID: fal.ai Bria Background Replace, about $0.04 per picture).

The car's own pixels are kept; the model removes the photo's background and generates a new one in the style of a
reference photo (the dealer's uploaded showroom), with a floor, lighting and shadows that match the photo's camera.
Only called by the caption worker for a slideshow build whose AI background was approved in the dashboard, and only
for pictures not made before (the caller caches them). Never run from tests.
Every car is made the same size first (framing): the photo is shrunk and centred on a larger canvas so the car spans
about 62% of the width with its tyres at 80% of the height, found with the local rembg model when this runs with the
cut-out Python (config cutout_python), else a fixed margin; the AI then draws the showroom over the whole canvas.
stdin JSON: {"items": [{"src": path, "out": path}, ...], "ref": path, "key": "<fal key>", "seed": 7}
stdout JSON: {"files": [path, ...], "calls": n} (a picture that failed keeps no output; the caller uses the original).
"""
import base64
import io
import json
import sys
import urllib.parse
import urllib.request

ENDPOINT = 'https://fal.run/fal-ai/bria/background/replace'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


W, H = 1600, 1200   # canvas sent to the AI (4:3, like the listing photos)


def car_box(im, session):
    """The car's bounding box in the photo (rembg mask on a small copy), or None without the model."""
    if session is None:
        return None
    from rembg import remove
    small = im.copy(); small.thumbnail((800, 800))
    alpha = remove(small, session=session, only_mask=True).point(lambda v: 255 if v > 64 else 0)
    box = alpha.getbbox()
    if not box:
        return None
    k = im.width / small.width
    return tuple(round(v * k) for v in box)


def framed(path, session):
    """The photo on a 4:3 canvas with the car at a steady size and place (grey where the photo does not reach)."""
    from PIL import Image, ImageOps
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
    box = car_box(im, session)
    if box is None:   # no model: a fixed margin all round
        box = (round(im.width * .1), round(im.height * .15), round(im.width * .9), round(im.height * .9))
    bw, bh = box[2] - box[0], box[3] - box[1]
    scale = min(W * .62 / bw, H * .5 / bh, 1.25)
    pic = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    x = round(W / 2 - (box[0] + bw / 2) * scale)
    y = round(H * .8 - box[3] * scale)
    canvas = Image.new('RGB', (W, H), (128, 128, 128))
    canvas.paste(pic, (x, y))
    return canvas


def data_uri(path, size=1600, session=None, frame=False):
    from PIL import Image, ImageOps
    if frame:
        im = framed(path, session)
    else:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((size, size))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def preview(data):
    """Free check: write the framed pictures that would be sent (op "frame"); no network."""
    try:
        from rembg import new_session
        session = new_session('isnet-general-use')
    except Exception:
        session = None
    for item in data.get('items', []):
        framed(item['src'], session).save(item['out'], 'JPEG', quality=90)
    json.dump({'files': [i['out'] for i in data.get('items', [])]}, sys.stdout)


def main():
    data = json.load(sys.stdin)
    if data.get('op') == 'frame':
        return preview(data)
    items = [i for i in data.get('items', []) if isinstance(i, dict)][:8]
    key = str(data['key'])
    opener = urllib.request.build_opener(NoRedirect)
    ref = data_uri(data['ref'])
    try:
        from rembg import new_session
        session = new_session('isnet-general-use')
    except Exception:
        session = None
    files, calls = [], 0
    for item in items:
        body = {'image_url': data_uri(item['src'], session=session, frame=True), 'ref_image_url': ref, 'num_images': 1, 'seed': int(data.get('seed', 7))}
        req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method='POST',
                                     headers={'Authorization': 'Key ' + key, 'Content-Type': 'application/json'})
        calls += 1
        try:
            with opener.open(req, timeout=180) as r:
                out = json.load(r)
            url = str(out['images'][0]['url'])
            host = urllib.parse.urlparse(url).hostname or ''
            if not url.startswith('https://') or not (host == 'fal.media' or host.endswith('.fal.media')):
                raise ValueError('unexpected result address')
            with opener.open(url, timeout=120) as r:
                pic = r.read(30_000_000)
            from PIL import Image
            Image.open(io.BytesIO(pic)).convert('RGB').save(item['out'], 'JPEG', quality=92)
            files.append(item['out'])
        except Exception as error:   # one failed picture: the original photo is used, the rest carry on
            print('AI background failed for one photo: ' + str(error)[:200], file=sys.stderr)
    json.dump({'files': files, 'calls': calls}, sys.stdout)


if __name__ == '__main__':
    main()
