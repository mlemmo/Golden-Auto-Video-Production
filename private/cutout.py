#!/usr/bin/env python3
"""Cut the car out of vehicle photos (free, local rembg model) and put it on a plain light-grey backdrop.

Video references must carry only the car: Seedance copied the dealer lot (pavement markings, buildings, hills) from
the asset sheet's real photos into videos instead of the chosen background setting (2026-10-20).
stdin JSON: {"images": [path, ...], "out": dir}. stdout JSON: {"files": [path, ...]} in the same order.
Run with the Python of a venv that has rembg (config cutout_python, e.g. ~/golden-auto-cutout/bin/python).
"""
import json
import os
import sys


def main():
    data = json.load(sys.stdin)
    paths = [p for p in data.get('images', []) if isinstance(p, str)][:9]
    out = data['out']
    from PIL import Image
    from rembg import remove, new_session
    session = new_session('isnet-general-use')
    files = []
    for i, path in enumerate(paths):
        with Image.open(path) as im:
            cut = remove(im.convert('RGB'), session=session, post_process_mask=True)
        bg = Image.new('RGBA', cut.size, (222, 224, 227, 255))
        bg.alpha_composite(cut)
        dest = os.path.join(out, 'cut%d.jpg' % (i + 1))
        bg.convert('RGB').save(dest, quality=92)
        files.append(dest)
    json.dump({'files': files}, sys.stdout)


if __name__ == '__main__':
    main()
