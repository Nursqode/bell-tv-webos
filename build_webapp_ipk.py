# -*- coding: utf-8 -*-
"""Build a minimal webOS web-app .ipk (ar archive) and inspect existing ones."""
import argparse
import gzip
import io
import json
import os
import sys
import tarfile

from PIL import Image, ImageDraw, ImageFont

AR_MAGIC = b"!<arch>\n"


def ar_read(path):
    data = open(path, "rb").read()
    assert data.startswith(AR_MAGIC), "not an ar archive"
    pos = len(AR_MAGIC)
    members = []
    while pos + 60 <= len(data):
        header = data[pos:pos + 60]
        name = header[0:16].decode("ascii").strip()
        size = int(header[48:58].decode("ascii").strip())
        pos += 60
        payload = data[pos:pos + size]
        members.append((name, payload))
        pos += size + (size % 2)
    return members


def ar_write(path, members):
    with open(path, "wb") as f:
        f.write(AR_MAGIC)
        for name, payload in members:
            if len(name) > 15:
                raise ValueError("ar member name too long: %r" % name)
            header = (
                name.ljust(16)
                + "0".ljust(12)
                + "0".ljust(6)
                + "0".ljust(6)
                + "100644".ljust(8)
                + str(len(payload)).ljust(10)
                + "`\n"
            )
            f.write(header.encode("ascii"))
            f.write(payload)
            if len(payload) % 2:
                f.write(b"\n")


def tar_gz(files):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        for name, payload in files:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            info.mode = 0o644
            info.mtime = 0
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            tar.addfile(info, io.BytesIO(payload))
    return buf.getvalue()


def make_icon(size, letter, bg, fg, out):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.18)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=bg)
    try:
        font = ImageFont.truetype("arialbd.ttf", int(size * 0.56))
    except Exception:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", int(size * 0.56))
        except Exception:
            font = ImageFont.load_default()
    text = letter
    box = d.textbbox((0, 0), text, font=font)
    w = box[2] - box[0]
    h = box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, font=font, fill=fg)
    img.save(out, "PNG")


def appinfo(app_id, title, url, icon_color):
    return {
        "id": app_id,
        "version": "1.0.0",
        "vendor": "user",
        "type": "web",
        "main": "index.html",
        "title": title,
        "icon": "icon.png",
        "largeIcon": "largeIcon.png",
        "iconColor": icon_color,
        "bgColor": "#000000",
        "resolution": "1920x1080",
        "disableBackHistoryAPI": True,
        "supportPortraitMode": False,
        "handlesRelaunch": True,
        "inspectable": True,
    }


def index_html(title, url):
    return (
        "<!DOCTYPE html>\n"
        "<html><head><meta charset=\"utf-8\">\n"
        "<title>%s</title>\n"
        "<style>html,body{margin:0;height:100%%;background:#000;color:#fff;"
        "font-family:sans-serif}#m{display:flex;height:100%%;align-items:center;"
        "justify-content:center;font-size:28px;opacity:.8}</style></head>\n"
        "<body><div id=\"m\">Открываю %s…</div>\n"
        "<script>\n"
        "var target = %s;\n"
        "setTimeout(function(){ window.location.replace(target); }, 150);\n"
        "</script></body></html>\n" % (title, title, json.dumps(url))
    )


def build(app_id, title, url, icon_color, out):
    os.makedirs("build", exist_ok=True)
    tmp = os.path.join("build", app_id)
    os.makedirs(tmp, exist_ok=True)
    make_icon(80, title[0].upper(), icon_color, "#ffffff", os.path.join(tmp, "icon.png"))
    make_icon(130, title[0].upper(), icon_color, "#ffffff", os.path.join(tmp, "largeIcon.png"))
    info = appinfo(app_id, title, url, icon_color)
    files = [
        ("usr/palm/applications/%s/appinfo.json" % app_id,
         (json.dumps(info, ensure_ascii=False, indent=2) + "\n").encode("utf-8")),
        ("usr/palm/applications/%s/index.html" % app_id,
         index_html(title, url).encode("utf-8")),
        ("usr/palm/applications/%s/icon.png" % app_id,
         open(os.path.join(tmp, "icon.png"), "rb").read()),
        ("usr/palm/applications/%s/largeIcon.png" % app_id,
         open(os.path.join(tmp, "largeIcon.png"), "rb").read()),
        ("usr/palm/packages/%s/packageinfo.json" % app_id,
         (json.dumps({"id": app_id, "version": "1.0.0", "app": app_id},
                     indent=2) + "\n").encode("utf-8")),
    ]
    control = (
        "Package: %s\n"
        "Version: 1.0.0\n"
        "Section: misc\n"
        "Priority: optional\n"
        "Architecture: all\n"
        "Installed-Size: 64\n"
        "Maintainer: N/A <nobody@example.com>\n"
        "Description: This is a webOS application.\n"
        "webOS-Package-Format-Version: 2\n"
        "webOS-Packager-Version: x.y.x\n" % app_id
    ).encode("utf-8")
    data_tgz = tar_gz(files)
    control_tgz = tar_gz([("./control", control)])
    ar_write(out, [
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", control_tgz),
        ("data.tar.gz", data_tgz),
    ])
    print("built %s (%d bytes)" % (out, os.path.getsize(out)))
    return out


def inspect(path):
    members = ar_read(path)
    print("members:")
    for name, payload in members:
        print("  %-18s %d bytes" % (name, len(payload)))
    for name, payload in members:
        if name.startswith("data.tar") or name.startswith("control.tar"):
            print("--- %s ---" % name)
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as tar:
                for m in tar.getmembers():
                    print("   %s %d" % (m.name, m.size))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect")
    ap.add_argument("--id")
    ap.add_argument("--title")
    ap.add_argument("--url")
    ap.add_argument("--color", default="#1f6feb")
    ap.add_argument("--out")
    args = ap.parse_args()
    if args.inspect:
        inspect(args.inspect)
    elif args.id and args.title and args.url and args.out:
        build(args.id, args.title, args.url, args.color, args.out)
    else:
        ap.error("use --inspect or --id/--title/--url/--out")
