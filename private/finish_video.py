#!/usr/bin/env python3
"""Golden Auto local finishing. JSON in/out; no network or paid API calls."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys


def run(args, timeout=300):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise ValueError('Media processing failed: ' + result.stderr[-1200:])
    return result


def analyze(data):
    path = Path(data['audio'])
    if not path.is_file() or path.stat().st_size > 20_000_000:
        raise ValueError('Approved narration file missing or too large.')
    if hashlib.sha256(path.read_bytes()).hexdigest() != data['audio_hash']:
        raise ValueError('Approved narration changed; review it again.')
    ffmpeg = data.get('ffmpeg', '/usr/bin/ffmpeg')
    # Decode to PCM to measure actual duration, not an MP3 container estimate.
    r = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-i', str(path),
                        '-t', '61', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
                       capture_output=True, timeout=45)
    if r.returncode:
        raise ValueError('Cannot decode approved narration.')
    duration = len(r.stdout) / 32000
    if not 0.5 < duration <= 60:
        raise ValueError('Narration duration is outside the supported range.')
    detected = run([ffmpeg, '-nostdin', '-hide_banner', '-i', str(path),
                    '-af', 'silencedetect=noise=-38dB:d=0.3', '-vn', '-f', 'null', '-'], 45)
    starts = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', detected.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', detected.stderr)]
    speech_end = duration
    if starts and ends and abs(ends[-1] - duration) < 0.12:
        speech_end = starts[-1]
    if speech_end < 0.5:
        raise ValueError('No usable speech found.')
    return {'speech_end': speech_end, 'audio_duration': duration,
            'source_end': math.ceil((speech_end + 0.1) * 24) / 24,
            'spans': voiced_spans(r.stdout, speech_end)}


def voiced_spans(pcm, speech_end):
    """Voiced intervals [start, end] in seconds from 16 kHz mono s16le audio.

    Pauses are found from short-window loudness relative to the speech level, because a
    fixed dB gate misses pauses that contain breath noise.
    """
    import array
    samples = array.array('h')
    samples.frombytes(pcm[:len(pcm) // 2 * 2])
    window = 160  # 10 ms
    levels = []
    for i in range(0, len(samples) - window + 1, window):
        chunk = samples[i:i + window]
        rms = math.sqrt(sum(v * v for v in chunk) / window)
        levels.append(20 * math.log10(rms / 32768 + 1e-9))
    if not levels:
        return []
    ranked = sorted(levels)
    gate = max(-60.0, ranked[int(len(ranked) * 0.9)] - 25.0)
    spans, start = [], None
    quiet = 0
    for i, level in enumerate(levels):
        if level >= gate:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= 12:  # at least 120 ms of quiet ends a span
                spans.append([start * 0.01, (i - quiet + 1) * 0.01])
                start, quiet = None, 0
    if start is not None:
        spans.append([start * 0.01, min(speech_end, len(levels) * 0.01)])
    return [[round(a, 3), round(min(b, speech_end), 3)] for a, b in spans
            if min(b, speech_end) - a >= 0.06]


def video_frame(ffmpeg, video, at, output):
    """One still from the video (the car in the chosen setting), or None when it cannot be read."""
    r = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-ss', f'{max(0.0, at):.3f}', '-i', str(video),
                        '-frames:v', '1', '-q:v', '2', str(output)], capture_output=True, timeout=60)
    return output if r.returncode == 0 and Path(output).is_file() and Path(output).stat().st_size > 1000 else None


def make_card(photo, output, width, height, title, closing, frame=False):
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    # Compose at delivery size; contain the whole inventory photo.
    im = Image.new('RGB', (width, height), '#101d2b')
    draw = ImageDraw.Draw(im)
    font_dir = Path('/usr/share/fonts/truetype/dejavu')
    def label(y, text, size, color='white', bold=False):
        font_path = font_dir / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')
        text = str(text).replace('\n', ' ')[:180]
        font = ImageFont.truetype(str(font_path), round(size * width / 720))
        while draw.textbbox((0, 0), text, font=font)[2] > width * 0.88 and font.size > 12:
            font = ImageFont.truetype(str(font_path), font.size - 1)
        draw.text((width / 2, round(y * height)), text, font=font, fill=color, anchor='mt')
    label(.109, 'GOLDEN AUTO', 48, bold=True)
    label(.164, title, 28, '#cbd5e1')
    with Image.open(photo) as source:
        source = ImageOps.exif_transpose(source).convert('RGB')
        if frame:
            # A video frame is as tall as the card: crop the band with the car (slightly below the middle).
            box = (width, round(height * .39))
            source = ImageOps.fit(source, box, centering=(0.5, 0.58))
        source = ImageOps.contain(source, (width, round(height * .39)))
        im.paste(source, ((width - source.width) // 2,
                         round(height * .258) + (round(height * .39) - source.height) // 2))
    if closing:
        draw.rectangle((width * .083, height * .711, width * .917, height * .714), fill='#d8b367')
        label(.750, 'BOOK YOUR TEST DRIVE', 33, bold=True)
        label(.801, 'mygoldenauto.net', 37, '#efcb80', True)
        label(.852, 'San Ramon, California', 24, '#cbd5e1')
    else:
        label(.742, 'MEET YOUR NEXT RIDE', 34, bold=True)
        label(.789, 'mygoldenauto.net', 29, '#efcb80')
    im.save(output)


def slideshow_card(data):
    """Dealer card of a photo slideshow: the car's first photo blurred and darkened behind the dealer's details.
    kind 'intro' names the dealer and the car; 'outro' asks for the test drive with website, phone and city."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
    width, height = int(data['width']), int(data['height'])
    # Larger text in tall frames, where the card is seen on a phone held upright.
    unit = min(width, height) / 720 * (1.35 if height > width * 1.2 else 1)
    with Image.open(data['photo']) as source:
        im = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGB'), (width, height))
    im = im.filter(ImageFilter.GaussianBlur(round(24 * unit)))
    im = Image.blend(im, Image.new('RGB', (width, height), '#0b1622'), 0.72)
    draw = ImageDraw.Draw(im)
    font_dir = Path('/usr/share/fonts/truetype/dejavu')
    lines = []

    def add(text, size, color='white', bold=False, gap=0.55):
        text = str(text or '').replace('\n', ' ').strip()[:120]
        if text:
            font = ImageFont.truetype(str(font_dir / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), round(size * unit))
            while draw.textbbox((0, 0), text, font=font)[2] > width * 0.86 and font.size > 12:
                font = ImageFont.truetype(font.path, font.size - 1)
            lines.append((text, font, color, round(gap * font.size)))

    dealer = str(data.get('dealer') or '').upper()
    if data['kind'] == 'intro':
        add(dealer, 52, '#efcb80', True, 0.9)
        add(data.get('vehicle'), 34, 'white', True)
        add(data.get('price'), 34, '#efcb80', True, 0.9)
        add(data.get('city'), 24, '#cbd5e1')
    else:
        add('BOOK YOUR TEST DRIVE', 36, 'white', True, 0.9)
        add(data.get('website'), 40, '#efcb80', True)
        add(data.get('phone'), 34, 'white', True)
        add(dealer, 26, '#cbd5e1', False, 0.3)
        add(data.get('city'), 24, '#cbd5e1')
    total = sum(f.getbbox(t)[3] + g for t, f, _, g in lines)
    y = (height - total) / 2
    for i, (text, font, color, gap) in enumerate(lines):
        draw.text((width / 2, y), text, font=font, fill=color, anchor='mt')
        y += font.getbbox(text)[3] + gap
        if i == 0:
            rule = round(3 * unit)
            draw.rectangle((width * .3, y - gap / 2 - rule / 2, width * .7, y - gap / 2 + rule / 2), fill='#d8b367')
    im.save(data['output'])
    return {'ok': True}


