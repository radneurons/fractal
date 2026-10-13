# usage: python3 scripts/sheet.py outdir prefix [cols] -> outdir/sheet_prefix.png
import sys, glob, re
from PIL import Image
d, pre = sys.argv[1], sys.argv[2]; cols = int(sys.argv[3]) if len(sys.argv) > 3 else 2
import os
def key(f):
    b = os.path.basename(f)[len(pre) + 1:-4]
    try: return float(b.replace('_', '.'))
    except ValueError: return 1e9
fs = sorted([f for f in glob.glob(f'{d}/{pre}_*.png') if key(f) < 1e9], key=key)
ims = [Image.open(f).convert('RGB') for f in fs]
w = 640; h = round(ims[0].height * w / ims[0].width)
S = Image.new('RGB', (w * cols, h * ((len(ims) + cols - 1) // cols)), (40, 40, 40))
for i, im in enumerate(ims): S.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
S.save(f'{d}/sheet_{pre}.png'); print(len(ims), 'frames')
