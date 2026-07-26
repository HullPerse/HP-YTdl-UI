import asyncio
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yt_dlp  # type: ignore[import-untyped]
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.requests import Request
from yt_dlp.utils import DownloadError as YtDownloadError

BASE_DIR = Path(__file__).parent
PLAYLISTS_DIR = BASE_DIR / "playlists"
DOWNLOADS_DIR = BASE_DIR / "downloads"
COOKIES_FILE = BASE_DIR / "cookies.txt"

PLAYLISTS_DIR.mkdir(exist_ok=True)
DOWNLOADS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="YouTube Downloader")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

executor = ThreadPoolExecutor(max_workers=2)

CHROME_PROFILES = [
    r"C:\Users\Kocherga\AppData\Local\imput\Helium\User Data\Default",
    r"C:\Users\Kocherga\AppData\Local\Google\Chrome\User Data\Default",
    r"C:\Users\Kocherga\AppData\Local\Google\Chrome\User Data\Profile 1",
]

EXTRACTOR_ARGS = {"youtube": {"player_client": ["web_embedded"]}}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

STANDARD_BROWSERS = ["edge", "chrome", "firefox", "brave", "opera", "vivaldi", "chromium"]

download_progress: dict[str, dict] = {}


class DownloadError(Exception):
    pass


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.strip(". ")
    if not name:
        name = "untitled"
    return name[:120]


def parse_youtube_title(raw_title: str) -> dict:
    title = raw_title.strip()

    title = re.sub(r'\s*\(official\s*(?:music\s*)?video\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(official\s*audio\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(lyric\s*video\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(visualizer\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(4k\s*remaster\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(4k\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(hd\)\s*', ' ', title, flags=re.IGNORECASE)
    title = re.sub(r'\s*\(audio\)\s*', ' ', title, flags=re.IGNORECASE)

    title = re.sub(r'\s*\|\s*.*$', '', title)
    title = re.sub(r'\s+_\s+.*$', '', title)
    title = re.sub(r'\s*-\s*youtube\s*$', '', title, flags=re.IGNORECASE)

    misc_parts = []
    def _collect_misc(m):
        content = m.group(1).strip()
        if content and not re.match(r'^(official|video|audio|lyric|visualizer|4k|hd)\b', content, re.IGNORECASE):
            misc_parts.append(content)
        return ''
    title = re.sub(r'\(([^)]*)\)', _collect_misc, title)

    title = re.sub(r'\s+', ' ', title).strip()

    misc_str = f" [{', '.join(misc_parts)}]" if misc_parts else ''

    artist = ''
    track = title
    m = re.match(r'^(.+?)\s+-\s+(.+)$', title)
    if m:
        artist = m.group(1).strip()
        track = m.group(2).strip()

    filename = f'{artist} - {track}{misc_str}' if artist else f'{track}{misc_str}'

    return {
        'artist': artist,
        'title': track,
        'misc': ', '.join(misc_parts),
        'filename': sanitize_filename(filename),
        'source_title': raw_title,
    }


def clean_track_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"^\d+[\.\)]\s*", "", line)
    return line


def get_playlists() -> list[dict]:
    playlists = []
    for playlist_file in sorted(PLAYLISTS_DIR.glob("*")):
        if playlist_file.suffix.lower() not in (".csv", ".txt"):
            continue
        playlist_name = playlist_file.stem
        with open(playlist_file, encoding="utf-8-sig") as f:
            tracks = [clean_track_line(line) for line in f if line.strip()]
        playlists.append({
            "name": playlist_name,
            "tracks": tracks,
            "count": len(tracks),
        })
    return playlists


def search_youtube_sync(query: str, max_results: int = 8) -> list[dict]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
    }
    search_query = f"ytsearch{max_results}:{query}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # type: ignore[arg-type]
        result = ydl.extract_info(search_query, download=False)
        entries = result.get("entries", []) if result else []
        results = []
        for e in entries:
            if not e or not e.get("id"):
                continue
            results.append({
                "id": e["id"],
                "title": e.get("title", "Unknown"),
                "channel": e.get("channel", e.get("uploader", "Unknown")),
                "duration": e.get("duration"),
                "thumbnail": f"https://img.youtube.com/vi/{e['id']}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={e['id']}",
            })
        return results


def _url_hash(url: str) -> str:
    h = 0
    for c in url:
        h = ((h << 5) - h) + ord(c)
        h &= 0xFFFFFFFF
        if h > 0x7FFFFFFF:
            h -= 0x100000000
    return format(abs(h), 'x')


def _progress_hook(d: dict) -> None:
    ident = d.get("info_dict", {})
    url = ident.get("webpage_url", "") or ident.get("url", "")
    url_hash = _url_hash(url)
    download_progress[url_hash] = {
        "status": d.get("status"),
        "downloaded_bytes": d.get("downloaded_bytes", 0),
        "total_bytes": d.get("total_bytes") or d.get("total_bytes_estimate", 0),
        "speed": d.get("speed", 0),
        "eta": d.get("eta", 0),
        "percent": d.get("_percent_str", "").strip(),
    }


