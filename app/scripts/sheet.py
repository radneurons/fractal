#!/usr/bin/env python3
"""Contact sheet from stills:  sheet.py out.png cols thumbWidth img1 img2 …  (labels = file names)"""
import sys, os
from PIL import Image, ImageDraw
out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
ths = []
for im in ims:
    th = int(im.height * tw / im.width)
    ths.append(im.resize((tw, th), Image.LANCZOS))
rows = (len(ths) + cols - 1) // cols
rh = max(t.height for t in ths) + 16
sheet = Image.new('RGB', (cols * (tw + 6) + 6, rows * (rh + 6) + 6), (24, 24, 28))
d = ImageDraw.Draw(sheet)
for i, t in enumerate(ths):
    x, y = 6 + (i % cols) * (tw + 6), 6 + (i // cols) * (rh + 6)
    sheet.paste(t, (x, y))
    d.text((x + 2, y + t.height + 2), os.path.basename(files[i])[:-4][-(tw // 6):], fill=(190, 190, 200))
sheet.save(out)
print(out, sheet.size)
