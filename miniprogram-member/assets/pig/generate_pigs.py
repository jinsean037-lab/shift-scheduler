# -*- coding: utf-8 -*-
"""手绘风卡通小猪 v4（精修版）
风格参考「学工办」手绘小猪：团子身体 + 小尖耳 + 竖线眼睛 + 墨线笔触，彩色版。
"""
import os
import math
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SS = 4
BASE = 160
OUT = os.path.dirname(os.path.abspath(__file__))

INK = (52, 62, 48, 255)
INK_SOFT = (72, 84, 68, 130)
PINK = (251, 208, 214, 255)
PINK_DEEP = (244, 183, 194, 255)
BLUSH = (248, 165, 182, 255)
SWEAT = (130, 198, 255, 255)
GOLD = (250, 206, 70, 255)
HEART = (240, 120, 160, 255)

LEVEL_BG = {
    1: (223, 247, 231, 255),
    2: (217, 237, 252, 255),
    3: (237, 241, 245, 255),
    4: (255, 236, 209, 255),
    5: (253, 224, 224, 255),
}

def S(v):
    return v * SS

def ink_path(d, pts, color=INK, width=3.0, closed=True, seed=0, jitter=0.25):
    """一条连续的手绘笔触（粗细均匀 + 轻微抖动）"""
    rnd = random.Random(seed)
    seq = list(pts) + ([pts[0]] if closed else [])
    seq2 = [(x + rnd.uniform(-jitter, jitter), y + rnd.uniform(-jitter, jitter)) for x, y in seq]
    d.line([(S(x), S(y)) for x, y in seq2], fill=color, width=max(1, int(S(width))), joint='curve')
    r = width / 2.0
    for (px, py) in (seq2[0], seq2[-1]):
        d.ellipse([S(px - r), S(py - r), S(px + r), S(py + r)], fill=color)

def squircle(cx, cy, rx, ry, n=130, power=3.0, wobble=0.012, seed=0):
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        x = rx * math.copysign(abs(ca) ** (2.0 / power), ca)
        y = ry * math.copysign(abs(sa) ** (2.0 / power), sa)
        r = 1 + rnd.uniform(-wobble, wobble)
        pts.append((cx + x * r, cy + y * r))
    return pts

def ellipse_pts(cx, cy, rx, ry, n=72, wobble=0.018, seed=0):
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 1 + rnd.uniform(-wobble, wobble)
        pts.append((cx + rx * r * math.cos(a), cy + ry * r * math.sin(a)))
    return pts

def fill_shape(d, pts, color):
    d.polygon([(S(x), S(y)) for x, y in pts], fill=color)

def stroke(d, pts, width=3.0, color=INK, seed=0):
    ink_path(d, pts, color, width, closed=False, seed=seed)

def eye_line(d, x, y, h=11, curve=0.8, seed=0):
    pts = []
    for i in range(7):
        t = i / 6.0
        pts.append((x + curve * math.sin(math.pi * t), y - h / 2 + h * t))
    stroke(d, pts, 3.2, INK, seed)

def eye_x(d, x, y, h=11, seed=0):
    stroke(d, [(x - h * 0.36, y - h * 0.36), (x + h * 0.36, y + h * 0.36)], 3.2, INK, seed)
    stroke(d, [(x + h * 0.36, y - h * 0.36), (x - h * 0.36, y + h * 0.36)], 3.2, INK, seed + 1)

def mouth_smile(d, cx, cy, w=13, seed=0):
    pts = []
    for i in range(7):
        t = i / 6.0
        pts.append((cx - w / 2 + w * t, cy + 3.2 * math.sin(math.pi * t)))
    stroke(d, pts, 3.0, INK, seed)

def mouth_flat(d, cx, cy, w=12, seed=0):
    stroke(d, [(cx - w / 2, cy), (cx + w / 2, cy + 0.8)], 3.0, INK, seed)

def mouth_open(d, cx, cy, w=17, h=13, seed=0):
    outer = ellipse_pts(cx, cy, w / 2, h / 2, seed=seed, wobble=0.05)
    fill_shape(d, outer, (222, 122, 146, 255))
    ink_path(d, outer, INK, 2.8, seed=seed + 5)
    inner = ellipse_pts(cx, cy + 1.8, w / 2 - 3.5, h / 2 - 4.2, seed=seed + 9, wobble=0.07)
    fill_shape(d, inner, (247, 180, 194, 255))