def _build_ydl_opts(output_path: str, fmt: str, quality: str = "720") -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "js_runtimes": {"node": {}},
        "extractor_args": EXTRACTOR_ARGS,
        "user_agent": USER_AGENT,
        "progress_hooks": [_progress_hook],
    }
    if fmt == "mp3":
        opts.update({
            "format": "bestaudio/best",
            "outtmpl": output_path.replace(".mp3", ".%(ext)s"),
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",
            }],
        })
    else:
        format_spec = f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]"
        opts.update({
            "format": format_spec,
            "outtmpl": output_path.replace(".mp4", ".%(ext)s"),
            "merge_output_format": "mp4",
        })
    return opts


def download_sync(url: str, output_path: str, fmt: str, quality: str = "720") -> None:
    ydl_opts = _build_ydl_opts(output_path, fmt, quality)

    if COOKIES_FILE.exists():
        ydl_opts["cookiefile"] = str(COOKIES_FILE)
    else:
        for browser in STANDARD_BROWSERS:
            try:
                ydl_opts["cookiesfrombrowser"] = (browser,)
                break
            except Exception:  # noqa: BLE001,S112
                continue

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # type: ignore[arg-type]
            ydl.download([url])
    except YtDownloadError as e:  # type: ignore[attr-defined]
        error_str = str(e)
        if "cookiefile" in ydl_opts and ("403" in error_str or "forbidden" in error_str.lower()):
            del ydl_opts["cookiefile"]
            for browser in STANDARD_BROWSERS:
                try:
                    ydl_opts["cookiesfrombrowser"] = (browser,)
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # type: ignore[arg-type]
                        ydl.download([url])
                    return
                except YtDownloadError:  # type: ignore[attr-defined]
                    continue
        raise DownloadError(str(e))


def auto_detect_cookies_sync() -> dict:
    browsers_to_try = list(STANDARD_BROWSERS)
    for profile in CHROME_PROFILES:
        browsers_to_try.append(f"chrome:{profile}")

    result_info = {}
    for entry in browsers_to_try:
        try:
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--cookies-from-browser", entry,
                "--cookies", str(COOKIES_FILE),
                "--skip-download", "--no-warnings",
                "--js-runtimes", "node",
            ]
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30, check=False,
            )
            if proc.returncode == 0 and COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
                text = COOKIES_FILE.read_text(encoding="utf-8")
                cookie_lines = [
                    l for l in text.splitlines()
                    if l.strip() and not l.strip().startswith("#") and "\t" in l
                ]
                count = len(cookie_lines)
                browser_name = entry.split(":")[0]
                result_info[browser_name] = count
                return {
                    "found": True,
                    "total": count,
                    "detail": f"Extracted via yt-dlp ({entry})",
                    "per_browser": result_info,
                }
            if proc.returncode != 0:
                err = proc.stderr + proc.stdout
                if "could not copy" in err.lower() or "permission denied" in err.lower():
                    result_info[entry.split(":")[0]] = "locked"
                elif "could not find" in err.lower():
                    result_info[entry.split(":")[0]] = "not_found"
                else:
                    result_info[entry.split(":")[0]] = "error"
        except subprocess.TimeoutExpired:
            result_info[entry.split(":")[0]] = "timeout"
        except Exception:  # noqa: BLE001
            result_info[entry.split(":")[0]] = "exception"

    detail = "; ".join(f"{k}: {v}" for k, v in result_info.items())
    return {"found": False, "total": 0, "detail": detail, "per_browser": result_info}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/playlists")
async def api_playlists():
    return get_playlists()


@app.get("/api/search")
async def api_search(query: str, max_results: int = 8):
    if not query.strip():
        raise HTTPException(status_code=400, detail="Query is empty")
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(executor, search_youtube_sync, query.strip(), max_results)
    return {"results": results}


def get_video_metadata_sync(url: str) -> dict:
    ydl_opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "js_runtimes": {"node": {}},
        "extractor_args": EXTRACTOR_ARGS,
        "user_agent": USER_AGENT,
    }
    if COOKIES_FILE.exists():
        ydl_opts["cookiefile"] = str(COOKIES_FILE)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # type: ignore[arg-type]
        info = ydl.extract_info(url, download=False)
    raw_title = info.get("title") or ""
    parsed = parse_youtube_title(raw_title)
    parsed["duration"] = info.get("duration")
    parsed["channel"] = info.get("channel", info.get("uploader", ""))
    parsed["id"] = info.get("id")
    parsed["thumbnail"] = f"https://img.youtube.com/vi/{info.get('id','')}/hqdefault.jpg"
    return parsed


@app.get("/api/metadata")
async def api_metadata(url: str):
    if not url.strip():
        raise HTTPException(status_code=400, detail="URL is empty")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, get_video_metadata_sync, url.strip())
    return result


class DownloadRequest(BaseModel):
    url: str
    filename: str
    fmt: str = "mp3"
    quality: str = "720"
    playlist: str = ""


