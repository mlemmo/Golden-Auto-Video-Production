#!/usr/bin/env python3
"""AI showroom backgrounds for photo slideshows (PAID: fal.ai Bria Background Replace, about $0.04 per picture).

The car's own pixels are kept; the model removes the photo's background and generates a new one in the style of a
reference photo (the dealer's uploaded showroom), with a floor, lighting and shadows that match the photo's camera.
Only called by the caption worker for a slideshow build whose AI background was approved in the dashboard, and only
for pictures not made before (the caller caches them). Never run from tests.
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


def data_uri(path, size=1600):
    from PIL import Image, ImageOps
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((size, size))
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    data = json.load(sys.stdin)
    items = [i for i in data.get('items', []) if isinstance(i, dict)][:8]
    key = str(data['key'])
    opener = urllib.request.build_opener(NoRedirect)
    ref = data_uri(data['ref'])
    files, calls = [], 0
    for item in items:
        body = {'image_url': data_uri(item['src']), 'ref_image_url': ref, 'num_images': 1, 'seed': int(data.get('seed', 7))}
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