def eye_arc_closed(d, x, y, w=14, seed=0):
    pts = []
    for i in range(7):
        t = i / 6.0
        pts.append((x - w / 2 + w * t, y - 3.2 * math.sin(math.pi * t)))
    stroke(d, pts, 3.2, INK, seed)

def eye_arc_up(d, x, y, w=14, seed=0):
    pts = []
    for i in range(7):
        t = i / 6.0
        pts.append((x - w / 2 + w * t, y + 3.2 * math.sin(math.pi * t)))
    stroke(d, pts, 3.2, INK, seed)

def sweat_drop(d, cx, cy, s=9, seed=0):
    pts = [(cx, cy - s), (cx - s * 0.66, cy + s * 0.4), (cx + s * 0.66, cy + s * 0.4)]
    fill_shape(d, pts, SWEAT)
    ink_path(d, pts + [pts[0]], INK, 2.2, seed=seed)

def heart(d, cx, cy, size=17, seed=0):
    r = size / 2.0
    a = ellipse_pts(cx - r * 0.5, cy - r * 0.3, r * 0.62, r * 0.62, seed=seed, wobble=0.06)
    b = ellipse_pts(cx + r * 0.5, cy - r * 0.3, r * 0.62, r * 0.62, seed=seed + 1, wobble=0.06)
    tri = [(cx - r * 0.95, cy - r * 0.05), (cx + r * 0.95, cy - r * 0.05), (cx, cy + r * 1.15)]
    fill_shape(d, a, HEART)
    fill_shape(d, b, HEART)
    fill_shape(d, tri, HEART)
    ink_path(d, a + b + tri, INK, 2.2, seed=seed + 4)

def star(d, cx, cy, r=10, seed=0):
    pts = []
    for i in range(10):
        ang = math.pi / 2 + i * math.pi / 5
        rad = r if i % 2 == 0 else r * 0.44
        pts.append((cx + rad * math.cos(ang), cy - rad * math.sin(ang)))
    fill_shape(d, pts, GOLD)
    ink_path(d, pts + [pts[0]], INK, 2.0, seed=seed)

def bubble(d, cx, cy, r=5, seed=0):
    pts = ellipse_pts(cx, cy, r, r, seed=seed, wobble=0.1)
    fill_shape(d, pts, (255, 255, 255, 235))
    ink_path(d, pts, INK_SOFT, 1.8, seed=seed)

def music_note(d, cx, cy, s=9, seed=0):
    pts = ellipse_pts(cx, cy, s * 0.62, s * 0.5, seed=seed, wobble=0.07)
    fill_shape(d, pts, (140, 190, 245, 255))
    ink_path(d, pts, INK, 2.0, seed=seed)
    stroke(d, [(cx + s * 0.5, cy), (cx + s * 0.5, cy - s * 1.9)], 2.2, INK, seed + 2)
    stroke(d, [(cx + s * 0.5, cy - s * 1.9), (cx + s * 1.5, cy - s * 1.5)], 2.2, INK, seed + 3)

def draw_ears(d, cx, cy, ry, seed):
    """小尖耳：画在身体之后，压住头顶两侧，底宽顶尖，别像犄角"""
    for side in (-1, 1):
        base_in = (cx + side * 13, cy - ry + 13)
        tip = (cx + side * 30, cy - ry - 9)
        base_out = (cx + side * 30, cy - ry + 13)
        ear = [base_in, tip, base_out]
        fill_shape(d, ear, PINK_DEEP)
        ink_path(d, ear + [ear[0]], INK, 2.8, seed=seed + (side + 2))
        # 内耳阴影
        inner = [
            (cx + side * 19, cy - ry + 8),
            (cx + side * 27, cy - ry - 2),
            (cx + side * 26, cy - ry + 9),
        ]
        fill_shape(d, inner, (232, 158, 174, 255))

def draw_face_parts(d, cx, cy, seed):
    """腮红 + 鼻子 + 小脚（各档位共用）"""
    for side in (-1, 1):
        bl = ellipse_pts(cx + side * 20, cy + 8, 7.5, 5.5, seed=seed + 40 + side, wobble=0.1)
        fill_shape(d, bl, BLUSH)
    nose = ellipse_pts(cx, cy - 1, 9.6, 7.2, seed=seed + 50, wobble=0.04)
    fill_shape(d, nose, INK)
    inner = ellipse_pts(cx - 0.4, cy - 2.0, 7.4, 5.0, seed=seed + 54, wobble=0.06)
    fill_shape(d, inner, PINK_DEEP)
    for side in (-1, 1):
        n = ellipse_pts(cx + side * 3.0, cy - 1.2, 1.3, 1.8, seed=seed + 60 + side, wobble=0.1)
        fill_shape(d, n, INK)