@app.post("/api/download")
async def api_download(req: DownloadRequest):
    safe_name = sanitize_filename(req.filename)
    ext = req.fmt
    if req.playlist:
        subdir = DOWNLOADS_DIR / req.playlist
        subdir.mkdir(exist_ok=True)
        output_path = str(subdir / f"{safe_name}.{ext}")
    else:
        output_path = str(DOWNLOADS_DIR / f"{safe_name}.{ext}")

    if os.path.exists(output_path):
        return {"filename": f"{safe_name}.{ext}", "path": output_path, "already_exists": True}

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(executor, download_sync, req.url, output_path, req.fmt, req.quality)
    except DownloadError as e:
        error_msg = str(e)
        if "sign in" in error_msg.lower() or "bot" in error_msg.lower():
            error_msg += " - Export cookies.txt from your browser and paste it in Settings"
        raise HTTPException(status_code=500, detail=error_msg)

    found_dir = (DOWNLOADS_DIR / req.playlist) if req.playlist else DOWNLOADS_DIR
    found = list(found_dir.glob(f"{safe_name}.{ext}"))
    if not found:
        found = list(found_dir.glob(f"{safe_name}.*"))
    actual_file = str(found[0]) if found else output_path

    return {"filename": os.path.basename(actual_file), "path": actual_file, "already_exists": False}


@app.post("/api/rename/playlist/{name}")
async def rename_playlist_files(name: str):
    playlist_dir = DOWNLOADS_DIR / name
    if not playlist_dir.exists():
        raise HTTPException(status_code=404, detail="Playlist download directory not found")
    playlists = get_playlists()
    pl = next((p for p in playlists if p["name"] == name), None)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")

    files = sorted(playlist_dir.glob("*"))
    # sort by name for consistent ordering
    files.sort(key=lambda f: f.name.lower())
    renamed = []
    errors = []
    for i, f in enumerate(files):
        if not f.is_file():
            continue
        if i >= len(pl["tracks"]):
            errors.append(f"{f.name}: no playlist track at index {i}")
            continue
        track = pl["tracks"][i]
        parsed = parse_youtube_title(track)
        new_name = parsed["filename"] + f.suffix
        new_path = f.parent / new_name
        if new_path.exists():
            errors.append(f"{f.name}: target {new_name} already exists")
            continue
        os.rename(f, new_path)
        renamed.append({"old": f.name, "new": new_name})
    return {"renamed": renamed, "errors": errors, "total": len(files)}


@app.get("/api/download/{filename:path}")
async def serve_download(filename: str):
    filepath = DOWNLOADS_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(filepath), filename=os.path.basename(filename))


@app.get("/api/download/progress/{url_hash}")
async def stream_download_progress(url_hash: str):
    async def event_generator():
        while True:
            data = download_progress.get(url_hash)
            if data:
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("status") in ("finished", "error"):
                    break
            await asyncio.sleep(0.3)
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/cookies")
async def get_cookies_status():
    return {"exists": COOKIES_FILE.exists(), "path": str(COOKIES_FILE)}


class CookiesBody(BaseModel):
    content: str


@app.post("/api/cookies")
async def save_cookies(body: CookiesBody):
    COOKIES_FILE.write_text(body.content, encoding="utf-8")
    return {"saved": True, "path": str(COOKIES_FILE)}


@app.delete("/api/cookies")
async def delete_cookies():
    if COOKIES_FILE.exists():
        COOKIES_FILE.unlink()
    return {"deleted": True}


@app.post("/api/cookies/detect")
async def detect_cookies():
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(executor, auto_detect_cookies_sync)
    return results


@app.get("/api/cookies/inspect")
async def inspect_cookies():
    if not COOKIES_FILE.exists():
        return {"exists": False}
    content = COOKIES_FILE.read_text(encoding="utf-8")
    lines = [l.strip() for l in content.splitlines() if l.strip() and not l.strip().startswith("#") and "\t" in l]
    auth_cookies = []
    domains = set()
    auth_names = {"SAPISID", "SSID", "HSID", "SID", "LOGIN_INFO", "__Secure-1PSID", "__Secure-3PSID"}
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 7:
            domain = parts[0].removeprefix(".")
            name = parts[5]
            domains.add(domain)
            auth_cookies.append({
                "name": name,
                "domain": domain,
                "is_auth": name in auth_names,
            })
    total = len(auth_cookies)
    auth_present = [c["name"] for c in auth_cookies if c["is_auth"]]
    return {
        "exists": True,
        "total_cookies": total,
        "domains": sorted(domains),
        "auth_cookies_present": auth_present,
        "has_all_auth": all(n in auth_present for n in ["SAPISID", "SSID", "HSID", "SID"]),
    }


@app.get("/api/downloads")
async def list_downloads():
    files = []
    for path in sorted(DOWNLOADS_DIR.rglob("*")):
        if path.is_file() and path.suffix.lower() in (".mp3", ".mp4", ".m4a", ".webm"):
            rel = path.relative_to(DOWNLOADS_DIR)
            files.append({"name": str(rel), "size": path.stat().st_size})
    return {"files": files}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
