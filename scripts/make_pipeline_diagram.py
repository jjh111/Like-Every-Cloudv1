"""Generate a widescreen PNG diagram of the CATIA/ShipConstructor -> VR pipeline."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 2400, 1500
BG = (250, 250, 252)
BOX_FILL = (235, 242, 250)
BOX_BORDER = (40, 70, 110)
ACCENT = (28, 96, 168)
TEXT = (20, 28, 44)
SUBTEXT = (70, 80, 100)
ARROW = (60, 75, 100)
NOTE = (110, 70, 30)

def load_font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            try:
                return ImageFont.truetype(c, size, index=1 if bold and c.endswith(".ttc") else 0)
            except Exception:
                try:
                    return ImageFont.truetype(c, size)
                except Exception:
                    pass
    return ImageFont.load_default()

font_title = load_font(46, bold=True)
font_box_title = load_font(30, bold=True)
font_box_body = load_font(22)
font_note = load_font(20)
font_small = load_font(18)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

def text_size(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]

def rounded_box(draw, x, y, w, h, fill, border, radius=18, border_width=3):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=border, width=border_width)

def draw_box(draw, x, y, w, h, title, body_lines=None, subtitle=None):
    rounded_box(draw, x, y, w, h, BOX_FILL, BOX_BORDER)
    tw, th = text_size(draw, title, font_box_title)
    title_y = y + 18
    draw.text((x + (w - tw) / 2, title_y), title, fill=TEXT, font=font_box_title)
    cursor_y = title_y + th + 8
    if subtitle:
        sw, sh = text_size(draw, subtitle, font_small)
        draw.text((x + (w - sw) / 2, cursor_y), subtitle, fill=ACCENT, font=font_small)
        cursor_y += sh + 10
    else:
        cursor_y += 6
    if body_lines:
        for line in body_lines:
            lw, lh = text_size(draw, line, font_box_body)
            draw.text((x + (w - lw) / 2, cursor_y), line, fill=SUBTEXT, font=font_box_body)
            cursor_y += lh + 6

def arrow(draw, x1, y1, x2, y2, width=4, head=18):
    draw.line([(x1, y1), (x2, y2)], fill=ARROW, width=width)
    import math
    angle = math.atan2(y2 - y1, x2 - x1)
    a1 = angle + math.radians(150)
    a2 = angle - math.radians(150)
    p1 = (x2 + head * math.cos(a1), y2 + head * math.sin(a1))
    p2 = (x2 + head * math.cos(a2), y2 + head * math.sin(a2))
    draw.polygon([(x2, y2), p1, p2], fill=ARROW)

title = "CAD to VR Pipeline"
subtitle = "CATIA / ShipConstructor  -->  STEP / mesh  -->  Unity VR (Quest 3)"
tw, th = text_size(d, title, font_title)
d.text(((W - tw) / 2, 36), title, fill=TEXT, font=font_title)
sw, sh = text_size(d, subtitle, font_small)
d.text(((W - sw) / 2, 36 + th + 6), subtitle, fill=SUBTEXT, font=font_small)

cx = W / 2
top_y = 130

input_w, input_h = 500, 110
left_x = cx - input_w - 80
right_x = cx + 80
draw_box(d, left_x, top_y, input_w, input_h, "CATIA", subtitle=".CATPart / .Product")
draw_box(d, right_x, top_y, input_w, input_h, "ShipConstructor", subtitle=".dwg / API output")

stage_w = 1200
stage_x = cx - stage_w / 2

def stage(y, h, title, lines, note_right=None, sub=None):
    draw_box(d, stage_x, y, stage_w, h, title, body_lines=lines, subtitle=sub)
    if note_right:
        nx = stage_x + stage_w + 40
        ny = y + h / 2 - (len(note_right) * 24) / 2
        for line in note_right:
            d.text((nx, ny), line, fill=NOTE, font=font_note)
            ny += 28

translator_y = top_y + input_h + 80
translator_h = 160
stage(translator_y, translator_h, "STEP AP242 Translator",
      ["preserves geometry, PMI,", "assembly structure, metadata"],
      sub="(or JT translator)")

geom_y = translator_y + translator_h + 75
geom_h = 180
stage(geom_y, geom_h, "Geometry Processing & Optimization",
      ["mesh tessellation   -   polygon decimation / LOD",
       "shrinkwrap / envelope   -   occlusion mesh generation"])

export_y = geom_y + geom_h + 75
export_h = 215
stage(export_y, export_h, "Mesh Export",
      ["primary VR runtime format (glTF / FBX)",
       "+ JT archival (ISO 14306)   -   DoD viewable standard",
       "+ 3D PDF / PRC (ISO 14739)   -   TDP deliverable"],
      sub="OBJ / FBX for colored materials")

vr_y = export_y + export_h + 75
vr_h = 200
stage(vr_y, vr_h, "VR Engine (Unity)",
      ["multi-file scene loading   -   frustum culling & LOD",
       "overlay / comparison mode   -   navigation & interaction",
       "motion sickness comfort"])

headset_y = vr_y + vr_h + 60
headset_h = 95
headset_w = 520
hx = cx - headset_w / 2
draw_box(d, hx, headset_y, headset_w, headset_h, "VR Headset", subtitle="Meta Quest 3")

def vline(x_top, y_top, y_bot):
    arrow(d, x_top, y_top, x_top, y_bot)

merge_y = translator_y - 50
d.line([(left_x + input_w / 2, top_y + input_h), (left_x + input_w / 2, merge_y)], fill=ARROW, width=4)
d.line([(right_x + input_w / 2, top_y + input_h), (right_x + input_w / 2, merge_y)], fill=ARROW, width=4)
d.line([(left_x + input_w / 2, merge_y), (right_x + input_w / 2, merge_y)], fill=ARROW, width=4)
arrow(d, cx, merge_y, cx, translator_y - 4)

annot1_y = translator_y + translator_h + 30
d.text((cx + 30, annot1_y), "START - STEP + DWG ?", fill=NOTE, font=font_note)
arrow(d, cx, translator_y + translator_h, cx, geom_y - 4)

arrow(d, cx, geom_y + geom_h, cx, export_y - 4)
arrow(d, cx, export_y + export_h, cx, vr_y - 4)
arrow(d, cx, vr_y + vr_h, cx, headset_y - 4)

out_path = Path(__file__).resolve().parent.parent / "docs" / "cad_to_vr_pipeline.png"
out_path.parent.mkdir(parents=True, exist_ok=True)
img.save(out_path, "PNG")
print(f"saved: {out_path}")