def draw_feet(d, cx, cy, ry, seed):
    """短短的粗腿 + 圆脚掌"""
    for side in (-1, 1):
        fx = cx + side * 13
        stroke(d, [(fx, cy + ry - 7), (fx - side * 1.5, cy + ry + 7)], 5.0, INK, seed + side)
        foot = ellipse_pts(fx - side * 1.5, cy + ry + 8, 6.0, 3.6, seed=seed + 4 + side, wobble=0.06)
        fill_shape(d, foot, PINK)
        ink_path(d, foot, INK, 2.4, seed=seed + 8 + side)

def draw_pig(level):
    img = Image.new('RGBA', (S(BASE), S(BASE)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 手绘底牌
    plate = ellipse_pts(BASE / 2, BASE / 2, 75, 75, seed=level * 13, wobble=0.018)
    fill_shape(d, plate, LEVEL_BG[level])
    ink_path(d, plate, INK_SOFT, 2.2, seed=level * 13 + 1)

    cx, cy = BASE / 2, BASE / 2 + 6
    rx, ry = 40, 37
    seed = level * 97

    body = squircle(cx, cy, rx, ry, power=2.5, seed=seed + 1, wobble=0.018)
    fill_shape(d, body, PINK)
    ink_path(d, body, INK, 3.1, seed=seed + 2)

    draw_ears(d, cx, cy, ry, seed)
    draw_feet(d, cx, cy, ry, seed + 70)
    draw_face_parts(d, cx, cy, seed)

    if level == 1:      # 轻松：闭眼笑 + 呆毛泡泡
        eye_arc_closed(d, cx - 12, cy - 15, 14, seed + 21)
        eye_arc_closed(d, cx + 12, cy - 15, 14, seed + 22)
        mouth_smile(d, cx, cy + 14, 12, seed + 23)
        bubble(d, cx + 44, cy - 38, 5, 1)
        bubble(d, cx + 54, cy - 50, 3.6, 2)
    elif level == 2:    # 比较轻松：眯眼 + 音符
        eye_arc_up(d, cx - 12, cy - 15, 14, seed + 21)
        eye_arc_up(d, cx + 12, cy - 15, 14, seed + 22)
        mouth_smile(d, cx, cy + 14, 12, seed + 23)
        music_note(d, cx + 40, cy - 26, 9, seed + 27)
    elif level == 3:    # 一般：竖线眼 + 平嘴 + 一滴汗
        eye_line(d, cx - 12, cy - 15, 13, 0.8, seed + 21)
        eye_line(d, cx + 12, cy - 15, 13, -0.8, seed + 22)
        mouth_flat(d, cx, cy + 16, 12, seed + 23)
        sweat_drop(d, cx + 42, cy - 28, 9, seed + 29)
    elif level == 4:    # 有点忙：竖线眼 + 张嘴 + 双汗
        eye_line(d, cx - 12, cy - 15, 13, 1.0, seed + 21)
        eye_line(d, cx + 12, cy - 15, 13, -1.0, seed + 22)
        mouth_open(d, cx, cy + 16, 17, 13, seed + 23)
        sweat_drop(d, cx + 40, cy - 34, 9, seed + 29)
        sweat_drop(d, cx + 48, cy - 16, 7, seed + 31)
    else:               # 忙到飞起：X 眼 + 大张嘴 + 炸毛
        eye_x(d, cx - 12, cy - 15, 12, seed + 21)
        eye_x(d, cx + 12, cy - 15, 12, seed + 22)
        mouth_open(d, cx, cy + 16, 19, 15, seed + 23)
        curl = [(cx - 1, cy - 33), (cx + 2, cy - 40), (cx + 8, cy - 41), (cx + 10, cy - 35), (cx + 7, cy - 32)]
        stroke(d, curl, 2.6, INK, seed + 33)
        star(d, cx - 41, cy - 30, 8, seed + 35)
    return img

def draw_cheer(kind):
    img = Image.new('RGBA', (S(BASE), S(BASE)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    plate = ellipse_pts(BASE / 2, BASE / 2, 75, 75, seed=99, wobble=0.018)
    fill_shape(d, plate, (255, 236, 240, 255) if kind == 'thanks' else (255, 244, 220, 255))
    ink_path(d, plate, INK_SOFT, 2.2, seed=100)

    cx, cy = BASE / 2, BASE / 2 + 4
    rx, ry = 38, 35
    seed = 700

    body = squircle(cx, cy, rx, ry, power=2.5, seed=seed + 1, wobble=0.018)
    fill_shape(d, body, PINK)
    ink_path(d, body, INK, 3.1, seed=seed + 2)
    draw_ears(d, cx, cy, ry, seed)
    draw_feet(d, cx, cy, ry, seed + 70)
    draw_face_parts(d, cx, cy, seed)

    if kind == 'thanks':
        eye_arc_closed(d, cx - 12, cy - 16, 14, seed + 21)
        eye_arc_closed(d, cx + 12, cy - 16, 14, seed + 22)
        mouth_smile(d, cx, cy + 14, 12, seed + 23)
        heart(d, cx - 52, cy + 8, 18, seed + 24)
        sweat_drop(d, cx + 44, cy - 30, 9, seed + 25)
        # 擦汗的小手（带小胳膊）
        stroke(d, [(cx + 28, cy + 12), (cx + 35, cy + 19)], 3.6, INK, seed + 33)
        hand = ellipse_pts(cx + 38, cy + 23, 9.5, 7.5, seed=seed + 26, wobble=0.08)
        fill_shape(d, hand, PINK_DEEP)
        ink_path(d, hand, INK, 2.4, seed=seed + 27)
        stroke(d, [(cx + 34, cy + 19), (cx + 42, cy + 19)], 2.0, INK, seed + 28)
    else:
        eye_arc_closed(d, cx - 12, cy - 16, 14, seed + 21)
        eye_arc_closed(d, cx + 12, cy - 16, 14, seed + 22)
        mouth_smile(d, cx, cy + 14, 13, seed + 23)
        # 举起的拳头（带小胳膊）
        stroke(d, [(cx + 30, cy + 8), (cx + 37, cy - 2)], 3.8, INK, seed + 30)
        fist = ellipse_pts(cx + 39, cy - 8, 11, 10, seed=seed + 24, wobble=0.07)
        fill_shape(d, fist, PINK_DEEP)
        ink_path(d, fist, INK, 2.6, seed=seed + 25)
        stroke(d, [(cx + 35, cy - 10), (cx + 43, cy - 10)], 2.0, INK, seed + 26)
        stroke(d, [(cx + 35, cy - 6), (cx + 43, cy - 6)], 2.0, INK, seed + 27)
        star(d, cx - 46, cy - 26, 9, seed + 28)
        star(d, cx - 54, cy - 4, 5, seed + 29)
    return img

def save(img, name):
    img = img.resize((BASE, BASE), Image.LANCZOS)
    path = os.path.join(OUT, name)
    img.save(path, 'PNG')
    print('saved', path, os.path.getsize(path), 'bytes')

# v8.0 打卡按钮素材：卡通猪蹄 + 白色粗粉笔字（签到 / 签退）
# 由 merge 时插入到 generate_pigs.py 的主块之前使用

from PIL import ImageFont, ImageFilter, ImageChops

FONT_CHALK = r"C:\Windows\Fonts\STXINGKA.TTF"
FONT_CHALK_ALT = r"C:\Windows\Fonts\simkai.ttf"

BTN = 240          # 按钮素材逻辑尺寸（最终输出 240x240）
BTN_SS = 4         # 超采样倍数

def B(v):
    """按钮画布坐标缩放"""
    return v * BTN_SS

def chalk_text_mask(text, size_px, seed=20261128):
    """粉笔字掩膜：手写体 + 逐行逐列微抖 + 加粗 + 粉笔颗粒小孔"""
    fp = FONT_CHALK if os.path.exists(FONT_CHALK) else FONT_CHALK_ALT
    font = ImageFont.truetype(fp, size_px)
    bbox = font.getbbox(text)
    pad = int(size_px * 0.4)
    W = bbox[2] - bbox[0] + pad * 2
    H = bbox[3] - bbox[1] + pad * 2
    img = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(img)
    d.text((pad - bbox[0], pad - bbox[1]), text, font=font, fill=255)

    arr = np.array(img).astype(np.float32) / 255.0
    rng = np.random.default_rng(seed)

    # 逐行微抖：粉笔书写的手抖
    rows = rng.integers(-2, 3, H)
    for i in range(H):
        arr[i] = np.roll(arr[i], int(rows[i]))
    # 逐列微抖
    cols = rng.integers(-2, 3, W)
    for j in range(W):
        arr[:, j] = np.roll(arr[:, j], int(cols[j]))

    # 加粗：八方向膨胀
    b = arr.copy()
    for dy in (-2, -1, 1, 2):
        b = np.maximum(b, np.roll(arr, dy, axis=0))
    for dx in (-2, -1, 1, 2):
        b = np.maximum(b, np.roll(arr, dx, axis=1))
    arr = np.clip(b, 0, 1)

    # 粉笔颗粒：随机小孔
    holes = rng.random(arr.shape) < 0.010
    arr[holes] *= 0.30

    return Image.fromarray((arr * 255).astype(np.uint8))

def chalk_text_image(text, size_px, fill=(255, 255, 255, 255), outline=(52, 62, 48, 255), angle=-4, seed=20261128):
    """白色粗粉笔字（带墨色描边），返回 RGBA"""
    m = chalk_text_mask(text, size_px, seed=seed)
    big = m.filter(ImageFilter.MaxFilter(9))
    layer = Image.new('RGBA', m.size, (0, 0, 0, 0))
    layer.paste(outline, (0, 0), big)
    layer.paste(fill, (0, 0), m)
    return layer.rotate(angle, resample=Image.BICUBIC, expand=True)

def draw_hoof(d, cx, cy, seed):
    """卡通猪蹄：圆蹄瓣 + 中缝 + 小腿肚（墨线手绘）"""
    # 小腿肚
    leg = ellipse_pts(cx, cy - 26, 14, 20, seed=seed + 1, wobble=0.05)
    fill_shape(d, leg, PINK)
    ink_path(d, leg, INK, 2.8, seed=seed + 2)
    # 两个蹄瓣
    for side in (-1, 1):
        lobe = ellipse_pts(cx + side * 13, cy + 8, 15, 19, seed=seed + 3 + side, wobble=0.06)
        fill_shape(d, lobe, PINK_DEEP)
        ink_path(d, lobe, INK, 2.8, seed=seed + 5 + side)
    # 中缝
    stroke(d, [(cx, cy - 8), (cx, cy + 24)], 2.4, INK, seed + 9)
    # 高光
    hl = ellipse_pts(cx - 8, cy - 30, 3.5, 5.5, seed=seed + 11, wobble=0.08)
    fill_shape(d, hl, (255, 255, 255, 170))

def draw_check_button(kind):
    """打卡按钮素材：猪蹄 + 白色粗粉笔字。kind: 'in' 签到 / 'out' 签退"""
    canvas = Image.new('RGBA', (B(BTN), B(BTN)), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)

    draw_hoof(d, B(120), B(86), seed=42 if kind == 'in' else 77)

    word = chalk_text_image('签到' if kind == 'in' else '签退', B(120), angle=-4 if kind == 'in' else 4)
    bb = word.getbbox()
    if bb:
        word = word.crop(bb)
    canvas.alpha_composite(word, (int((B(BTN) - word.size[0]) / 2), int(B(150))))

    return canvas

def save_check_buttons():
    for kind, name in (('in', 'btn-sign-in.png'), ('out', 'btn-sign-out.png')):
        img = draw_check_button(kind).resize((BTN, BTN), Image.LANCZOS)
        path = os.path.join(OUT, name)
        img.save(path, 'PNG')
        print('saved', path, os.path.getsize(path), 'bytes')

# 

# 

# 

# 

# 

# 

# 

# 


# >>> V8_BUTTON_ASSETS >>>

import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_CART = r"C:\Windows\Fonts\msyhbd.ttc"     # 微软雅黑 Bold，圆润
FONT_CART_ALT = r"C:\Windows\Fonts\simhei.ttf"

BTN = 240          # 按钮素材逻辑尺寸（最终输出 240x240）
BTN_SS = 4         # 超采样倍数


def B(v):
    """按钮画布坐标缩放（超采样）"""
    return v * BTN_SS


def cartoon_text_mask(text, size_px, seed=1):
    """卡通字掩膜：粗圆体 —— 膨胀加粗 + 高斯圆化，得到胖乎乎的泡泡字"""
    fp = FONT_CART if os.path.exists(FONT_CART) else FONT_CART_ALT
    font = ImageFont.truetype(fp, size_px)
    bbox = font.getbbox(text)
    pad = int(size_px * 0.32)
    W = bbox[2] - bbox[0] + pad * 2
    H = bbox[3] - bbox[1] + pad * 2
    img = Image.new('L', (W, H), 0)
    ImageDraw.Draw(img).text((pad - bbox[0], pad - bbox[1]), text, font=font, fill=255)

    # 膨胀：笔画变粗
    m = img.filter(ImageFilter.MaxFilter(9))
    # 轻微高斯模糊再二值化：只把方角磨圆，字形不能糊
    m = m.filter(ImageFilter.GaussianBlur(size_px * 0.012))
    m = m.point(lambda v: 255 if v > 100 else 0)
    # 再补一次轻微加粗，字更饱满
    m = m.filter(ImageFilter.MaxFilter(3))
    return m


def cartoon_text_image(text, size_px, fill=(255, 255, 255, 255), outline=(52, 62, 48, 255), angle=-3):
    """白色卡通字：深色粗描边 + 白填充 + 顶部柔光高光"""
    m = cartoon_text_mask(text, size_px)
    stroke = m.filter(ImageFilter.MaxFilter(11))
    layer = Image.new('RGBA', m.size, (0, 0, 0, 0))
    layer.paste(outline, (0, 0), stroke)
    layer.paste(fill, (0, 0), m)

    # 高光：字内部上方一条柔光
    hl = m.filter(ImageFilter.GaussianBlur(size_px * 0.02)).point(lambda v: 255 if v > 235 else 0)
    hl = ImageChops_offset(hl, 0, -int(size_px * 0.06))
    hl = ImageChops.multiply(hl, m)
    gloss = Image.new('RGBA', m.size, (255, 255, 255, 0))
    gloss.putalpha(hl.point(lambda v: int(v * 0.55)))
    layer.alpha_composite(gloss)

    return layer.rotate(angle, resample=Image.BICUBIC, expand=True)


def ImageChops_offset(mask, dx, dy):
    """把 L 掩膜整体平移（超出部分填 0）"""
    out = Image.new('L', mask.size, 0)
    out.paste(mask, (dx, dy))
    return out


def draw_snout(d, cx, cy, seed):
    """卡通猪鼻子：粉色鼻头 + 两个墨色鼻孔 + 高光 + 腮红
    cx / cy 为 240 逻辑坐标（内部由 S() 放大到超采样画布）"""
    # 腮红
    for side in (-1, 1):
        bl = ellipse_pts(cx + side * 42, cy + 14, 13, 8, seed=seed + 1 + side, wobble=0.08)
        fill_shape(d, bl, BLUSH)
    # 鼻头：圆角扁椭圆
    nose = squircle(cx, cy, 36, 25, n=110, power=2.2, seed=seed + 4, wobble=0.018)
    fill_shape(d, nose, PINK_DEEP)
    ink_path(d, nose, INK, 3.4, seed=seed + 5)
    # 两个鼻孔（墨色椭圆，略微倾斜）
    for side in (-1, 1):
        hole = ellipse_pts(cx + side * 14, cy + 1, 7.5, 10.0, seed=seed + 8 + side, wobble=0.05)
        fill_shape(d, hole, INK)
    # 高光
    hl = ellipse_pts(cx - 17, cy - 12, 7.5, 4.5, seed=seed + 12, wobble=0.1)
    fill_shape(d, hl, (255, 255, 255, 190))


def draw_check_button(kind):
    """打卡按钮素材：猪脚印 + 白色卡通字。kind: 'in' 签到 / 'out' 签退"""
    canvas = Image.new('RGBA', (B(BTN), B(BTN)), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)

    draw_snout(d, 120, 74, seed=42 if kind == 'in' else 77)

    word = cartoon_text_image('签到' if kind == 'in' else '签退', B(70), angle=-3 if kind == 'in' else 3)
    bb = word.getbbox()
    if bb:
        word = word.crop(bb)
    canvas.alpha_composite(word, (int((B(BTN) - word.size[0]) / 2), int(B(154))))

    return canvas


def save_check_buttons():
    for kind, name in (('in', 'btn-sign-in.png'), ('out', 'btn-sign-out.png')):
        img = draw_check_button(kind).resize((BTN, BTN), Image.LANCZOS)
        path = os.path.join(OUT, name)
        img.save(path, 'PNG')
        print('saved', path, os.path.getsize(path), 'bytes')


# <<< V8_BUTTON_ASSETS <<<

if __name__ == '__main__':
    for lv in range(1, 6):
        save(draw_pig(lv), 'busy-%d.png' % lv)
    save(draw_cheer('thanks'), 'cheer-thanks.png')
    save(draw_cheer('go'), 'cheer-go.png')
    save_check_buttons()
    print('ALL PIGS DONE')
