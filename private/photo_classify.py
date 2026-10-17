"""Sort vehicle photos: whole-car exterior shots vs interior, close-ups and text (free, local CLIP model).

Run with the ML environment's Python (config photo_python, default ~/golden-auto-ml/bin/python):
stdin  {"images": ["/path/a.jpg", ...]}
stdout {"results": [{"path": ..., "label": "exterior"|"open"|"interior"|"detail"|"text"|"banner", "score": 0.93}, ...]}
Unreadable images get label "error". The model (open_clip ViT-B-32, ~600 MB) downloads once to the user cache.
"""
import json
import sys

LABELS = {
    'exterior': ['a photo of the whole exterior of a car parked outside',
                 'a photo of a car seen from the front, side or rear, showing the entire vehicle'],
    # Open doors, trunk or hood: not wanted for the ads (user, 2026-10-17), so kept apart from 'exterior'.
    'open': ['a photo of a car with a door open', 'a photo of a car with its trunk, tailgate or hood open'],
    'interior': ['a photo of the interior of a car, showing seats, dashboard or steering wheel',
                 'a photo inside a car cabin'],
    'detail': ['a close-up photo of a car wheel, tire, headlight, badge or engine',
               'a close-up photo of part of a car, such as the trunk or engine bay'],
    'text': ['a photo of a window sticker, document, odometer or screen with text',
             'a photo of a printed vehicle history report',
             'a photo of a car dashboard screen showing a backup camera view or a map'],
    'banner': ['a dealership logo, banner or advertisement graphic', 'a placeholder image with text saying photo coming soon'],
}


def main():
    data = json.load(sys.stdin)
    paths = [p for p in data.get('images', []) if isinstance(p, str)][:500]
    import torch
    import open_clip
    from PIL import Image
    torch.set_num_threads(int(data.get('threads', 4)))
    model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
    tokenizer = open_clip.get_tokenizer('ViT-B-32')
    model.eval()
    names, prompts = [], []
    for name, texts in LABELS.items():
        for t in texts:
            names.append(name)
            prompts.append(t)
    with torch.no_grad():
        text = model.encode_text(tokenizer(prompts))
        text /= text.norm(dim=-1, keepdim=True)
        results = []
        for i in range(0, len(paths), 16):
            batch, ok = [], []
            for p in paths[i:i + 16]:
                try:
                    with Image.open(p) as im:
                        batch.append(preprocess(im.convert('RGB')))
                    ok.append(p)
                except Exception:
                    results.append({'path': p, 'label': 'error', 'score': 0.0})
            if not batch:
                continue
            img = model.encode_image(torch.stack(batch))
            img /= img.norm(dim=-1, keepdim=True)
            probs = (100.0 * img @ text.T).softmax(dim=-1)
            for p, row in zip(ok, probs):
                totals = {}
                for name, v in zip(names, row.tolist()):
                    totals[name] = totals.get(name, 0.0) + v
                label = max(totals, key=totals.get)
                results.append({'path': p, 'label': label, 'score': round(totals[label], 3)})
    json.dump({'results': results}, sys.stdout)


if __name__ == '__main__':
    main()
