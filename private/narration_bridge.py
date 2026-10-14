"""Private stdlib transport and audio utilities; secrets arrive on stdin only."""
import base64
import json
import re
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ALLOWED_HOSTS = {'api.elevenlabs.io', 'queue.fal.run'}
LIMIT = 8_000_000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def audio_path(value):
    root = (Path(__file__).resolve().parent.parent / 'public/assets/narrations').resolve()
    path = Path(value).resolve()
    if path.parent != root or not path.is_file():
        raise ValueError('Audio must be in the narration library.')
    return path

def probe(path):
    run = subprocess.run(['/usr/bin/ffprobe', '-v', 'error', '-show_entries',
                          'format=duration', '-of', 'json', str(audio_path(path))],
                         capture_output=True, timeout=15, check=True)
    duration = float(json.loads(run.stdout)['format']['duration'])
    if not math.isfinite(duration) or duration <= 0 or duration > 60:
        raise ValueError('Invalid audio duration.')
    return duration

def execute(data):
    op = data.get('op')
    if op == 'probe':
        return {'duration': probe(data['path'])}
    if op == 'pad':
        path = audio_path(data['path'])
        duration = float(data['duration'])
        if not math.isfinite(duration) or not 2 <= duration <= 30:
            raise ValueError('Choose a 15 or 30 second video.')
        if probe(path) > duration:
            raise ValueError('Narration is longer than the video. Shorten it and make a new preview.')
        # Audio is padded with silence, never looped or sped up.
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'approved.wav'
            subprocess.run(['/usr/bin/ffmpeg', '-nostdin', '-v', 'error', '-i', str(path),
                            '-af', 'apad', '-t', str(duration), '-ar', '16000', '-ac', '1',
                            '-c:a', 'pcm_s16le', str(output)],
                           capture_output=True, timeout=45, check=True)
            return {'audio_url': 'data:audio/wav;base64,' + base64.b64encode(output.read_bytes()).decode()}
    if op != 'http':
        raise ValueError('Unknown bridge operation.')
    url = urlsplit(data['url'])
    if url.scheme != 'https' or url.hostname not in ALLOWED_HOSTS or url.username or url.password or url.port:
        raise ValueError('Unsupported API destination.')
    method = data.get('method', 'GET')
    if method not in ('GET', 'POST'):
        raise ValueError('Unsupported HTTP method.')
    body = None if method == 'GET' else base64.b64decode(data.get('body', ''), validate=True)
    headers = data.get('headers', {})
    if any('\r' in str(k)+str(v) or '\n' in str(k)+str(v) for k, v in headers.items()):
        raise ValueError('Invalid header.')
    req = urllib.request.Request(data['url'], data=body, headers=headers, method=method)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=65) as response:
            content = response.read(LIMIT + 1)
            if len(content) > LIMIT:
                raise ValueError('API response is too large.')
            return {'status': response.status, 'body': base64.b64encode(content).decode()}
    except urllib.error.HTTPError as error:
        # Never echo provider response bodies: they can reflect credentials or signed URLs.
        # Safe provider error details; omit inputs, credentials and URLs.
        raw = error.read(8000).decode(errors='replace')
        try:
            parsed = json.loads(raw)
            detail = parsed.get('detail') or parsed.get('message') or parsed.get('error') or ''
            if isinstance(detail, list):
                detail = '; '.join(
                    str(item.get('msg', '')) for item in detail
                    if isinstance(item, dict)
                )
            if not isinstance(detail, str):
                detail = 'Provider returned structured error details.'
        except (ValueError, AttributeError):
            detail = 'Provider returned a non-JSON error.'
        for name, value in headers.items():
            if name.lower() in ('authorization', 'xi-api-key'):
                detail = detail.replace(value, '[KEY OMITTED]')
                detail = detail.replace(value.removeprefix('Key '), '[KEY OMITTED]')
        detail = re.sub(r'https?://[^\s"<>]+', '[URL OMITTED]', detail)
        return {'status': error.code, 'body': '', 'detail': detail[:1200]}

def main():
    try:
        result = execute(json.load(sys.stdin))
    except ValueError as error:
        result = {'error': str(error)}
    except Exception:
        result = {'error': 'Transport or audio processing failed; check dependencies. A submitted paid request may be uncertain.'}
    print(json.dumps(result))

if __name__ == '__main__':
    main()
