"""Driver & Renderer cho may in nhan nhiet Clabel CT221B (qua BLE Gateway inut-ble).

Protocol duoc dich nguoc (reverse-engineered) bang REA MCP tu:
1. Clabel Android APK (`com.ct.clabel.mini` / `com.dudian.dlableprinter`):
   - BLE GATT Service UUID: `49535343-fe7d-4ae5-8fa9-9fafd205e455` (ISSC Transparent UART)
   - Notify Characteristic: `49535343-1e4d-4bd9-ba61-23c647249616` (value handle `0x000e`, CCCD `0x000f`)
   - Write Characteristic:  `49535343-8841-43f4-a8d4-ecbe34729bb3` (value handle `0x0011`, props `0x0c` Write/WriteNoResp)
   - Flow Characteristic:   `49535343-aca3-481c-91ec-d85e28a60318` (value handle `0x0013`, CCCD `0x0014`)
   - Classic BT SPP UUID:   `00001101-0000-1000-8000-00805f9b34fb`
   - BLE MTU negotiation: request 512 -> neg 240, chunk size 180 bytes (`PrintConnectController.C = 180`).
2. Clabel Linux CUPS Driver (`rastertolabel` & `ClabelCT221B.ppd`, ModelNumber = 20):
   - Do phan giai: 203 DPI (`8 dots/mm`).
   - Kho giay mac dinh: `400x300` (0.1mm) = `40mm x 30mm` = `320 x 240 dots` (`40 bytes/row x 240 rows = 9600 bytes`).
   - Ngon ngu lenh: TSPL (`SIZE`, `GAP`/`BLINE`, `DIRECTION`, `REFERENCE`, `SHIFT`, `OFFSET`, `DENSITY`, `SPEED`,
     `SET TEAR`, `SET PEEL`, `SET CUTTER`, `SET RIBBON`, `CLS`, `BITMAP`, `TEXT`, `BAR`, `BOX`, `CIRCLE`,
     `ELLIPSE`, `ERASE`, `REVERSE`, `BARCODE`, `QRCODE`, `DMATRIX`, `PDF417`, `PRINT`) ket hop khung vendor
     `CmdHelper$TSC` (`10 1f aa 55 ...`, `10 aX ... <crc8>`) va `TTLV4` (`dd 00 ... <crc8> dd`).
"""
from __future__ import annotations

import base64
import io
import os
import re
import shlex
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Sequence

import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from .config import REPO_ROOT, get_settings

# BLE GATT UUIDs & Handles tren Clabel CT221B-X420
CLABEL_SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455"
CLABEL_NOTIFY_UUID = "49535343-1e4d-4bd9-ba61-23c647249616"
CLABEL_WRITE_UUID = "49535343-8841-43f4-a8d4-ecbe34729bb3"
CLABEL_FLOW_UUID = "49535343-aca3-481c-91ec-d85e28a60318"
CLABEL_SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb"

CLABEL_NOTIFY_HANDLE = 0x000E
CLABEL_NOTIFY_CCCD_HANDLE = 0x000F
CLABEL_WRITE_HANDLE = 0x0011
CLABEL_FLOW_HANDLE = 0x0013
CLABEL_FLOW_CCCD_HANDLE = 0x0014

DOTS_PER_MM = 8  # 203.2 DPI = 8 dots/mm
DEFAULT_BLE_CHUNK_SIZE = 180

FONT_REGULAR_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
FONT_MONO_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

# Bảng CRC-8 (polynomial 0x07) trich xuat tu .rodata cua rastertolabel & CRC8Util.b
CRC8_POLY07_TABLE: tuple[int, ...] = (
    0x00, 0x07, 0x0E, 0x09, 0x1C, 0x1B, 0x12, 0x15, 0x38, 0x3F, 0x36, 0x31, 0x24, 0x23, 0x2A, 0x2D,
    0x70, 0x77, 0x7E, 0x79, 0x6C, 0x6B, 0x62, 0x65, 0x48, 0x4F, 0x46, 0x41, 0x54, 0x53, 0x5A, 0x5D,
    0xE0, 0xE7, 0xEE, 0xE9, 0xFC, 0xFB, 0xF2, 0xF5, 0xD8, 0xDF, 0xD6, 0xD1, 0xC4, 0xC3, 0xCA, 0xCD,
    0x90, 0x97, 0x9E, 0x99, 0x8C, 0x8B, 0x82, 0x85, 0xA8, 0xAF, 0xA6, 0xA1, 0xB4, 0xB3, 0xBA, 0xBD,
    0xC7, 0xC0, 0xC9, 0xCE, 0xDB, 0xDC, 0xD5, 0xD2, 0xFF, 0xF8, 0xF1, 0xF6, 0xE3, 0xE4, 0xED, 0xEA,
    0xB7, 0xB0, 0xB9, 0xBE, 0xAB, 0xAC, 0xA5, 0xA2, 0x8F, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9D, 0x9A,
    0x27, 0x20, 0x29, 0x2E, 0x3B, 0x3C, 0x35, 0x32, 0x1F, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0D, 0x0A,
    0x57, 0x50, 0x59, 0x5E, 0x4B, 0x4C, 0x45, 0x42, 0x6F, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7D, 0x7A,
    0x89, 0x8E, 0x87, 0x80, 0x95, 0x92, 0x9B, 0x9C, 0xB1, 0xB6, 0xBF, 0xB8, 0xAD, 0xAA, 0xA3, 0xA4,
    0xF9, 0xFE, 0xF7, 0xF0, 0xE5, 0xE2, 0xEB, 0xEC, 0xC1, 0xC6, 0xCF, 0xC8, 0xDD, 0xDA, 0xD3, 0xD4,
    0x69, 0x6E, 0x67, 0x60, 0x75, 0x72, 0x7B, 0x7C, 0x51, 0x56, 0x5F, 0x58, 0x4D, 0x4A, 0x43, 0x44,
    0x19, 0x1E, 0x17, 0x10, 0x05, 0x02, 0x0B, 0x0C, 0x21, 0x26, 0x2F, 0x28, 0x3D, 0x3A, 0x33, 0x34,
    0x4E, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5C, 0x5B, 0x76, 0x71, 0x78, 0x7F, 0x6A, 0x6D, 0x64, 0x63,
    0x3E, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2C, 0x2B, 0x06, 0x01, 0x08, 0x0F, 0x1A, 0x1D, 0x14, 0x13,
    0xAE, 0xA9, 0xA0, 0xA7, 0xB2, 0xB5, 0xBC, 0xBB, 0x96, 0x91, 0x98, 0x9F, 0x8A, 0x8D, 0x84, 0x83,
    0xDE, 0xD9, 0xD0, 0xD7, 0xC2, 0xC5, 0xCC, 0xCB, 0xE6, 0xE1, 0xE8, 0xEF, 0xFA, 0xFD, 0xF4, 0xF3,
)


def crc8_poly07(data: bytes) -> int:
    """Tinh CRC-8 (polynomial 0x07) dung trong TTLV4 va envelopedData cua Clabel."""
    crc = 0
    for b in data:
        crc = CRC8_POLY07_TABLE[(crc ^ b) & 0xFF]
    return crc


def crc8_sum(data: bytes) -> int:
    """Tinh checksum tong modulo 256 dung trong CmdHelper$TSC (CRC8Util.a)."""
    return sum(data) & 0xFF


def build_ttlv4_frame(
    func_main: int,
    func_sub: int,
    payload: bytes = b"",
    *,
    mark: int = 0x00,
) -> bytes:
    """Dong goi khung nhi phan TTLV4 / envelopedData cua Clabel:
    `0xdd <mark> <func_main> <func_sub> <len_hi> <len_lo> <payload...> <crc8> 0xdd`
    """
    if len(payload) > 0xFFFF:
        raise ValueError("Payload TTLV4 vuot qua 65535 bytes")
    body = bytes([
        mark & 0xFF,
        func_main & 0xFF,
        func_sub & 0xFF,
        (len(payload) >> 8) & 0xFF,
        len(payload) & 0xFF,
    ]) + payload
    crc = crc8_poly07(body)
    return b"\xdd" + body + bytes([crc, 0xDD])


def normalize_paper_size(width: int | float, height: int | float) -> tuple[int, int, int, int]:
    """Chuan hoa kich thuoc giay:
    - Neu truyen `400x300` (>= 120): hieu la don vi 0.1mm (400 -> 40mm, 300 -> 30mm).
    - Neu truyen `40x30` (<= 110): hieu la don vi mm (40mm x 30mm).
    Tra ve `(width_mm, height_mm, width_dots, height_dots)` tai 203 DPI (8 dots/mm).
    """
    w_val = float(width)
    h_val = float(height)
    if w_val >= 120 or h_val >= 120:
        w_mm = max(10, int(round(w_val / 10.0)))
        h_mm = max(10, int(round(h_val / 10.0)))
    else:
        w_mm = max(10, int(round(w_val)))
        h_mm = max(10, int(round(h_val)))
    w_dots = w_mm * DOTS_PER_MM
    h_dots = h_mm * DOTS_PER_MM
    return w_mm, h_mm, w_dots, h_dots


