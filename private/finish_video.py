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
            'source_end': math.ceil((speech_end + 0.1) * 24) / 24}


def make_card(photo, output, width, height, title, closing):
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


def render(data):
    work = Path(data['work']).resolve()
    width, height = int(data['width']), int(data['height'])
    plan = data['plan']
    total, end = float(plan['duration']), float(plan['source_end'])
    intro, fade = 2.0, 0.625
    closing_at = intro + end
    if width < 100 or height < 100 or total - closing_at < .5:
        raise ValueError('Narration leaves insufficient room for intro and closing card.')
    make_card(data['photo'], work / 'intro.png', width, height, data['title'], False)
    make_card(data['photo'], work / 'closing.png', width, height, data['title'], True)
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
        result = analyze(data) if data['op'] == 'analyze' else render(data) if data['op'] == 'render' else None
        if result is None:
            raise ValueError('Unknown finishing operation.')
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error)[:1400]}))
        sys.exit(1)
