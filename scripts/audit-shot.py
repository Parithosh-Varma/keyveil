#!/usr/bin/env python3
"""Render apps/landing/public/audit.png from REAL D1 audit rows.

Usage: python3 scripts/audit-shot.py
Reads prod audit_log via wrangler, masks IPs, draws a dashboard-style table.
Only real rows are shown — no fixtures.
"""
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

REPO = "/Users/varma/Downloads/API TOKENS"
OUT = f"{REPO}/apps/landing/public/audit.png"

raw = subprocess.run(
    ["./node_modules/.bin/wrangler", "d1", "execute", "keyveil-db",
     "--remote", "--json",
     "--command", "SELECT created_at, actor, provider, action, ok, ip "
                  "FROM audit_log ORDER BY created_at DESC LIMIT 6"],
    cwd=REPO, capture_output=True, text=True,
).stdout
rows = json.loads(raw)[0]["results"]


def mask_ip(ip: str) -> str:
    if ":" in ip:  # v6
        parts = ip.split(":")
        return f"{parts[0]}:{parts[1]}:…:{parts[-1]}"
    segs = ip.split(".")
    return f"{segs[0]}.{segs[1]}.….{segs[-1]}" if len(segs) == 4 else ip


def short_ts(ts: str) -> str:
    return ts.replace("T", " ")[:19] + "Z"


mono = ImageFont.load_default(size=21)
sans = ImageFont.load_default(size=21)
sans_b = ImageFont.load_default(size=23)
small = ImageFont.load_default(size=18)

INK, PAPER, MUTED, LINE = "#0c0a09", "#f8f8f7", "#a5a09b", "#2a2a2a"
GREEN, RED, ACCENT = "#4ade80", "#f87171", "#f55036"

W, PAD, ROW_H, HEAD_H = 1160, 30, 46, 64
H = PAD + HEAD_H + 40 + ROW_H * max(len(rows), 1) + 44 + PAD
img = Image.new("RGB", (W, H), INK)
d = ImageDraw.Draw(img)

d.text((PAD, PAD), "audit log", font=sans_b, fill=PAPER)
d.text((PAD, PAD + 30), "every call recorded - values never included", font=small, fill=MUTED)

cols = [("time", 250), ("actor", 110), ("provider", 150), ("action", 330), ("result", 110), ("ip", 180)]
x = PAD
y0 = PAD + HEAD_H + 40
for name, w in cols:
    d.text((x, y0 - 32), name, font=small, fill=MUTED)
    x += w
d.line([(PAD, y0 - 10), (W - PAD, y0 - 10)], fill=LINE, width=1)

y = y0
for r in rows or [{"created_at": "—", "actor": "—", "provider": "—", "action": "(no rows yet — sign in and make a call)", "ok": 1, "ip": "—"}]:
    x = PAD
    cells = [
        (short_ts(r["created_at"]), PAPER),
        (r["actor"], PAPER),
        (r["provider"] or "—", MUTED if not r["provider"] else PAPER),
        (r["action"], PAPER),
        ("ok" if r["ok"] else "denied", GREEN if r["ok"] else RED),
        (mask_ip(r["ip"]), MUTED),
    ]
    for (text, color), (_, w) in zip(cells, cols):
        d.text((x, y + 10), str(text)[:34], font=mono, fill=color)
        x += w
    y += ROW_H

d.text((PAD, H - PAD - 22), "keyveil-dashboard.pages.dev  >  audit", font=small, fill=ACCENT)
img.save(OUT)
print(f"wrote {OUT} ({len(rows)} real rows)")