def _load_font(size: int, *, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    if mono and bold:
        candidates.append(FONT_MONO_BOLD_PATH)
    elif mono:
        candidates.append(FONT_MONO_PATH)
    elif bold:
        candidates.append(FONT_BOLD_PATH)
    candidates.append(FONT_REGULAR_PATH)
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def render_monochrome_image(
    source: str | Path | bytes | Image.Image,
    *,
    width: int | None = None,
    height: int | None = None,
    threshold: int = 172,
    dither: bool = False,
    preserve_outline: bool = True,
    invert: bool = False,
) -> Image.Image:
    """Chuyen doi anh / logo (bao gom logo iNut da sac RGBA) sang anh 1-bit sac net cho dau in nhiet."""
    if isinstance(source, Image.Image):
        im = source.convert("RGBA")
    elif isinstance(source, (bytes, bytearray)):
        im = Image.open(io.BytesIO(source)).convert("RGBA")
    else:
        im = Image.open(source).convert("RGBA")

    if width and height:
        im = im.resize((int(width), int(height)), Image.Resampling.LANCZOS)
    elif width:
        ratio = width / float(im.width)
        im = im.resize((int(width), max(1, int(round(im.height * ratio)))), Image.Resampling.LANCZOS)
    elif height:
        ratio = height / float(im.height)
        im = im.resize((max(1, int(round(im.width * ratio))), int(height)), Image.Resampling.LANCZOS)

    arr = np.array(im, dtype=np.float32)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    alpha = a / 255.0
    rc = r * alpha + 255.0 * (1.0 - alpha)
    gc = g * alpha + 255.0 * (1.0 - alpha)
    bc = b * alpha + 255.0 * (1.0 - alpha)
    lum = 0.299 * rc + 0.587 * gc + 0.114 * bc

    if dither:
        gray_img = Image.fromarray(np.clip(lum, 0, 255).astype(np.uint8), mode="L")
        if invert:
            gray_img = ImageOps.invert(gray_img)
        return gray_img.convert("1", dither=Image.Dither.FLOYDSTEINBERG)

    black_mask = (lum <= float(threshold)) & (a > 96)

    if preserve_outline:
        # Neu anh co kenh alpha trong suot o goc (nhu logo iNut), ve vien 2px quanh khung ngoai
        opaque = (a > 128).astype(np.uint8) * 255
        if np.any(opaque == 0) and np.any(opaque > 0):
            opaque_img = Image.fromarray(opaque, mode="L")
            eroded = np.array(opaque_img.filter(ImageFilter.MinFilter(5)))
            outline_mask = (opaque > 128) & (eroded == 0)
            black_mask = black_mask | outline_mask

    if invert:
        black_mask = ~black_mask

    out = np.where(black_mask, 0, 255).astype(np.uint8)
    return Image.fromarray(out, mode="L").convert("1")


def bitmap_to_tspl_bytes(img: Image.Image, *, threshold: int = 150) -> tuple[int, int, bytes]:
    """Chuyen anh PIL sang mang byte TSPL BITMAP (bit 0 = den/in, bit 1 = trang/khong in, MSB truoc).

    Tra ve `(width_bytes, height_dots, raw_bytes)`.
    """
    if img.mode != "1":
        img = render_monochrome_image(img, threshold=threshold, preserve_outline=False)
    w, h = img.size
    if w % 8 != 0:
        padded_w = ((w + 7) // 8) * 8
        padded = Image.new("1", (padded_w, h), 1)
        padded.paste(img, (0, 0))
        img = padded
        w = padded_w
    raw = img.tobytes()
    return w // 8, h, raw


class ClabelTSPLBuilder:
    """Bo sinh lenh TSPL + Clabel vendor commands day du cho CT221B."""

    def __init__(
        self,
        width: int = 400,
        height: int = 300,
        *,
        gap_mm: int = 2,
        media_type: Literal["gap", "continuous", "mark"] = "gap",
        density: int = 8,
        speed: int = 3,
        direction: int = 0,
        mirror: int = 0,
        tear: bool = True,
        peel: bool = False,
        ribbon: bool | None = None,
        offset_mm: int = 0,
        shift_x: int = 0,
        shift_y: int = 0,
        memory_print: bool | None = None,
    ) -> None:
        self.width_mm, self.height_mm, self.width_dots, self.height_dots = normalize_paper_size(width, height)
        self.gap_mm = int(gap_mm)
        self.media_type = media_type
        self.density = max(0, min(15, int(density)))
        self.speed = max(1, min(12, int(speed)))
        self.direction = 1 if direction else 0
        self.mirror = 1 if mirror else 0
        self.tear = bool(tear)
        self.peel = bool(peel)
        self.ribbon = ribbon
        self.offset_mm = int(offset_mm)
        self.shift_x = int(shift_x)
        self.shift_y = int(shift_y)
        self.memory_print = memory_print
        self._chunks: list[bytes] = []
        self._init_header()

    def _emit(self, cmd: str | bytes) -> "ClabelTSPLBuilder":
        if isinstance(cmd, str):
            self._chunks.append(cmd.encode("gb2312", errors="replace"))
        else:
            self._chunks.append(bytes(cmd))
        return self

    def _init_header(self) -> None:
        if self.memory_print is not None:
            self._emit(build_ttlv4_frame(0x05, 0x07, bytes([1 if self.memory_print else 0])))
        self._emit("\n")
        self._emit(f"SIZE {self.width_mm} mm,{self.height_mm} mm\r\n")
        self._emit(f"DIRECTION {self.direction},{self.mirror}\r\n")
        self._emit("REFERENCE 0,0\r\n")
        if self.media_type == "continuous":
            self._emit("GAP 0 mm,0 mm\r\n")
        elif self.media_type == "mark":
            self._emit(f"BLINE {max(1, self.gap_mm)} mm,0 mm\r\n")
        else:
            self._emit(f"GAP {self.gap_mm} mm,0 mm\r\n")
        if self.ribbon is not None:
            self._emit(f"SET RIBBON {'ON' if self.ribbon else 'OFF'}\r\n")
        self._emit(f"DENSITY {self.density}\r\n")
        self._emit(f"SET TEAR {'ON' if self.tear else 'OFF'}\r\n")
        if self.peel:
            self._emit("SET PEEL ON\r\n")
        self._emit(f"SPEED {self.speed}\r\n")
        if self.offset_mm != 0:
            self._emit(f"OFFSET {self.offset_mm} mm\r\n")
        if self.shift_x != 0 or self.shift_y != 0:
            self._emit(f"SHIFT {self.shift_x},{self.shift_y}\r\n")
        self._emit("CLS\r\n")

    def text(
        self,
        x: int,
        y: int,
        content: str,
        *,
        font: str = "TSS24.BF2",
        rotation: int = 0,
        x_mul: int = 1,
        y_mul: int = 1,
    ) -> "ClabelTSPLBuilder":
        """Lenh TSPL TEXT goc (dung font trong ROM may in: '1'..'8', 'TSS24.BF2')."""
        safe = content.replace('"', "'")
        return self._emit(f'TEXT {int(x)},{int(y)},"{font}",{int(rotation)},{int(x_mul)},{int(y_mul)},"{safe}"\r\n')

    def bar(self, x: int, y: int, width: int, height: int) -> "ClabelTSPLBuilder":
        """Ve thanh/duong den dac (`BAR x,y,w,h`)."""
        return self._emit(f"BAR {int(x)},{int(y)},{int(width)},{int(height)}\r\n")

    def box(
        self,
        x_start: int,
        y_start: int,
        x_end: int,
        y_end: int,
        thickness: int = 2,
        radius: int = 0,
    ) -> "ClabelTSPLBuilder":
        """Ve khung chu nhat (`BOX x1,y1,x2,y2,thickness[,radius]`)."""
        if radius > 0:
            return self._emit(
                f"BOX {int(x_start)},{int(y_start)},{int(x_end)},{int(y_end)},{int(thickness)},{int(radius)}\r\n"
            )
        return self._emit(f"BOX {int(x_start)},{int(y_start)},{int(x_end)},{int(y_end)},{int(thickness)}\r\n")

    def circle(self, x: int, y: int, diameter: int, thickness: int = 2) -> "ClabelTSPLBuilder":
        """Ve hinh tron (`CIRCLE x,y,diameter,thickness`)."""
        return self._emit(f"CIRCLE {int(x)},{int(y)},{int(diameter)},{int(thickness)}\r\n")

    def ellipse(self, x: int, y: int, width: int, height: int, thickness: int = 2) -> "ClabelTSPLBuilder":
        """Ve hinh elip (`ELLIPSE x,y,width,height,thickness`)."""
        return self._emit(f"ELLIPSE {int(x)},{int(y)},{int(width)},{int(height)},{int(thickness)}\r\n")

    def erase(self, x: int, y: int, width: int, height: int) -> "ClabelTSPLBuilder":
        """Xoa trang mot vung tren bo dem anh (`ERASE x,y,w,h`)."""
        return self._emit(f"ERASE {int(x)},{int(y)},{int(width)},{int(height)}\r\n")

    def reverse(self, x: int, y: int, width: int, height: int) -> "ClabelTSPLBuilder":
        """Dao nguoc mau den/trang mot vung (`REVERSE x,y,w,h`)."""
        return self._emit(f"REVERSE {int(x)},{int(y)},{int(width)},{int(height)}\r\n")

    def barcode(
        self,
        x: int,
        y: int,
        code: str,
        *,
        barcode_type: str = "128",
        height: int = 50,
        readable: int = 1,
        rotation: int = 0,
        narrow: int = 2,
        wide: int = 2,
    ) -> "ClabelTSPLBuilder":
        """In ma vach 1D native (`BARCODE`)."""
        safe = code.replace('"', "")
        return self._emit(
            f'BARCODE {int(x)},{int(y)},"{barcode_type}",{int(height)},{int(readable)},'
            f'{int(rotation)},{int(narrow)},{int(wide)},"{safe}"\r\n'
        )

    def qrcode(
        self,
        x: int,
        y: int,
        content: str,
        *,
        ecc: Literal["L", "M", "Q", "H"] = "M",
        cell_width: int = 4,
        mode: Literal["A", "M"] = "A",
        rotation: int = 0,
    ) -> "ClabelTSPLBuilder":
        """In ma QR native (`QRCODE`)."""
        safe = content.replace('"', '\\"')
        return self._emit(f'QRCODE {int(x)},{int(y)},{ecc},{int(cell_width)},{mode},{int(rotation)},"{safe}"\r\n')

    def dmatrix(self, x: int, y: int, width: int, height: int, content: str) -> "ClabelTSPLBuilder":
        """In ma DataMatrix 2D native (`DMATRIX`)."""
        safe = content.replace('"', '\\"')
        return self._emit(f'DMATRIX {int(x)},{int(y)},{int(width)},{int(height)},"{safe}"\r\n')

    def pdf417(
        self,
        x: int,
        y: int,
        width: int,
        height: int,
        content: str,
        *,
        rotation: int = 0,
    ) -> "ClabelTSPLBuilder":
        """In ma PDF417 native (`PDF417`)."""
        safe = content.replace('"', '\\"')
        return self._emit(f'PDF417 {int(x)},{int(y)},{int(width)},{int(height)},{int(rotation)},"{safe}"\r\n')

    def bitmap(
        self,
        x: int,
        y: int,
        image: Image.Image,
        *,
        mode: int = 1,
        threshold: int = 150,
    ) -> "ClabelTSPLBuilder":
        """Chen bitmap 1-bit (`BITMAP x,y,width_bytes,height,mode,data`)."""
        aligned_x = (int(x) // 8) * 8
        width_bytes, height_dots, raw = bitmap_to_tspl_bytes(image, threshold=threshold)
        self._emit(f"BITMAP {aligned_x},{int(y)},{width_bytes},{height_dots},{int(mode)},".encode("ascii"))
        self._emit(raw)
        self._emit(b"\r\n")
        return self

    def sound(self, level: int = 2, interval: int = 100) -> "ClabelTSPLBuilder":
        """Phat tieng bip tren may in (`SOUND level,interval`)."""
        return self._emit(f"SOUND {int(level)},{int(interval)}\r\n")

    def build(self, *, sets: int = 1, copies: int = 1) -> bytes:
        """Hoan tat lenh in voi `PRINT sets,copies` va tra ve chuoi byte TSPL."""
        out = b"".join(self._chunks)
        out += f"PRINT {max(1, int(sets))},{max(1, int(copies))}\r\n".encode("ascii")
        return out


def _wrap_text_lines(draw: ImageDraw.ImageDraw, text: str, font: Any, max_width: int) -> list[str]:
    lines: list[str] = []
    for raw_line in text.splitlines() or [""]:
        words = raw_line.split(" ")
        if not words:
            lines.append("")
            continue
        cur = words[0]
        for w in words[1:]:
            candidate = f"{cur} {w}"
            bbox = draw.textbbox((0, 0), candidate, font=font)
            if (bbox[2] - bbox[0]) <= max_width:
                cur = candidate
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def render_elements_canvas(
    elements: Sequence[dict[str, Any]],
    *,
    width: int = 400,
    height: int = 300,
    border: bool = False,
    border_radius: int = 8,
    border_width: int = 2,
) -> Image.Image:
    """Render danh sach phan tu tuy chinh (text, logo, image, qrcode, barcode, box, line, badge, circle, reverse)
    len canvas 1-bit (mac dinh 320x240 dots cho kho giay 400x300 / 40x30mm).
    """
    _, _, w_dots, h_dots = normalize_paper_size(width, height)
    canvas = Image.new("1", (w_dots, h_dots), 1)
    draw = ImageDraw.Draw(canvas)

    if border:
        if border_radius > 0:
            draw.rounded_rectangle(
                [2, 2, w_dots - 3, h_dots - 3],
                radius=border_radius,
                outline=0,
                width=border_width,
            )
        else:
            draw.rectangle([2, 2, w_dots - 3, h_dots - 3], outline=0, width=border_width)

    for el in elements:
        etype = str(el.get("type", "text")).lower()
        x = int(el.get("x", 0))
        y = int(el.get("y", 0))

        if etype == "text":
            content = str(el.get("text", el.get("content", "")))
            font_size = int(el.get("font_size", el.get("size", 16)))
            bold = bool(el.get("bold", False))
            mono = bool(el.get("mono", False))
            color = 1 if el.get("invert", False) else 0
            max_w = el.get("max_width")
            align = str(el.get("align", "left")).lower()
            line_spacing = int(el.get("line_spacing", 4))
            font = _load_font(font_size, bold=bold, mono=mono)

            if max_w:
                lines = _wrap_text_lines(draw, content, font, int(max_w))
            else:
                lines = content.splitlines() or [content]

            cur_y = y
            for ln in lines:
                bbox = draw.textbbox((0, 0), ln, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                draw_x = x
                if max_w:
                    if align == "center":
                        draw_x = x + max(0, (int(max_w) - tw) // 2)
                    elif align == "right":
                        draw_x = x + max(0, int(max_w) - tw)
                elif align == "center":
                    draw_x = max(0, (w_dots - tw) // 2)
                elif align == "right":
                    draw_x = max(0, w_dots - tw - x)
                draw.text((draw_x, cur_y), ln, font=font, fill=color)
                cur_y += max(font_size, th) + line_spacing

        elif etype in ("logo", "image"):
            img_w = el.get("width", el.get("size", 96))
            img_h = el.get("height", el.get("size", img_w))
            dither = bool(el.get("dither", False))
            thresh = int(el.get("threshold", 172))
            preserve_outline = bool(el.get("preserve_outline", etype == "logo"))
            invert = bool(el.get("invert", False))

            if etype == "logo" and not el.get("path") and not el.get("base64"):
                src: Any = get_settings().logo_path
            elif el.get("base64"):
                b64 = str(el["base64"])
                if "," in b64:
                    b64 = b64.split(",", 1)[1]
                src = base64.b64decode(b64)
            else:
                p = Path(str(el.get("path", "")))
                if not p.is_absolute():
                    p = (REPO_ROOT / p).resolve()
                src = p

            mono_im = render_monochrome_image(
                src,
                width=int(img_w) if img_w else None,
                height=int(img_h) if img_h else None,
                threshold=thresh,
                dither=dither,
                preserve_outline=preserve_outline,
                invert=invert,
            )
            canvas.paste(mono_im, (x, y))

        elif etype == "qrcode":
            data = str(el.get("data", el.get("content", "https://inut.vn")))
            size = int(el.get("size", el.get("width", 88)))
            center_logo = bool(el.get("center_logo", el.get("logo", False)))
            ecc_str = str(el.get("ecc", "H" if center_logo else "M")).upper()
            ecc_map = {
                "L": qrcode.constants.ERROR_CORRECT_L,
                "M": qrcode.constants.ERROR_CORRECT_M,
                "Q": qrcode.constants.ERROR_CORRECT_Q,
                "H": qrcode.constants.ERROR_CORRECT_H,
            }
            qr = qrcode.QRCode(
                version=None,
                error_correction=ecc_map.get(ecc_str, qrcode.constants.ERROR_CORRECT_H),
                box_size=4,
                border=int(el.get("border", 1)),
            )
            qr.add_data(data)
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color="black", back_color="white").convert("1")
            qr_img = qr_img.resize((size, size), Image.Resampling.NEAREST)
            canvas.paste(qr_img, (x, y))
            if center_logo:
                c_size = max(16, int(round(size * 0.21)))
                cx = x + (size - c_size) // 2
                cy = y + (size - c_size) // 2
                draw.rounded_rectangle(
                    [cx - 2, cy - 2, cx + c_size + 1, cy + c_size + 1],
                    radius=3,
                    fill=1,
                    outline=0,
                    width=1,
                )
                mini_logo = render_monochrome_image(
                    get_settings().logo_path,
                    width=c_size,
                    height=c_size,
                    threshold=172,
                    preserve_outline=True,
                )
                canvas.paste(mini_logo, (cx, cy))
        elif etype == "barcode":
            code_val = str(el.get("code", el.get("data", el.get("content", ""))))
            bc_w = int(el.get("width", 180))
            bc_h = int(el.get("height", 48))
            show_text = bool(el.get("show_text", True))
            bc_img = _render_code128_pil(code_val, width=bc_w, height=bc_h, show_text=show_text)
            canvas.paste(bc_img, (x, y))

        elif etype == "line":
            x2 = int(el.get("x2", x + int(el.get("width", w_dots - 2 * x))))
            y2 = int(el.get("y2", y))
            lw = int(el.get("thickness", el.get("line_width", 2)))
            draw.line([(x, y), (x2, y2)], fill=0, width=lw)

        elif etype in ("box", "rect"):
            bw = int(el.get("width", 100))
            bh = int(el.get("height", 40))
            x2 = int(el.get("x2", x + bw))
            y2 = int(el.get("y2", y + bh))
            radius = int(el.get("radius", 0))
            thickness = int(el.get("thickness", 2))
            filled = bool(el.get("fill", False))
            if radius > 0:
                draw.rounded_rectangle(
                    [x, y, x2, y2],
                    radius=radius,
                    outline=0,
                    fill=0 if filled else None,
                    width=thickness,
                )
            else:
                draw.rectangle(
                    [x, y, x2, y2],
                    outline=0,
                    fill=0 if filled else None,
                    width=thickness,
                )

        elif etype == "badge":
            text = str(el.get("text", el.get("content", "")))
            font_size = int(el.get("font_size", 12))
            font = _load_font(font_size, bold=True, mono=bool(el.get("mono", True)))
            bbox = draw.textbbox((0, 0), text, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            pad_x = int(el.get("pad_x", 8))
            pad_y = int(el.get("pad_y", 5))
            bw = int(el.get("width", tw + pad_x * 2))
            bh = int(el.get("height", th + pad_y * 2))
            radius = int(el.get("radius", 5))
            draw.rounded_rectangle([x, y, x + bw, y + bh], radius=radius, fill=0)
            tx = x + max(pad_x, (bw - tw) // 2) if el.get("align") == "center" else x + pad_x
            ty = y + max(2, (bh - th) // 2 - 1)
            draw.text((tx, ty), text, font=font, fill=1)

        elif etype == "circle":
            r = int(el.get("radius", el.get("diameter", 30) // 2))
            thickness = int(el.get("thickness", 2))
            filled = bool(el.get("fill", False))
            draw.ellipse([x, y, x + 2 * r, y + 2 * r], outline=0, fill=0 if filled else None, width=thickness)

        elif etype == "reverse":
            rw = int(el.get("width", 100))
            rh = int(el.get("height", 30))
            region = canvas.crop((x, y, x + rw, y + rh)).convert("L")
            inv = ImageOps.invert(region).convert("1")
            canvas.paste(inv, (x, y))

    return canvas


def _render_code128_pil(code: str, *, width: int = 180, height: int = 48, show_text: bool = True) -> Image.Image:
    """Render ma vach Code128 1-bit bang python-barcode."""
    import barcode
    from barcode.writer import ImageWriter

    cls = barcode.get_barcode_class("code128")
    writer = ImageWriter()
    buf = io.BytesIO()
    bc = cls(code, writer=writer)
    bc.write(
        buf,
        options={
            "write_text": show_text,
            "module_width": 0.25,
            "module_height": 8.0,
            "font_size": 8,
            "text_distance": 2.5,
            "quiet_zone": 1.5,
        },
    )
    buf.seek(0)
    im = Image.open(buf).convert("L")
    im = im.resize((width, height), Image.Resampling.NEAREST)
    return im.point(lambda p: 0 if p < 160 else 255, mode="1")


def render_inut_label(
    *,
    title: str = "iNut JSC",
    subtitle: str = "IoT & Edge Computing",
    lines: Sequence[str] | None = None,
    badge: str = "INUT-BLE GATEWAY READY",
    footer_title: str = "Đắk Lắk - TP.HCM",
    footer_lines: Sequence[str] | None = None,
    qr_data: str | None = "https://inut.vn",
    barcode_data: str | None = None,
    logo_path: str | Path | None = None,
    show_logo: bool = True,
    border: bool = True,
    width: int = 400,
    height: int = 300,
) -> Image.Image:
    """Render tem nhan chuan iNut (400x300 / 40x30mm = 320x240 dots) voi Logo iNut + Text + Badge + QR/Barcode."""
    _, _, w_dots, h_dots = normalize_paper_size(width, height)
    if lines is None:
        lines = [
            f"Gateway: {get_settings().ble_gateway_host}",
            f"Printer: {get_settings().clabel_printer_name}",
            f"Size: {width}x{height} ({w_dots}x{h_dots}px)",
        ]
    if footer_lines is None:
        footer_lines = [
            "MST: 4401053694",
            "https://inut.vn",
        ]

    elements: list[dict[str, Any]] = []

    if show_logo:
        logo_size = min(104, h_dots // 2 - 16)
        elements.append({
            "type": "logo",
            "path": str(logo_path) if logo_path else str(get_settings().logo_path),
            "x": 12,
            "y": 14,
            "size": logo_size,
        })
        text_x = 12 + logo_size + 10
    else:
        text_x = 14

    if title:
        elements.append({
            "type": "text",
            "x": text_x,
            "y": 14,
            "text": title,
            "font_size": 22 if show_logo else 24,
            "bold": True,
            "max_width": w_dots - text_x - 10,
        })
    if subtitle:
        elements.append({
            "type": "text",
            "x": text_x,
            "y": 42,
            "text": subtitle,
            "font_size": 14,
            "bold": True,
            "max_width": w_dots - text_x - 10,
        })
        elements.append({
            "type": "line",
            "x": text_x,
            "y": 63,
            "x2": w_dots - 12,
            "thickness": 2,
        })

    info_y = 69 if subtitle else 46
    for ln in lines[:3]:
        elements.append({
            "type": "text",
            "x": text_x,
            "y": info_y,
            "text": ln,
            "font_size": 13,
            "max_width": w_dots - text_x - 8,
        })
        info_y += 18

    # Divider giua phan tren va phan duoi
    div_y = max(128, info_y + 4)
    elements.append({
        "type": "line",
        "x": 10,
        "y": div_y,
        "x2": w_dots - 10,
        "thickness": 2,
    })

    bottom_y = div_y + 8
    right_reserved = 104 if qr_data else 0

    if badge:
        elements.append({
            "type": "badge",
            "x": 12,
            "y": bottom_y,
            "width": w_dots - 24 - right_reserved,
            "height": 26,
            "text": badge,
            "font_size": 12,
            "mono": True,
        })
        bottom_y += 34

    if barcode_data:
        elements.append({
            "type": "barcode",
            "x": 12,
            "y": bottom_y,
            "width": w_dots - 24 - right_reserved,
            "height": max(36, h_dots - bottom_y - 10),
            "code": barcode_data,
            "show_text": True,
        })
    else:
        if footer_title:
            elements.append({
                "type": "text",
                "x": 12,
                "y": bottom_y,
                "text": footer_title,
                "font_size": 14,
                "bold": True,
                "max_width": w_dots - 20 - right_reserved,
            })
            bottom_y += 22
        for idx, fln in enumerate(footer_lines[:2]):
            elements.append({
                "type": "text",
                "x": 12,
                "y": bottom_y,
                "text": fln,
                "font_size": 12 if idx > 0 else 13,
                "mono": idx > 0,
                "bold": idx > 0,
                "max_width": w_dots - 20 - right_reserved,
            })
            bottom_y += 18

    if qr_data:
        qr_size = min(92, h_dots - div_y - 16)
        elements.append({
            "type": "qrcode",
            "x": w_dots - qr_size - 10,
            "y": div_y + 8,
            "size": qr_size,
            "data": qr_data,
        })

    return render_elements_canvas(elements, width=width, height=height, border=border)


def render_sanxuat_v1_1_label(
    device_id: str = "inut_200_177",
    *,
    mfg_date: str | None = None,
    model_name: str = "iNut Smartcity - Data Logger v1.1 - Rockchip",
    product_line: str = "Rockchip · Xuất xưởng v1.1 ©",
    wifi_pass: str = "inut12345",
    serial_number: str | None = None,
    qr_data: str | None = None,
    qr_logo: bool = True,
    logo_path: str | Path | None = None,
    width: int = 400,
    height: int = 300,
) -> Image.Image:
    """Render tem nhan 'Mau Xuat Xuong v1.1 Rockchip' (400x300 / 40x30mm = 320x240 dots):
    - 100% nen trang (fill=1) + vien den & chu den (fill=0), khong dung nen den de tranh nhoe nhiet
    - Logo iNut sac net kem bieu tuong (R) Registered Trademark va (C) Copyright
    - Ten xuat hoa don chuan: 'iNut Smartcity - Data Logger v1.1 - Rockchip'
    - Khung huy hieu ★ MAKE IN VIETNAM (nen trang vien den)
    - Khung SN / Ma thiet bi duy nhat (vd: inut_207_153) + QR Code ma thiet bi (co logo iNut o tam)
    - Dong Pass Wi-Fi mac dinh: inut12345
    - Ngay san xuat (NSX) mac dinh la ngay goi lenh in (DD/MM/YYYY) + dau QC PASS (nen trang vien den)
    """
    _, _, w_dots, h_dots = normalize_paper_size(width, height)
    if not mfg_date:
        mfg_date = datetime.now().strftime("%d/%m/%Y")
    clean_id = (device_id or serial_number or "inut_200_177").strip()
    qr_payload = (qr_data or clean_id).strip()
    resolved_logo = Path(logo_path) if logo_path else get_settings().logo_path

    canvas = Image.new("1", (w_dots, h_dots), 1)
    draw = ImageDraw.Draw(canvas)

    # Khung vien cong nghiep bo goc (320x240) - nen trang vien den
    draw.rounded_rectangle([2, 2, w_dots - 3, h_dots - 3], radius=8, outline=0, width=2)

    # Goc tren ben trai: Logo iNut (60x60) + icon (R)
    logo_size = 60
    logo_x, logo_y = 10, 11
    logo_img = render_monochrome_image(
        resolved_logo,
        width=logo_size,
        height=logo_size,
        threshold=172,
        preserve_outline=True,
    )
    canvas.paste(logo_img, (logo_x, logo_y))

    font_r_badge = _load_font(10, bold=True)
    draw.ellipse(
        [logo_x + logo_size - 9, logo_y - 3, logo_x + logo_size + 5, logo_y + 11],
        fill=1,
        outline=0,
        width=1,
    )
    draw.text((logo_x + logo_size - 5, logo_y - 2), "R", font=font_r_badge, fill=0)

    # Cum tieu de ben phai logo (x = 78..310)
    hx = 78
    font_brand = _load_font(17, bold=True)
    draw.text((hx, 9), "iNut® JSC", font=font_brand, fill=0)

    # Huy hieu ★ MAKE IN VIETNAM (NỀN TRẮNG - VIỀN ĐEN 2PX - CHỮ ĐEN ĐẬM)
    miv_x, miv_y, miv_w, miv_h = 182, 8, 128, 22
    draw.rounded_rectangle([miv_x, miv_y, miv_x + miv_w, miv_y + miv_h], radius=4, fill=1, outline=0, width=2)
    font_miv = _load_font(10, bold=True)
    miv_text = "★ MAKE IN VIETNAM"
    bbox_miv = draw.textbbox((0, 0), miv_text, font=font_miv)
    tw_miv = bbox_miv[2] - bbox_miv[0]
    draw.text((miv_x + (miv_w - tw_miv) // 2, miv_y + 5), miv_text, font=font_miv, fill=0)

    # Tieu de ten xuat hoa don chuan: "iNut Smartcity - Data Logger v1.1 - Rockchip"
    font_inv1 = _load_font(12, bold=True)
    font_inv2 = _load_font(11, bold=True)
    if " - " in model_name and len(model_name) > 28:
        parts = model_name.split(" - ")
        line1 = f"{parts[0]} - {parts[1]}" if len(parts) >= 2 else model_name
        line2 = f"{' - '.join(parts[2:])} · Xuất xưởng ©" if len(parts) >= 3 else product_line
        draw.text((hx, 34), line1, font=font_inv1, fill=0)
        draw.text((hx, 51), line2, font=font_inv2, fill=0)
    else:
        draw.text((hx, 34), model_name, font=font_inv1, fill=0)
        draw.text((hx, 51), product_line, font=font_inv2, fill=0)

    # Duong phan cach ngang y = 74
    draw.line([(8, 74), (w_dots - 9, 74)], fill=0, width=2)

    # Cột trái (x = 10..198, y = 80..195):
    # 1. Khung SN / MÃ THIẾT BỊ (Nền trắng, viền đen 2px, chữ mã thiết bị to hơn 50%: 25px)
    box_x1, box_x2 = 8, 200
    box_w = box_x2 - box_x1
    draw.rounded_rectangle([box_x1, 79, box_x2, 136], radius=5, fill=1, outline=0, width=2)
    draw.line([(box_x1, 96), (box_x2, 96)], fill=0, width=1)
    font_tag = _load_font(10, bold=True)
    tag_txt = "SN / MÃ THIẾT BỊ (DEVICE ID)"
    bbox_tag = draw.textbbox((0, 0), tag_txt, font=font_tag)
    tw_tag = bbox_tag[2] - bbox_tag[0]
    draw.text((box_x1 + max(4, (box_w - tw_tag) // 2), 82), tag_txt, font=font_tag, fill=0)

    id_font_size = 25
    while id_font_size > 14:
        font_id = _load_font(id_font_size, bold=True, mono=True)
        bbox_id = draw.textbbox((0, 0), clean_id, font=font_id)
        if (bbox_id[2] - bbox_id[0]) <= (box_w - 8):
            break
        id_font_size -= 1
    font_id = _load_font(id_font_size, bold=True, mono=True)
    bbox_id = draw.textbbox((0, 0), clean_id, font=font_id)
    tw_id = bbox_id[2] - bbox_id[0]
    th_id = bbox_id[3] - bbox_id[1]
    id_y = 97 + max(1, (38 - th_id) // 2) - bbox_id[1]
    draw.text((box_x1 + max(3, (box_w - tw_id) // 2) - bbox_id[0], id_y), clean_id, font=font_id, fill=0)

    # 2. Dòng Pass Wi-Fi mặc định: inut12345 (Nền trắng, viền đen, chữ đen)
    draw.rounded_rectangle([box_x1, 141, box_x2, 165], radius=4, fill=1, outline=0, width=1)
    font_wifi_lbl = _load_font(11, bold=True)
    font_wifi_val = _load_font(12, bold=True, mono=True)
    draw.text((14, 147), "Pass Wi-Fi:", font=font_wifi_lbl, fill=0)
    draw.text((94, 146), wifi_pass, font=font_wifi_val, fill=0)

    # 3. Hộp Ngày sản xuất (NSX = ngày kêu in) + dấu QC PASS (Nền trắng, viền đen, chữ đen)
    draw.rounded_rectangle([box_x1, 170, box_x2, 195], radius=4, fill=1, outline=0, width=1)
    font_date = _load_font(11, bold=True)
    draw.text((14, 176), f"NSX: {mfg_date}", font=font_date, fill=0)
    draw.rounded_rectangle([140, 173, 196, 192], radius=3, fill=1, outline=0, width=1)
    font_qc = _load_font(9, bold=True, mono=True)
    draw.text((146, 177), "QC PASS", font=font_qc, fill=0)

    # Cột phải (x = 206..310, y = 80..200): QR Code mã thiết bị có logo iNut ở tâm (GIỮ NGUYÊN)
    qr_size = 104
    qr_x = w_dots - qr_size - 10
    qr_y = 80
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=4,
        border=1,
    )
    qr.add_data(qr_payload)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("1")
    qr_img = qr_img.resize((qr_size, qr_size), Image.Resampling.NEAREST)
    canvas.paste(qr_img, (qr_x, qr_y))

    if qr_logo:
        c_size = 22
        cx = qr_x + (qr_size - c_size) // 2
        cy = qr_y + (qr_size - c_size) // 2
        draw.rounded_rectangle(
            [cx - 2, cy - 2, cx + c_size + 1, cy + c_size + 1],
            radius=3,
            fill=1,
            outline=0,
            width=1,
        )
        mini_logo = render_monochrome_image(
            resolved_logo,
            width=c_size,
            height=c_size,
            threshold=172,
            preserve_outline=True,
        )
        canvas.paste(mini_logo, (cx, cy))

    font_qrcap = _load_font(9, bold=True, mono=True)
    cap_txt = f"QR: {clean_id}" if len(clean_id) <= 13 else "SCAN DEVICE ID"
    bbox_cap = draw.textbbox((0, 0), cap_txt, font=font_qrcap)
    tw_cap = bbox_cap[2] - bbox_cap[0]
    draw.text((qr_x + (qr_size - tw_cap) // 2, qr_y + qr_size + 2), cap_txt, font=font_qrcap, fill=0)

    # Chân trang (y = 201..237): Copyright © & Registered ® (Nền trắng, chữ đen)
    draw.line([(8, 201), (w_dots - 9, 201)], fill=0, width=2)
    font_foot_b = _load_font(10, bold=True)
    font_foot = _load_font(10, bold=False)
    draw.text((12, 206), "© 2026 INUT® JSC · DN KH&CN", font=font_foot_b, fill=0)
    draw.text((12, 220), "MST: 4401053694 · https://inut.vn", font=font_foot, fill=0)

    stamp_x, stamp_y, stamp_w, stamp_h = 226, 206, 84, 25
    draw.rounded_rectangle([stamp_x, stamp_y, stamp_x + stamp_w, stamp_y + stamp_h], radius=4, fill=1, outline=0, width=1)
    font_stamp = _load_font(10, bold=True)
    st_txt = "iNut® © v1.1"
    bbox_st = draw.textbbox((0, 0), st_txt, font=font_stamp)
    tw_st = bbox_st[2] - bbox_st[0]
    draw.text((stamp_x + (stamp_w - tw_st) // 2, stamp_y + 6), st_txt, font=font_stamp, fill=0)

    return canvas


def build_label_tspl(
    image: Image.Image,
    *,
    width: int = 400,
    height: int = 300,
    copies: int = 1,
    density: int | None = None,
    speed: int | None = None,
    gap_mm: int | None = None,
    media_type: Literal["gap", "continuous", "mark"] = "gap",
    threshold: int = 150,
) -> bytes:
    """Dong goi 1 anh PIL thanh goi lenh TSPL hoan chinh de gui toi CT221B."""
    s = get_settings()
    builder = ClabelTSPLBuilder(
        width=width,
        height=height,
        gap_mm=gap_mm if gap_mm is not None else s.clabel_default_gap_mm,
        media_type=media_type,
        density=density if density is not None else s.clabel_default_density,
        speed=speed if speed is not None else s.clabel_default_speed,
    )
    builder.bitmap(0, 0, image, mode=1, threshold=threshold)
    return builder.build(sets=1, copies=copies)


@dataclass
class ClabelBLEGateway:
    """Client dieu khien BLE Gateway (`root@77.88.207.23`) de quet va in sang Clabel CT221B."""

    host: str = field(default_factory=lambda: get_settings().ble_gateway_host)
    user: str = field(default_factory=lambda: get_settings().ble_gateway_user)
    port: int = field(default_factory=lambda: get_settings().ble_gateway_port)
    ssh_key_path: str = field(default_factory=lambda: get_settings().ble_gateway_ssh_key_path)
    timeout: int = field(default_factory=lambda: get_settings().ble_gateway_timeout)

    def _ssh_base_args(self) -> list[str]:
        args = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=no",
            "-o", f"ConnectTimeout={min(15, self.timeout)}",
            "-p", str(self.port),
        ]
        if self.ssh_key_path and os.path.exists(self.ssh_key_path):
            args.extend(["-i", self.ssh_key_path])
        args.append(f"{self.user}@{self.host}")
        return args

    def run_remote(self, command: str, *, input_bytes: bytes | None = None, timeout: int | None = None) -> subprocess.CompletedProcess:
        cmd = self._ssh_base_args() + [command]
        return subprocess.run(
            cmd,
            input=input_bytes,
            capture_output=True,
            timeout=timeout or self.timeout,
            check=False,
        )

    def scan_printers(self, *, scan_seconds: int = 5) -> list[dict[str, str]]:
        """Quet cac thiet bi BLE tren gateway 77.88.207.23 va tra ve danh sach."""
        remote_cmd = (
            f"bluetoothctl --timeout {int(scan_seconds)} scan on >/dev/null 2>&1; "
            "bluetoothctl devices"
        )
        res = self.run_remote(remote_cmd, timeout=scan_seconds + 15)
        out = res.stdout.decode("utf-8", errors="replace")
        devices: list[dict[str, str]] = []
        for line in out.splitlines():
            m = re.match(r"^Device\s+([0-9A-Fa-f:]{17})\s+(.+)$", line.strip())
            if m:
                mac, name = m.group(1).upper(), m.group(2).strip()
                devices.append({
                    "mac": mac,
                    "name": name,
                    "is_clabel": "CT" in name.upper() or "CLABEL" in name.upper(),
                })
        return devices

    def resolve_printer_mac(
        self,
        printer_name: str | None = None,
        printer_mac: str | None = None,
    ) -> str:
        """Tim dia chi MAC cua may in Clabel (mac dinh CT221B-X420 -> 03:22:32:84:D6:7F)."""
        s = get_settings()
        if printer_mac and re.match(r"^[0-9A-Fa-f:]{17}$", printer_mac.strip()):
            return printer_mac.strip().upper()
        target_name = (printer_name or s.clabel_printer_name or "CT221B-X420").strip()
        for dev in self.scan_printers(scan_seconds=4):
            if dev["name"].upper() == target_name.upper() or target_name.upper() in dev["name"].upper():
                return dev["mac"]
        return (s.clabel_printer_mac or "03:22:32:84:D6:7F").upper()

    def get_gateway_status(self) -> dict[str, Any]:
        """Kiem tra trang thai bluetooth.service, ble-remote.service va may in tren gateway."""
        s = get_settings()
        remote_py = f"""python3 -c '
import json, subprocess
def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()
bt_active = run("systemctl is-active bluetooth.service")
ble_remote_active = run("systemctl is-active ble-remote.service")
devs = run("bluetoothctl devices")
info = run("bluetoothctl info {shlex.quote(s.clabel_printer_mac)}")
print(json.dumps({{
    "hostname": run("hostname"),
    "bluetooth_service": bt_active,
    "ble_remote_service": ble_remote_active,
    "devices_raw": devs,
    "printer_info_raw": info,
}}))
'"""
        res = self.run_remote(remote_py, timeout=15)
        if res.returncode != 0:
            raise RuntimeError(f"Khong the ket noi BLE Gateway {self.host}: {res.stderr.decode('utf-8', errors='replace')}")
        import json
        data = json.loads(res.stdout.decode("utf-8"))
        data["gateway_host"] = self.host
        data["printer_name"] = s.clabel_printer_name
        data["printer_mac"] = s.clabel_printer_mac
        data["printer_visible"] = s.clabel_printer_mac.upper() in data.get("devices_raw", "").upper()
        return data

    def send_tspl(
        self,
        payload: bytes,
        *,
        mac: str | None = None,
        chunk_size: int = DEFAULT_BLE_CHUNK_SIZE,
        mtu: int = 512,
        retries: int = 2,
    ) -> dict[str, Any]:
        """Gui goi lenh TSPL qua BLE GATT toi may in Clabel CT221B tren gateway 77.88.207.23."""
        target_mac = (mac or get_settings().clabel_printer_mac or "03:22:32:84:D6:7F").strip().upper()
        if not re.match(r"^[0-9A-F:]{17}$", target_mac):
            raise ValueError(f"Dia chi MAC khong hop le: {target_mac}")

        remote_script = f"""python3 -c '
import os, re, select, subprocess, sys, time, json

mac = "{target_mac}"
chunk_size = {int(chunk_size)}
req_mtu = {int(mtu)}
max_retries = {int(retries)}
data = sys.stdin.buffer.read()

def attempt_print(scan_first=False):
    if scan_first:
        subprocess.run(["bluetoothctl", "--timeout", "4", "scan", "on"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p = subprocess.Popen(
        ["gatttool", "-b", mac, "-I"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=0,
    )
    os.set_blocking(p.stdout.fileno(), False)

    def read_until(pattern, timeout=5.0):
        buf = ""
        deadline = time.time() + timeout
        while time.time() < deadline:
            r, _, _ = select.select([p.stdout], [], [], 0.05)
            if r:
                chunk = p.stdout.read(4096)
                if chunk:
                    buf += chunk.decode("utf-8", errors="ignore")
                    if re.search(pattern, buf):
                        return True, buf
                    if "connect error" in buf.lower() or "connection refused" in buf.lower():
                        return False, buf
        return False, buf

    def send_cmd(cmd, expect, timeout=5.0):
        p.stdin.write((cmd + "\\n").encode("ascii"))
        p.stdin.flush()
        return read_until(expect, timeout)

    try:
        ok, out = send_cmd("connect", r"Connection successful", timeout=8.0)
        if not ok:
            return False, {{"error": "connect_failed", "log": out}}

        ok_mtu, out_mtu = send_cmd(f"mtu {{req_mtu}}", r"MTU was exchanged successfully: \\d+", timeout=3.0)
        m_mtu = re.search(r"MTU was exchanged successfully: (\\d+)", out_mtu)
        negotiated_mtu = int(m_mtu.group(1)) if m_mtu else 23

        send_cmd("char-write-req 0x000f 0100", r"Characteristic value was written successfully", timeout=2.0)

        chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]
        t0 = time.time()
        for idx, ch in enumerate(chunks):
            ok_w, out_w = send_cmd(
                f"char-write-req 0x0011 {{ch.hex()}}",
                r"Characteristic value was written successfully",
                timeout=5.0,
            )
            if not ok_w:
                return False, {{"error": f"write_chunk_{{idx}}_failed", "log": out_w}}
        elapsed = round(time.time() - t0, 3)

        _, tail_out = read_until(r"__WAIT_FLUSH__", timeout=1.2)
        send_cmd("disconnect", r".*", timeout=1.0)
        return True, {{
            "ok": True,
            "mac": mac,
            "bytes_sent": len(data),
            "chunks_sent": len(chunks),
            "chunk_size": chunk_size,
            "negotiated_mtu": negotiated_mtu,
            "elapsed_sec": elapsed,
        }}
    finally:
        try:
            p.stdin.write(b"exit\\n")
            p.stdin.flush()
        except Exception:
            pass
        p.terminate()

last_err = None
for attempt in range(max_retries + 1):
    ok, info = attempt_print(scan_first=(attempt > 0))
    if ok:
        info["attempt"] = attempt + 1
        print(json.dumps(info))
        sys.exit(0)
    last_err = info
    time.sleep(1.0)

print(json.dumps({{"ok": False, "mac": mac, "detail": last_err}}))
sys.exit(1)
'"""
        res = self.run_remote(remote_script, input_bytes=payload, timeout=max(30, self.timeout))
        stdout_text = res.stdout.decode("utf-8", errors="replace").strip()
        stderr_text = res.stderr.decode("utf-8", errors="replace").strip()
        import json
        for line in reversed(stdout_text.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                parsed = json.loads(line)
                if not parsed.get("ok"):
                    raise RuntimeError(f"In BLE that bai tren {target_mac}: {parsed}")
                parsed["gateway_host"] = self.host
                return parsed
        raise RuntimeError(
            f"Loi khi gui lenh in BLE qua {self.host} (exit={res.returncode}): stdout={stdout_text} stderr={stderr_text}"
        )

    def send_tspl_batch(
        self,
        payloads: Sequence[bytes],
        *,
        labels: Sequence[str] | None = None,
        mac: str | None = None,
        chunk_size: int = DEFAULT_BLE_CHUNK_SIZE,
        mtu: int = 512,
        inter_label_pause: float = 1.6,
    ) -> dict[str, Any]:
        """In hang loat nhieu tem TSPL trong CUNG 1 phien BLE GATT (tranh connect/disconnect lap lai)."""
        if not payloads:
            return {"ok": True, "printed_count": 0, "items": []}
        target_mac = (mac or get_settings().clabel_printer_mac or "03:22:32:84:D6:7F").strip().upper()
        if not re.match(r"^[0-9A-F:]{17}$", target_mac):
            raise ValueError(f"Dia chi MAC khong hop le: {target_mac}")

        import json
        batch_spec = json.dumps([
            {
                "label": (labels[i] if labels and i < len(labels) else f"item_{i+1}"),
                "b64": base64.b64encode(p).decode("ascii"),
            }
            for i, p in enumerate(payloads)
        ]).encode("utf-8")

        remote_script = f"""python3 -c '
import base64, json, os, re, select, subprocess, sys, time

mac = "{target_mac}"
chunk_size = {int(chunk_size)}
req_mtu = {int(mtu)}
pause_sec = {float(inter_label_pause)}
items = json.loads(sys.stdin.buffer.read().decode("utf-8"))

def open_gatt(scan_first=False):
    if scan_first:
        subprocess.run(["bluetoothctl", "--timeout", "4", "scan", "on"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    p = subprocess.Popen(
        ["gatttool", "-b", mac, "-I"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=0,
    )
    os.set_blocking(p.stdout.fileno(), False)

    def read_until(pattern, timeout=5.0):
        buf = ""
        deadline = time.time() + timeout
        while time.time() < deadline:
            r, _, _ = select.select([p.stdout], [], [], 0.04)
            if r:
                chunk = p.stdout.read(4096)
                if chunk:
                    buf += chunk.decode("utf-8", errors="ignore")
                    if re.search(pattern, buf):
                        return True, buf
                    if "connect error" in buf.lower() or "connection refused" in buf.lower() or "disconnected" in buf.lower():
                        return False, buf
        return False, buf

    def send_cmd(cmd, expect, timeout=5.0):
        p.stdin.write((cmd + "\\n").encode("ascii"))
        p.stdin.flush()
        return read_until(expect, timeout)

    ok, out = send_cmd("connect", r"Connection successful", timeout=8.0)
    if not ok:
        try:
            p.terminate()
        except Exception:
            pass
        return None, None, None, out

    ok_mtu, out_mtu = send_cmd(f"mtu {{req_mtu}}", r"MTU was exchanged successfully: \\d+", timeout=3.0)
    m_mtu = re.search(r"MTU was exchanged successfully: (\\d+)", out_mtu)
    neg_mtu = int(m_mtu.group(1)) if m_mtu else 23
    send_cmd("char-write-req 0x000f 0100", r"Characteristic value was written successfully", timeout=2.0)
    return p, send_cmd, read_until, neg_mtu

p, send_cmd, read_until, neg_mtu = None, None, None, 240
results = []
t_start = time.time()

try:
    for idx, it in enumerate(items):
        raw = base64.b64decode(it["b64"])
        chunks = [raw[i:i+chunk_size] for i in range(0, len(raw), chunk_size)]
        sent_ok = False
        last_err = ""
        for attempt in range(3):
            if p is None:
                p, send_cmd, read_until, neg_mtu = open_gatt(scan_first=(attempt > 0))
                if p is None:
                    last_err = str(neg_mtu)
                    time.sleep(1.0)
                    continue
            t0 = time.time()
            chunk_err = False
            for c_idx, ch in enumerate(chunks):
                ok_w, out_w = send_cmd(
                    f"char-write-req 0x0011 {{ch.hex()}}",
                    r"Characteristic value was written successfully",
                    timeout=5.0,
                )
                if not ok_w:
                    chunk_err = True
                    last_err = f"chunk_{{c_idx}}: {{out_w}}"
                    try:
                        p.terminate()
                    except Exception:
                        pass
                    p = None
                    break
            if not chunk_err:
                el = round(time.time() - t0, 3)
                results.append({{
                    "index": idx + 1,
                    "label": it["label"],
                    "bytes_sent": len(raw),
                    "chunks_sent": len(chunks),
                    "elapsed_sec": el,
                }})
                sent_ok = True
                if idx + 1 < len(items):
                    read_until(r"__WAIT_INTER_LABEL__", timeout=pause_sec)
                else:
                    read_until(r"__WAIT_FLUSH__", timeout=1.2)
                break
            time.sleep(1.0)
        if not sent_ok:
            print(json.dumps({{"ok": False, "mac": mac, "failed_at": it["label"], "error": last_err, "completed": results}}))
            sys.exit(1)
finally:
    if p is not None:
        try:
            send_cmd("disconnect", r".*", timeout=1.0)
            p.stdin.write(b"exit\\n")
            p.stdin.flush()
        except Exception:
            pass
        p.terminate()

print(json.dumps({{
    "ok": True,
    "mac": mac,
    "printed_count": len(results),
    "negotiated_mtu": neg_mtu,
    "total_elapsed_sec": round(time.time() - t_start, 3),
    "items": results,
}}))
'"""
        total_timeout = max(60, int(len(payloads) * 15) + 30)
        res = self.run_remote(remote_script, input_bytes=batch_spec, timeout=total_timeout)
        stdout_text = res.stdout.decode("utf-8", errors="replace").strip()
        stderr_text = res.stderr.decode("utf-8", errors="replace").strip()
        for line in reversed(stdout_text.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                parsed = json.loads(line)
                if not parsed.get("ok"):
                    raise RuntimeError(f"In batch BLE that bai tren {target_mac}: {parsed}")
                parsed["gateway_host"] = self.host
                return parsed
        raise RuntimeError(
            f"Loi khi gui batch BLE qua {self.host} (exit={res.returncode}): stdout={stdout_text} stderr={stderr_text}"
        )


def print_inut_label(
    *,
    title: str = "iNut JSC",
    subtitle: str = "IoT & Edge Computing",
    lines: Sequence[str] | None = None,
    badge: str = "INUT-BLE GATEWAY READY",
    footer_title: str = "Đắk Lắk - TP.HCM",
    footer_lines: Sequence[str] | None = None,
    qr_data: str | None = "https://inut.vn",
    barcode_data: str | None = None,
    logo_path: str | Path | None = None,
    show_logo: bool = True,
    border: bool = True,
    width: int = 400,
    height: int = 300,
    copies: int = 1,
    density: int | None = None,
    speed: int | None = None,
    mac: str | None = None,
    gateway_host: str | None = None,
    print_remote: bool = True,
    save_preview_path: str | Path | None = None,
) -> dict[str, Any]:
    """Render va in tem nhan Clabel CT221B qua BLE Gateway 77.88.207.23."""
    img = render_inut_label(
        title=title,
        subtitle=subtitle,
        lines=lines,
        badge=badge,
        footer_title=footer_title,
        footer_lines=footer_lines,
        qr_data=qr_data,
        barcode_data=barcode_data,
        logo_path=logo_path,
        show_logo=show_logo,
        border=border,
        width=width,
        height=height,
    )
    if save_preview_path:
        img.save(save_preview_path)

    tspl_bytes = build_label_tspl(
        img,
        width=width,
        height=height,
        copies=copies,
        density=density,
        speed=speed,
    )

    png_buf = io.BytesIO()
    img.save(png_buf, format="PNG")
    preview_b64 = base64.b64encode(png_buf.getvalue()).decode("ascii")

    w_mm, h_mm, w_dots, h_dots = normalize_paper_size(width, height)
    result: dict[str, Any] = {
        "width_mm": w_mm,
        "height_mm": h_mm,
        "width_dots": w_dots,
        "height_dots": h_dots,
        "tspl_bytes_len": len(tspl_bytes),
        "preview_png_base64": preview_b64,
        "is_printed": False,
    }

    if print_remote:
        gw = ClabelBLEGateway(host=gateway_host or get_settings().ble_gateway_host)
        send_res = gw.send_tspl(tspl_bytes, mac=mac)
        result.update(send_res)
        result["is_printed"] = True

    return result


def print_sanxuat_v1_1_label(
    device_id: str = "inut_200_177",
    *,
    mfg_date: str | None = None,
    model_name: str = "iNut Smartcity - Data Logger v1.1 - Rockchip",
    product_line: str = "Rockchip · Xuất xưởng v1.1 ©",
    wifi_pass: str = "inut12345",
    serial_number: str | None = None,
    qr_data: str | None = None,
    qr_logo: bool = True,
    logo_path: str | Path | None = None,
    width: int = 400,
    height: int = 300,
    copies: int = 1,
    density: int | None = None,
    speed: int | None = None,
    mac: str | None = None,
    gateway_host: str | None = None,
    print_remote: bool = True,
    save_preview_path: str | Path | None = None,
) -> dict[str, Any]:
    """Render va in tem 'Mau Xuat Xuong v1.1 Rockchip' (400x300) qua BLE Gateway 77.88.207.23."""
    resolved_date = mfg_date or datetime.now().strftime("%d/%m/%Y")
    clean_id = (device_id or serial_number or "inut_200_177").strip()
    img = render_sanxuat_v1_1_label(
        device_id=clean_id,
        mfg_date=resolved_date,
        model_name=model_name,
        product_line=product_line,
        wifi_pass=wifi_pass,
        serial_number=serial_number,
        qr_data=qr_data,
        qr_logo=qr_logo,
        logo_path=logo_path,
        width=width,
        height=height,
    )
    if save_preview_path:
        img.save(save_preview_path)

    tspl_bytes = build_label_tspl(
        img,
        width=width,
        height=height,
        copies=copies,
        density=density,
        speed=speed,
    )

    png_buf = io.BytesIO()
    img.save(png_buf, format="PNG")
    preview_b64 = base64.b64encode(png_buf.getvalue()).decode("ascii")

    w_mm, h_mm, w_dots, h_dots = normalize_paper_size(width, height)
    result: dict[str, Any] = {
        "template": "sanxuat_v1.1",
        "device_id": clean_id,
        "serial_number": clean_id,
        "wifi_pass": wifi_pass,
        "mfg_date": resolved_date,
        "model_name": model_name,
        "width_mm": w_mm,
        "height_mm": h_mm,
        "width_dots": w_dots,
        "height_dots": h_dots,
        "tspl_bytes_len": len(tspl_bytes),
        "preview_png_base64": preview_b64,
        "is_printed": False,
    }

    if print_remote:
        gw = ClabelBLEGateway(host=gateway_host or get_settings().ble_gateway_host)
        send_res = gw.send_tspl(tspl_bytes, mac=mac)
        result.update(send_res)
        result["is_printed"] = True
        try:
            from contextlib import closing
            from .db import get_session, init_db

            init_db()
            with closing(next(get_session())) as db:
                record_clabel_device_print(
                    db,
                    clean_id,
                    mfg_date=resolved_date,
                    model_name=model_name,
                    wifi_pass=wifi_pass,
                )
        except Exception:
            pass

    return result


def parse_device_id_list(raw: str | Sequence[str]) -> list[str]:
    """Chuan hoa danh sach ma thiet bi (phan cach bang dau phay, xuong dong hoac khoang trang)."""
    if isinstance(raw, str):
        tokens = re.split(r"[,;\n\r\t ]+", raw)
    else:
        tokens = []
        for item in raw:
            tokens.extend(re.split(r"[,;\n\r\t ]+", str(item)))
    seen: set[str] = set()
    out: list[str] = []
    for tk in tokens:
        clean = tk.strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def record_clabel_device_print(
    db: Any,
    device_id: str,
    *,
    mfg_date: str | None = None,
    model_name: str = "iNut Smartcity - Data Logger v1.1 - Rockchip",
    wifi_pass: str = "inut12345",
    batch_code: str = "",
) -> Any:
    """Ghi nhan hoac cap nhat trang thai da in tem le Clabel (400x300) cho 1 ma thiet bi trong CSDL."""
    from sqlalchemy import select
    from .db import SanxuatDeviceLabel

    clean_id = device_id.strip()
    resolved_date = mfg_date or datetime.now().strftime("%d/%m/%Y")
    now_utc = datetime.now(timezone.utc)
    row = db.scalar(select(SanxuatDeviceLabel).where(SanxuatDeviceLabel.device_id == clean_id))
    if row:
        if not row.mfg_date:
            row.mfg_date = resolved_date
        row.is_clabel_printed = True
        row.clabel_print_count = int(row.clabel_print_count or 0) + 1
        row.clabel_printed_at = now_utc
        if batch_code:
            row.last_batch_code = batch_code
    else:
        row = SanxuatDeviceLabel(
            device_id=clean_id,
            model_name=model_name,
            wifi_pass=wifi_pass,
            mfg_date=resolved_date,
            is_clabel_printed=True,
            clabel_print_count=1,
            clabel_printed_at=now_utc,
            last_batch_code=batch_code,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def generate_sanxuat_batch_70x100_pdf(
    items: Sequence[dict[str, Any]],
    *,
    batch_code: str,
    printed_at_str: str | None = None,
    title: str = "QUÁ TRÌNH SẢN XUẤT INUT DATA LOGGER V1.1",
    model_name: str = "iNut Smartcity - Data Logger v1.1 - Rockchip",
    wifi_pass: str = "inut12345",
    apply_golden_ratio: bool = False,
) -> bytes:
    """Tao file PDF Bang In Tong Hop Lo San Xuat 70x100 (7cm x 10cm) in tron ven tren may in nhiet TP732H @ inut-dev.
    - Co Logo iNut + icon ® & ©, thong tin Cong ty INUT JSC, MAKE IN VIETNAM
    - Co Ngay gio in to phieu batch (DD/MM/YYYY HH:MM:SS)
    - Liet ke toan bo thiet bi inut tung dong kem Ngay san xuat (NSX) va trang thai tem Clabel
    - Co Ma QR chua danh sach cac ma inut cach nhau bang dau phay (vd: inut_207_153,inut_207_159,...)
    - Nen trang 100% + vien den & chu den sac net.
    """
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas as rl_canvas
    from .spx import scale_pdf_golden_ratio

    font_reg = "Helvetica"
    font_bold = "Helvetica-Bold"
    font_mono = "Courier-Bold"
    try:
        if os.path.exists(FONT_REGULAR_PATH):
            pdfmetrics.registerFont(TTFont("DejaVuSans", FONT_REGULAR_PATH))
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", FONT_BOLD_PATH))
            font_reg = "DejaVuSans"
            font_bold = "DejaVuSans-Bold"
        if os.path.exists(FONT_MONO_BOLD_PATH):
            pdfmetrics.registerFont(TTFont("DejaVuSansMono-Bold", FONT_MONO_BOLD_PATH))
            font_mono = "DejaVuSansMono-Bold"
    except Exception:
        pass

    if not printed_at_str:
        vn_tz = timezone(timedelta(hours=7))
        printed_at_str = datetime.now(vn_tz).strftime("%d/%m/%Y %H:%M:%S")

    # Kich thuoc trang 70x130 (70mm x 130mm), nhung toan bo khung thiet ke nam gon trong 70x100 o phan tren (y: 31.5mm -> 128.5mm)
    page_w = 70.0 * mm
    page_h = 130.0 * mm
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
    c.setTitle(f"Batch_SanXuat_{batch_code}")

    def fit_font(f_name: str, text_str: str, start_pt: float, max_w_pt: float, min_pt: float = 3.6) -> float:
        sz = float(start_pt)
        while sz > min_pt and c.stringWidth(text_str, f_name, sz) > max_w_pt:
            sz = round(sz - 0.15, 2)
        return sz

    m_x = 2.0 * mm
    m_top = 1.5 * mm
    m_bot = 31.5 * mm  # Khung in nằm gọn trong đúng 70x100 ở phía trên của khổ 70x130
    inner_w = page_w - 2 * m_x
    inner_h = page_h - m_top - m_bot  # 97.0 mm (nằm trọn trong vùng 70x100)

    # Khung vien ngoai (nen trang, vien den)
    c.setStrokeColor(colors.black)
    c.setFillColor(colors.black)
    c.setLineWidth(1.1)
    c.roundRect(m_x, m_bot, inner_w, inner_h, 1.6 * mm, fill=0, stroke=1)

    # =========================================================================
    # 1. HEADER: LOGO INUT + THÔNG TIN CÔNG TY + MAKE IN VIETNAM (Cao 13.2mm)
    # =========================================================================
    y_top = page_h - m_top
    logo_mm = 10.6 * mm
    logo_x = m_x + 1.2 * mm
    logo_y = y_top - logo_mm - 1.3 * mm

    try:
        mono_logo = render_monochrome_image(
            get_settings().logo_path,
            width=160,
            height=160,
            threshold=172,
            preserve_outline=True,
        )
        logo_buf = io.BytesIO()
        mono_logo.save(logo_buf, format="PNG")
        logo_buf.seek(0)
        c.drawImage(ImageReader(logo_buf), logo_x, logo_y, width=logo_mm, height=logo_mm, mask="auto")
    except Exception:
        c.rect(logo_x, logo_y, logo_mm, logo_mm, fill=0, stroke=1)

    # Icon ® goc tren phai cua logo
    c.setFillColor(colors.white)
    c.setLineWidth(0.55)
    c.circle(logo_x + logo_mm - 0.7 * mm, logo_y + logo_mm - 0.7 * mm, 1.25 * mm, fill=1, stroke=1)
    c.setFillColor(colors.black)
    c.setFont(font_bold, 4.5)
    c.drawCentredString(logo_x + logo_mm - 0.7 * mm, logo_y + logo_mm - 1.25 * mm, "R")

    # Thong tin Cong ty ben phai logo (auto-fit khong bao gio loi ra khoi header)
    tx = logo_x + logo_mm + 1.4 * mm
    hdr_max_w = (page_w - m_x - 1.2 * mm) - tx
    comp_str = "CÔNG TY CP ĐT & PT CÔNG NGHỆ INUT ®"
    c.setFont(font_bold, fit_font(font_bold, comp_str, 5.2, hdr_max_w))
    c.drawString(tx, y_top - 3.3 * mm, comp_str)

    addr_str = "MST: 4401053694 · 161 Trường Chinh, Tuy Hòa, Đắk Lắk"
    c.setFont(font_reg, fit_font(font_reg, addr_str, 4.5, hdr_max_w))
    c.drawString(tx, y_top - 5.7 * mm, addr_str)

    web_str = "ĐT: 0972.768.491 · Web: https://inut.vn · DN KH&CN ©"
    c.setFont(font_reg, fit_font(font_reg, web_str, 4.5, hdr_max_w))
    c.drawString(tx, y_top - 8.0 * mm, web_str)

    # Huy hieu ★ MAKE IN VIETNAM + Tong so bo (nen trang, vien den)
    c.setLineWidth(0.7)
    miv_w = 34.5 * mm
    c.roundRect(tx, y_top - 12.2 * mm, miv_w, 3.3 * mm, 0.7 * mm, fill=0, stroke=1)
    c.setFont(font_bold, 4.4)
    c.drawCentredString(tx + miv_w / 2, y_top - 11.2 * mm, "★ MAKE IN VIETNAM · v1.1 ®")

    qty_x = tx + miv_w + 1.0 * mm
    qty_w = page_w - m_x - qty_x - 1.2 * mm
    c.roundRect(qty_x, y_top - 12.2 * mm, qty_w, 3.3 * mm, 0.7 * mm, fill=0, stroke=1)
    c.setFont(font_bold, 4.5)
    c.drawCentredString(qty_x + qty_w / 2, y_top - 11.2 * mm, f"SL: {len(items)} BỘ")

    y_h_sep = y_top - 13.3 * mm
    c.setLineWidth(0.8)
    c.line(m_x, y_h_sep, page_w - m_x, y_h_sep)

    # =========================================================================
    # 2. TIÊU ĐỀ PHIẾU & MÃ LÔ / NGÀY GIỜ IN TỜ BATCH (TÁCH 2 DÒNG RIÊNG, Cao 12.4mm)
    # =========================================================================
    title_str = title.upper()
    c.setFont(font_bold, fit_font(font_bold, title_str, 6.2, inner_w - 2.4 * mm))
    c.drawCentredString(page_w / 2, y_h_sep - 3.1 * mm, title_str)

    sp_str = f"SP: {model_name}"
    c.setFont(font_bold, fit_font(font_bold, sp_str, 5.1, inner_w - 2.4 * mm))
    c.drawCentredString(page_w / 2, y_h_sep - 5.6 * mm, sp_str)

    # Khung Ma lo & Ngay gio in phieu (2 DÒNG RIÊNG BIỆT)
    meta_h = 6.2 * mm
    meta_y = y_h_sep - 6.5 * mm - meta_h
    c.setLineWidth(0.6)
    c.roundRect(m_x + 1.2 * mm, meta_y, inner_w - 2.4 * mm, meta_h, 0.8 * mm, fill=0, stroke=1)
    c.setFont(font_bold, 4.9)
    c.drawString(m_x + 2.2 * mm, meta_y + 3.6 * mm, f"• Mã lô sản xuất: {batch_code}")
    c.drawString(m_x + 2.2 * mm, meta_y + 1.1 * mm, f"• Ngày giờ in phiếu: {printed_at_str}")

    y_tbl_top = meta_y - 1.0 * mm

    # =========================================================================
    # 3. BẢNG LIỆT KÊ TOÀN BỘ THIẾT BỊ INUT TỪNG DÒNG
    # =========================================================================
    # Cụm QR ở đáy cao 28.0mm (từ m_bot = 31.5mm lên 59.5mm)
    y_qr_section_top = m_bot + 28.0 * mm
    avail_tbl_h = y_tbl_top - y_qr_section_top - 1.0 * mm
    n_rows = max(1, len(items))
    header_row_h = 3.6 * mm
    row_h = min(4.2 * mm, max(2.8 * mm, (avail_tbl_h - header_row_h) / n_rows))
    total_tbl_h = header_row_h + n_rows * row_h
    y_tbl_bottom = y_tbl_top - total_tbl_h

    tbl_x = m_x + 1.2 * mm
    tbl_w = inner_w - 2.4 * mm
    col_stt_w = 6.5 * mm
    col_id_w = 27.5 * mm
    col_nsx_w = 16.0 * mm

    x_col1 = tbl_x + col_stt_w
    x_col2 = x_col1 + col_id_w
    x_col3 = x_col2 + col_nsx_w

    # Viền ngoài bảng
    c.setLineWidth(0.75)
    c.rect(tbl_x, y_tbl_bottom, tbl_w, total_tbl_h, fill=0, stroke=1)

    # Dòng tiêu đề bảng
    y_hdr_line = y_tbl_top - header_row_h
    c.setLineWidth(0.7)
    c.line(tbl_x, y_hdr_line, tbl_x + tbl_w, y_hdr_line)
    c.setFont(font_bold, 4.8)
    hdr_text_y = y_hdr_line + 1.1 * mm
    c.drawCentredString(tbl_x + col_stt_w / 2, hdr_text_y, "STT")
    c.drawCentredString(x_col1 + col_id_w / 2, hdr_text_y, "MÃ THIẾT BỊ (SN / ID)")
    c.drawCentredString(x_col2 + col_nsx_w / 2, hdr_text_y, "NGÀY SX")
    c.drawCentredString((x_col3 + tbl_x + tbl_w) / 2, hdr_text_y, "CLABEL")

    # Các đường kẻ dọc của bảng
    c.setLineWidth(0.45)
    c.line(x_col1, y_tbl_bottom, x_col1, y_tbl_top)
    c.line(x_col2, y_tbl_bottom, x_col2, y_tbl_top)
    c.line(x_col3, y_tbl_bottom, x_col3, y_tbl_top)

    # Từng dòng thiết bị
    row_font_size = 5.6 if n_rows <= 10 else (5.0 if n_rows <= 13 else 4.5)
    for idx, it in enumerate(items):
        ry_top = y_hdr_line - idx * row_h
        ry_bot = ry_top - row_h
        if idx > 0:
            c.setLineWidth(0.35)
            c.line(tbl_x, ry_top, tbl_x + tbl_w, ry_top)

        text_y = ry_bot + (row_h - 1.6 * mm) / 2 + 0.15 * mm
        stt_str = f"{idx + 1:02d}"
        dev_id = str(it.get("device_id", ""))
        mfg_date = str(it.get("mfg_date", ""))
        action = str(it.get("clabel_action", "already_printed"))
        st_str = "Đã in [✓]" if action == "already_printed" else "Auto [✓]"

        c.setFont(font_bold, row_font_size - 0.3)
        c.drawCentredString(tbl_x + col_stt_w / 2, text_y, stt_str)
        c.setFont(font_mono, row_font_size + 0.2)
        c.drawCentredString(x_col1 + col_id_w / 2, text_y, dev_id)
        c.setFont(font_bold, row_font_size - 0.3)
        c.drawCentredString(x_col2 + col_nsx_w / 2, text_y, mfg_date)
        c.setFont(font_reg, row_font_size - 0.6)
        c.drawCentredString((x_col3 + tbl_x + tbl_w) / 2, text_y, st_str)

    # =========================================================================
    # 4. CỤM MÃ QR DANH SÁCH CÁC MÃ INUT (CÁCH NHAU DẤU PHẨY) & KIỂM ĐẾM (Cao 28mm)
    # =========================================================================
    c.setLineWidth(0.75)
    c.line(m_x, y_qr_section_top, page_w - m_x, y_qr_section_top)

    csv_payload = ",".join(str(it.get("device_id", "")).strip() for it in items if it.get("device_id"))
    qr_mm = 23.2 * mm
    qr_x = m_x + 1.2 * mm
    qr_y = m_bot + 3.6 * mm

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=6,
        border=1,
    )
    qr.add_data(csv_payload or "inut")
    qr.make(fit=True)
    qr_pil = qr.make_image(fill_color="black", back_color="white").convert("1")
    qr_buf = io.BytesIO()
    qr_pil.save(qr_buf, format="PNG")
    qr_buf.seek(0)
    c.drawImage(ImageReader(qr_buf), qr_x, qr_y, width=qr_mm, height=qr_mm)
    c.setLineWidth(0.55)
    c.rect(qr_x, qr_y, qr_mm, qr_mm, fill=0, stroke=1)

    c.setFont(font_bold, 4.1)
    c.drawCentredString(qr_x + qr_mm / 2, m_bot + 1.2 * mm, f"QR LIST ({len(items)} MÃ CÁCH PHẨY)")

    # Cột phải cạnh QR: Hiển thị chuỗi CSV & Thống kê kiểm đếm
    rx = qr_x + qr_mm + 1.4 * mm
    rw = page_w - m_x - rx - 1.2 * mm
    ry_top = y_qr_section_top - 2.5 * mm

    c.setFont(font_bold, 4.6)
    c.drawString(rx, ry_top, "CHUỖI MÃ QR LÔ SẢN XUẤT (CSV):")

    # Box chứa chuỗi CSV
    csv_box_h = 13.8 * mm
    csv_box_y = ry_top - csv_box_h - 0.6 * mm
    c.setLineWidth(0.5)
    c.roundRect(rx, csv_box_y, rw, csv_box_h, 0.7 * mm, fill=0, stroke=1)

    c.setFont(font_mono, 4.2)
    max_chars_per_line = 29
    csv_lines: list[str] = []
    cur_line = ""
    for part in csv_payload.split(","):
        piece = part if not cur_line else f",{part}"
        if len(cur_line) + len(piece) <= max_chars_per_line:
            cur_line += piece
        else:
            if cur_line:
                csv_lines.append(cur_line + ",")
            cur_line = part
    if cur_line:
        csv_lines.append(cur_line)

    cy = csv_box_y + csv_box_h - 2.2 * mm
    for ln in csv_lines[:6]:
        c.drawString(rx + 1.0 * mm, cy, ln)
        cy -= 2.1 * mm

    # Khung thống kê kiểm đếm dưới cùng bên phải
    already_cnt = sum(1 for it in items if it.get("clabel_action") == "already_printed")
    auto_cnt = len(items) - already_cnt
    stat_y = m_bot + 1.2 * mm
    stat_h = csv_box_y - stat_y - 0.8 * mm
    c.setLineWidth(0.5)
    c.roundRect(rx, stat_y, rw, stat_h, 0.7 * mm, fill=0, stroke=1)

    stat1 = f"• Kiểm đếm: Đủ {len(items)}/{len(items)} TB · Wi-Fi: {wifi_pass}"
    c.setFont(font_bold, fit_font(font_bold, stat1, 4.3, rw - 2.0 * mm))
    c.drawString(rx + 1.0 * mm, stat_y + stat_h - 2.4 * mm, stat1)

    stat2 = f"• Clabel 40x30: Đã in {already_cnt} | Auto {auto_cnt}"
    c.setFont(font_reg, fit_font(font_reg, stat2, 4.3, rw - 2.0 * mm))
    c.drawString(rx + 1.0 * mm, stat_y + stat_h - 4.7 * mm, stat2)

    stat3 = "• KCS: ĐẠT CHUẨN v1.1 ® © INUT JSC"
    c.setFont(font_bold, fit_font(font_bold, stat3, 4.3, rw - 2.0 * mm))
    c.drawString(rx + 1.0 * mm, stat_y + 1.0 * mm, stat3)

    c.showPage()
    c.save()
    raw_pdf = buf.getvalue()

    if not apply_golden_ratio:
        return raw_pdf
    return scale_pdf_golden_ratio(raw_pdf)


def print_pdf_on_inut_dev(
    pdf_path: str | Path,
    *,
    win_file_name: str,
    host: str = "192.168.1.10",
    printer_name: str = "TP732H",
) -> dict[str, Any]:
    """SCP file PDF sang may inut-dev (Windows host) va goi Foxit Reader CLI in ra may in nhiet TP732H."""
    from .host_discovery import resolve_windows_host

    target_host = "192.168.1.10" if host in ("inut-dev", "", None) else host
    try:
        resolved_host = resolve_windows_host(target_host, probe_port=445)
    except TypeError:
        resolved_host = resolve_windows_host(target_host)

    scp_cmd = [
        "scp",
        "-O",
        "-i",
        "/home/ksp/.ssh/id_ed25519",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ProxyCommand=nc -q 0 %h %p",
        "-o",
        "ConnectTimeout=60",
        str(pdf_path),
        f"Administrator@{resolved_host}:C:/ksp/{win_file_name}",
    ]
    scp_proc = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=120)
    if scp_proc.returncode != 0:
        raise RuntimeError(f"Loi chuyen file PDF sang may inut-dev ({resolved_host}): {scp_proc.stderr}")

    foxit_cmd = f'"C:\\Program Files (x86)\\Foxit Software\\Foxit Reader\\FoxitReader.exe" /t "C:\\ksp\\{win_file_name}" "{printer_name}"'
    ssh_print_cmd = [
        "ssh",
        "-n",
        "-i",
        "/home/ksp/.ssh/id_ed25519",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "ProxyCommand=nc -q 0 %h %p",
        "-o",
        "ConnectTimeout=60",
        f"Administrator@{resolved_host}",
        foxit_cmd,
    ]
    print_proc = subprocess.run(ssh_print_cmd, capture_output=True, text=True, timeout=90)
    if print_proc.returncode != 0:
        raise RuntimeError(f"Loi thuc thi lenh in Foxit tren inut-dev ({resolved_host}): {print_proc.stderr}")

    return {
        "success": True,
        "resolved_host": resolved_host,
        "printer_name": printer_name,
        "remote_file": f"C:\\ksp\\{win_file_name}",
    }


def run_sanxuat_batch_printer(
    db: Any,
    device_ids: str | Sequence[str],
    *,
    batch_code: str | None = None,
    title: str = "Quá trình sản xuất iNut Data Logger v1.1",
    model_name: str = "iNut Smartcity - Data Logger v1.1 - Rockchip",
    wifi_pass: str = "inut12345",
    auto_print_missing_clabel: bool = True,
    force_reprint_clabel: bool = False,
    print_batch_sheet_remote: bool = True,
    inut_dev_host: str = "inut-dev",
    inut_dev_printer: str = "TP732H",
    clabel_gateway_host: str | None = None,
    clabel_mac: str | None = None,
) -> dict[str, Any]:
    """Quy trinh khép kín 'Quá trình sản xuất iNut Data Logger v1.1':
    1. Nhận danh sách mã thiết bị (VD: 10 con inut_207_153,inut_207_159,...).
    2. Kiểm tra từng mã trong CSDL (`sanxuat_device_labels`):
       - Nếu ĐÃ in tem lẻ Clabel trước đó: lấy nguyên Ngày sản xuất (`mfg_date`) đã lưu, KHÔNG in lại Clabel.
       - Nếu CHƯA từng in tem lẻ Clabel: tự động gọi Clabel BLE (`CT221B-X420`) in tem 400x300 trước, rồi lưu `mfg_date` hôm nay vào CSDL.
    3. Tạo bảng tổng hợp 70x100 (`generate_sanxuat_batch_70x100_pdf`) có:
       - Logo iNut, thông tin công ty, ngày giờ in tờ batch
       - Bảng liệt kê từng dòng thiết bị kèm ngày sản xuất
       - Mã QR chứa danh sách các mã inut cách nhau bằng dấu phẩy (`inut_207_153,inut_207_159,...`)
    4. Lưu vào `ksp-pdfsign` (`Document` + `Share` + `SanxuatBatchSheet`) và gửi lệnh in sang máy in nhiệt `TP732H` trên `inut-dev`.
    """
    import json
    import secrets
    from sqlalchemy import select
    from . import storage
    from .db import Document, SanxuatBatchSheet, SanxuatDeviceLabel, Share, init_db

    init_db()
    clean_ids = parse_device_id_list(device_ids)
    if not clean_ids:
        raise ValueError("Danh sach ma thiet bi trong.")

    vn_tz = timezone(timedelta(hours=7))
    now_vn = datetime.now(vn_tz)
    today_str = now_vn.strftime("%d/%m/%Y")
    printed_at_str = now_vn.strftime("%d/%m/%Y %H:%M:%S")

    if not batch_code:
        batch_code = f"SX-V1.1-{now_vn.strftime('%Y%m%d-%H%M%S')}"

    existing_rows = {
        r.device_id: r
        for r in db.scalars(
            select(SanxuatDeviceLabel).where(SanxuatDeviceLabel.device_id.in_(clean_ids))
        ).all()
    }

    missing_ids: list[str] = []
    already_ids: list[str] = []
    for did in clean_ids:
        row = existing_rows.get(did)
        if row and row.is_clabel_printed and row.mfg_date and not force_reprint_clabel:
            already_ids.append(did)
        else:
            missing_ids.append(did)

    clabel_batch_result: dict[str, Any] | None = None
    if missing_ids and auto_print_missing_clabel:
        payloads: list[bytes] = []
        for did in missing_ids:
            im_i = render_sanxuat_v1_1_label(
                device_id=did,
                mfg_date=today_str,
                model_name=model_name,
                wifi_pass=wifi_pass,
                qr_data=did,
                qr_logo=True,
            )
            payloads.append(build_label_tspl(im_i))
        gw = ClabelBLEGateway(host=clabel_gateway_host or get_settings().ble_gateway_host)
        clabel_batch_result = gw.send_tspl_batch(payloads, labels=missing_ids, mac=clabel_mac)
        for did in missing_ids:
            rec = record_clabel_device_print(
                db,
                did,
                mfg_date=today_str,
                model_name=model_name,
                wifi_pass=wifi_pass,
                batch_code=batch_code,
            )
            existing_rows[did] = rec

    items: list[dict[str, Any]] = []
    for idx, did in enumerate(clean_ids):
        row = existing_rows.get(did)
        if row and did in already_ids:
            row.last_batch_code = batch_code
            mfg_val = row.mfg_date or today_str
            action = "already_printed"
        else:
            mfg_val = row.mfg_date if row and row.mfg_date else today_str
            action = "auto_printed" if auto_print_missing_clabel else "pending_clabel"
            if not row:
                rec = record_clabel_device_print(
                    db,
                    did,
                    mfg_date=mfg_val,
                    model_name=model_name,
                    wifi_pass=wifi_pass,
                    batch_code=batch_code,
                )
                existing_rows[did] = rec
        items.append({
            "stt": idx + 1,
            "device_id": did,
            "mfg_date": mfg_val,
            "clabel_action": action,
        })
    db.commit()

    pdf_bytes = generate_sanxuat_batch_70x100_pdf(
        items,
        batch_code=batch_code,
        printed_at_str=printed_at_str,
        title=title,
        model_name=model_name,
        wifi_pass=wifi_pass,
        apply_golden_ratio=False,
    )

    doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")
    csv_str = ",".join(clean_ids)
    now_utc = datetime.now(timezone.utc)

    doc = Document(
        doc_id=doc_id,
        filename=f"SanXuat_Batch_70x100_{batch_code}.pdf",
        signer_name="INUT JSC — Sản xuất v1.1",
        signed=False,
        note=f"{title} ({len(clean_ids)} thiết bị: {csv_str[:160]}) · Lô {batch_code}",
        doc_type="xuat_xuong",
        source_system="sanxuat_v1.1",
        source_external_id=batch_code,
        source_synced_at=now_utc,
    )
    db.add(doc)
    db.flush()

    token = secrets.token_urlsafe(24)
    share = Share(
        token=token,
        document_id=doc.id,
        expires_at=now_utc.replace(tzinfo=None) + timedelta(days=90),
    )
    db.add(share)

    sheet = SanxuatBatchSheet(
        batch_code=batch_code,
        title=title,
        model_name=model_name,
        device_ids_csv=csv_str,
        device_count=len(clean_ids),
        auto_clabel_printed_csv=",".join(missing_ids) if auto_print_missing_clabel else "",
        already_clabel_printed_csv=",".join(already_ids),
        items_json=json.dumps(items, ensure_ascii=False),
        pdf_doc_id=doc_id,
        share_token=token,
        printer_host=inut_dev_host,
        printer_name=inut_dev_printer,
        is_printed=False,
    )
    db.add(sheet)
    db.commit()
    db.refresh(sheet)

    print_info: dict[str, Any] = {}
    if print_batch_sheet_remote:
        pdf_path = storage.path_for(doc_id)
        win_name = f"batch_{re.sub(r'[^A-Za-z0-9_-]', '_', batch_code)}.pdf"
        print_info = print_pdf_on_inut_dev(
            pdf_path,
            win_file_name=win_name,
            host=inut_dev_host,
            printer_name=inut_dev_printer,
        )
        sheet.is_printed = True
        sheet.printed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(sheet)

    base_url = get_settings().public_base_url.rstrip("/")
    return {
        "success": True,
        "batch_id": sheet.id,
        "batch_code": batch_code,
        "title": title,
        "model_name": model_name,
        "printed_at_display": printed_at_str,
        "device_count": len(clean_ids),
        "device_ids_csv": csv_str,
        "already_clabel_printed": already_ids,
        "auto_clabel_printed": missing_ids if auto_print_missing_clabel else [],
        "clabel_batch_result": clabel_batch_result,
        "items": items,
        "document_id": doc.id,
        "pdf_doc_id": doc_id,
        "share_token": token,
        "share_url": f"{base_url}/s/{token}",
        "view_url": f"{base_url}/api/share/{token}/view",
        "download_url": f"{base_url}/api/share/{token}/download",
        "is_printed": sheet.is_printed,
        "print_info": print_info,
    }
