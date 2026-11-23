# A contact sheet from a folder of shots: python tools/sheet.py shots/themes out.jpg [cols] [cell width]. Rows of the given file stems if
# the names are <row>-<col>.png; otherwise sorted.
import os
import sys
from PIL import Image

folder, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
cw = int(sys.argv[4]) if len(sys.argv) > 4 else 480
files = sorted(f for f in os.listdir(folder) if f.endswith('.png'))
first = Image.open(os.path.join(folder, files[0]))
ch = cw * first.height // first.width
rows = (len(files) + cols - 1) // cols
S = Image.new('RGB', (cw * cols, ch * rows))
for i, f in enumerate(files):
    S.paste(Image.open(os.path.join(folder, f)).convert('RGB').resize((cw, ch)), ((i % cols) * cw, (i // cols) * ch))
S.save(out, quality=88)
