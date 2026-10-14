#!/usr/bin/env python3
"""Crop/scale a local master and optionally burn supplied ASS/SRT captions; FFmpeg required."""
import argparse, pathlib, subprocess
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');p.add_argument('--format',choices=['reels','feed','square'],default='reels');p.add_argument('--captions');a=p.parse_args()
w,h={'reels':(1080,1920),'feed':(1080,1350),'square':(1080,1080)}[a.format]
vf=f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1'
if a.captions:
    # Use a copied simple local name so FFmpeg filter syntax cannot interpret user-supplied paths.
    import tempfile,shutil
    with tempfile.TemporaryDirectory() as t:
        cap=pathlib.Path(t)/('captions'+pathlib.Path(a.captions).suffix)
        shutil.copyfile(a.captions,cap)
        src=str(pathlib.Path(a.input).resolve());out=str(pathlib.Path(a.output).resolve())
        subprocess.run(['ffmpeg','-n','-i',src,'-vf',vf+f",subtitles={cap.name}",'-c:v','libx264','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',out],cwd=t,check=True)
else:
    subprocess.run(['ffmpeg','-n','-i',a.input,'-vf',vf,'-c:v','libx264','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',a.output],check=True)
