#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the Bell.TV webOS application (.ipk).

Usage:
    python3 build_iptv_app.py

Expects playlists in ./data (run tools/fetch_playlists.py first) and the web
app sources in ./src. The package is written to ./dist.
"""

import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_webapp_ipk as B  # ar/tar helpers

DATA = os.path.join(HERE, "data")
SRC = os.path.join(HERE, "src")
BUILD = os.path.join(HERE, "build")
DIST = os.path.join(HERE, "dist")

APP_ID = "tv.iptv.web"
APP_TITLE = "Bell.TV"
APP_VENDOR = "Nursqode"
VERSION = "1.5.0"


def parse_m3u(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    chans = []
    cur = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("#EXTINF"):
            attrs = {}
            for m in re.finditer(r'([A-Za-z0-9_-]+)="([^"]*)"', line):
                attrs[m.group(1).lower()] = m.group(2)
            name = line.split(",", 1)[1].strip() if "," in line else attrs.get("tvg-name", "")
            cur = {"name": name, "group": attrs.get("group-title", ""), "logo": attrs.get("tvg-logo", "")}
        elif line.startswith("#"):
            continue
        elif cur is not None:
            cur["url"] = line
            chans.append(cur)
            cur = None
    return chans


def grouped(chans, default_group):
    groups = {}
    order = []
    for c in chans:
        g = (c.get("group") or default_group).strip() or default_group
        if g not in groups:
            groups[g] = []
            order.append(g)
        groups[g].append(c)
    return [{"title": g, "ch": [[c["name"], c["url"], c.get("logo", "")] for c in groups[g]]} for g in order]


def require(name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        sys.exit("missing %s — run: python3 tools/fetch_playlists.py" % path)
    return path


def make_icon(size, path):
    from PIL import Image
    icon = os.path.join(HERE, "assets", "icon.png")
    if os.path.exists(icon):
        Image.open(icon).convert("RGBA").resize((size, size), Image.LANCZOS).save(path, "PNG")
        return
    from PIL import ImageDraw
    S = 512
    img = Image.new("RGBA", (S, S), (13, 17, 23, 255))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([78, 150, 434, 356], radius=34, outline=(226, 234, 245, 255), width=14)
    d.line([(256, 356), (256, 404)], fill=(226, 234, 245, 255), width=14)
    d.line([(162, 404), (350, 404)], fill=(226, 234, 245, 255), width=14)
    img.resize((size, size), Image.LANCZOS).save(path, "PNG")


def main():
    sources = []
    sources.append({"title": "BeeTV", "groups": grouped(parse_m3u(require("beetv.m3u")), "BeeTV")})
    sources.append({"title": "Россия", "groups": grouped(parse_m3u(require("ru.m3u")), "Россия")})
    sources.append({"title": "Казахстан", "groups": grouped(parse_m3u(require("kz.m3u")), "Казахстан")})
    sources.append({"title": "Узбекистан", "groups": grouped(parse_m3u(require("uz.m3u")), "Узбекистан")})

    data_js = "window.IPTV_DATA = " + json.dumps({"sources": sources}, ensure_ascii=False,
                                                 separators=(",", ":")) + ";\n"

    app_dir = os.path.join(BUILD, APP_ID)
    if os.path.isdir(app_dir):
        shutil.rmtree(app_dir)
    os.makedirs(app_dir)
    os.makedirs(DIST, exist_ok=True)

    open(os.path.join(app_dir, "data.js"), "w", encoding="utf-8").write(data_js)

    def asset(name, dest):
        src = os.path.join(SRC, name)
        if not os.path.exists(src):
            sys.exit("missing source file %s" % src)
        shutil.copy(src, os.path.join(app_dir, dest))

    asset("style.css", "style.css")
    asset("app.js", "app.js")
    asset("index.html", "index.html")
    hls = os.path.join(DATA, "hls.min.js")
    if os.path.exists(hls):
        shutil.copy(hls, os.path.join(app_dir, "hls.min.js"))

    fonts = os.path.join(HERE, "assets", "fonts")
    if os.path.isdir(fonts):
        dst_fonts = os.path.join(app_dir, "fonts")
        os.makedirs(dst_fonts, exist_ok=True)
        for fn in os.listdir(fonts):
            shutil.copy(os.path.join(fonts, fn), os.path.join(dst_fonts, fn))

    make_icon(80, os.path.join(app_dir, "icon.png"))
    make_icon(130, os.path.join(app_dir, "largeIcon.png"))
    os.makedirs(os.path.join(HERE, "assets"), exist_ok=True)
    make_icon(256, os.path.join(HERE, "assets", "icon-256.png"))

    info = B.appinfo(APP_ID, APP_TITLE, "", "#1f6feb")
    info["version"] = VERSION
    info["vendor"] = APP_VENDOR
    info["icon"] = "icon.png"
    info["largeIcon"] = "largeIcon.png"
    info["appDescription"] = "Bell.TV — IPTV-плеер для LG webOS"
    open(os.path.join(app_dir, "appinfo.json"), "w", encoding="utf-8").write(
        json.dumps(info, ensure_ascii=False, indent=2) + "\n")

    files = []
    for root, _dirs, fnames in os.walk(app_dir):
        for fn in fnames:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, app_dir).replace("\\", "/")
            with open(full, "rb") as fh:
                payload = fh.read()
            files.append(("usr/palm/applications/%s/%s" % (APP_ID, rel), payload))
    files.append(("usr/palm/packages/%s/packageinfo.json" % APP_ID,
                  (json.dumps({"id": APP_ID, "version": VERSION, "app": APP_ID}, indent=2) + "\n").encode()))

    control = (
        "Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\n"
        "Installed-Size: 1024\nMaintainer: %s <noreply@github.com>\n"
        "Description: Bell.TV IPTV player for LG webOS\nwebOS-Package-Format-Version: 2\n"
        "webOS-Packager-Version: x.y.x\n" % (APP_ID, VERSION, APP_VENDOR)
    ).encode()

    ipk = os.path.join(DIST, "%s_%s_all.ipk" % (APP_ID, VERSION))
    B.ar_write(ipk, [
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", B.tar_gz([("control", control)])),
        ("data.tar.gz", B.tar_gz(files)),
    ])
    total = sum(len(g["ch"]) for s in sources for g in s["groups"])
    print("sources:", [(s["title"], sum(len(g["ch"]) for g in s["groups"])) for s in sources])
    print("channels:", total)
    print("built:", ipk, os.path.getsize(ipk), "bytes")


if __name__ == "__main__":
    main()
