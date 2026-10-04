"""Generates icons/icon{16,32,48,128}.png. Requires Pillow. Neutral design, no third-party branding."""
from PIL import Image, ImageDraw
S = 512
def make():
    base = Image.new("RGBA", (S, S))
    px = base.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = (int(79 + (8 - 79) * t), int(70 + (145 - 70) * t), int(229 + (178 - 229) * t), 255)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=112, fill=255)
    base.putalpha(mask)
    top = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(top)
    d.ellipse((92, 156, 332, 396), fill=(255, 255, 255, 255))
    d.ellipse((180, 116, 420, 356), fill=(255, 255, 255, 150))
    return Image.alpha_composite(base, top)
img = make()
for n in (16, 32, 48, 128):
    img.resize((n, n), Image.LANCZOS).save(f"icons/icon{n}.png")