def render(data):
    work = Path(data['work']).resolve()
    width, height = int(data['width']), int(data['height'])
    plan = data['plan']
    total, end = float(plan['duration']), float(plan['source_end'])
    intro, fade = 2.0, 0.625
    closing_at = intro + end
    if width < 100 or height < 100 or total - closing_at < .5:
        raise ValueError('Narration leaves insufficient room for intro and closing card.')
    # Cards show stills from the video itself, so the car appears in the chosen setting rather than on the dealer's lot
    # (user request 2026-10-20); the inventory photo is the fallback when a still cannot be read.
    ffmpeg = data.get('ffmpeg', '/usr/bin/ffmpeg')
    first = video_frame(ffmpeg, work / 'master.mp4', 0.3, work / 'card-first.jpg')
    last = video_frame(ffmpeg, work / 'master.mp4', end - 0.2, work / 'card-last.jpg')
    make_card(first or data['photo'], work / 'intro.png', width, height, data['title'], False, bool(first))
    make_card(last or data['photo'], work / 'closing.png', width, height, data['title'], True, bool(last))
    # Freeze the first presenter frame only during the dissolve. Both original
    # motion and original audio start at t=2, so lip-sync stays aligned.
    graph = (
        f'[0:v]fps=24,scale={width}:{height}:force_original_aspect_ratio=increase,'
        f'crop={width}:{height},setsar=1,trim=duration={end},setpts=PTS-STARTPTS,'
        f'tpad=start_mode=clone:start_duration={fade}:stop_mode=clone:stop_duration={total},'
        'format=yuv420p,settb=AVTB[body];'
        '[1:v]fps=24,trim=duration=2,setpts=PTS-STARTPTS,setsar=1,format=yuv420p,settb=AVTB[intro];'
        f'[intro][body]xfade=transition=fade:duration={fade}:offset={intro-fade}[lead];'
        f"[lead][2:v]overlay=enable='gte(t,{closing_at})':shortest=1[card];"
        "[card]subtitles=captions.srt:force_style='FontName=DejaVu Sans,FontSize=10,"
        "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,"
        "Shadow=0,Alignment=2,MarginV=40'[out];"
        f'[0:a]atrim=duration={end},asetpts=PTS-STARTPTS,adelay=2000:all=1,apad,atrim=duration={total}[audio]'
    )
    args = [data.get('ffmpeg', '/usr/bin/ffmpeg'), '-nostdin', '-n', '-hide_banner',
            '-loglevel', 'error', '-filter_complex_threads', '1', '-i', 'master.mp4',
            '-loop', '1', '-framerate', '24', '-i', 'intro.png', '-loop', '1',
            '-framerate', '24', '-i', 'closing.png', '-filter_complex', graph,
            '-map', '[out]', '-map', '[audio]', '-t', str(total), '-r', '24',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2',
            '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', data['output']]
    result = subprocess.run(args, cwd=work, capture_output=True, text=True, timeout=600)
    if result.returncode:
        raise ValueError('Finishing failed: ' + result.stderr[-1200:])
    return {'ok': True, 'duration': total, 'intro': intro, 'closing_at': closing_at}


if __name__ == '__main__':
    try:
        data = json.load(sys.stdin)
        ops = {'analyze': analyze, 'render': render, 'slideshow_card': slideshow_card}
        result = ops[data['op']](data) if data.get('op') in ops else None
        if result is None:
            raise ValueError('Unknown finishing operation.')
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error)[:1400]}))
        sys.exit(1)
