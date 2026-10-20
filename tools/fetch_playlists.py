#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download the public playlists the app is built from into ./data."""

import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

FILES = {
    "beetv.m3u": "https://gitea.com/Monoloshka/BeeTV/raw/branch/main/BeeTV.m3u",
    "ru.m3u": "https://iptv-org.github.io/iptv/countries/ru.m3u",
    "kz.m3u": "https://iptv-org.github.io/iptv/countries/kz.m3u",
    "uz.m3u": "https://iptv-org.github.io/iptv/countries/uz.m3u",
    "hls.min.js": "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js",
}


def main():
    os.makedirs(DATA, exist_ok=True)
    for name, url in FILES.items():
        dest = os.path.join(DATA, name)
        print("downloading", name, "...", end=" ", flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "bell-tv-build/1.0"})
        data = urllib.request.urlopen(req, timeout=60).read()
        open(dest, "wb").write(data)
        print(len(data), "bytes")


if __name__ == "__main__":
    main()
