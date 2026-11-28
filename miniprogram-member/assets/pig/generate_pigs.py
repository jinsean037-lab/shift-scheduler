# -*- coding: utf-8 -*-
"""手绘风卡通小猪 v4（精修版）
风格参考「学工办」手绘小猪：团子身体 + 小尖耳 + 竖线眼睛 + 墨线笔触，彩色版。
"""
import os
import math
import random
from PIL import Image, ImageDraw

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


if __name__ == '__main__':
    for lv in range(1, 6):
        save(draw_pig(lv), 'busy-%d.png' % lv)
    save(draw_cheer('thanks'), 'cheer-thanks.png')
    save(draw_cheer('go'), 'cheer-go.png')
    print('ALL PIGS DONE')
