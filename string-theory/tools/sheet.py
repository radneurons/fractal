"""Contact sheet of rendered stills: python3 tools/sheet.py out.png cols width files..."""
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
h = w * 9 // 16
sheet = Image.new('RGB', (w * cols, h * ((len(files) + cols - 1) // cols)))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((w, h), Image.LANCZOS)
    ImageDraw.Draw(im).text((8, 8), f.split('/')[-1], fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
