import asyncio
import json
import os
import threading

from fastapi import HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel
from starlette.requests import Request

from . import app, templates
from .config import (
    COOKIES_FILE,
    DOWNLOADS_DIR,
    PLAYLISTS_DIR,
    download_progress,
    executor,
)
from .cookies_auth import get_signin_status, start_signin
from .queue import download_queue
from .utils import (
    DownloadError,
    _run_ytdlp_update_sync,
    _run_ytdlp_version_sync,
    auto_detect_cookies_sync,
    download_sync,
    get_playlists,
    get_video_metadata_sync,
    get_video_stream_url_sync,
    import_playlist_from_url_sync,
    import_playlist_sync,
    parse_youtube_title,
    sanitize_filename,
    search_youtube_sync,
)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})  # pyright: ignore[reportUnknownMemberType]


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


@app.get("/api/metadata")
async def api_metadata(url: str):
    if not url.strip():
        raise HTTPException(status_code=400, detail="URL is empty")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, get_video_metadata_sync, url.strip())
    return result


@app.get("/api/stream/{video_id}")
async def api_stream(video_id: str, quality: str = "360"):
    loop = asyncio.get_event_loop()
    try:
        stream_url = await loop.run_in_executor(executor, get_video_stream_url_sync, video_id, quality)
        return {"url": stream_url}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


class DownloadRequest(BaseModel):
    url: str
    filename: str
    fmt: str = "mp3"
    quality: str = "720"
    playlist: str = ""
    include_thumbnail: bool = False


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
        await loop.run_in_executor(executor, download_sync, req.url, output_path, req.fmt, req.quality, req.include_thumbnail)
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
async def rename_playlist_files(name: str):  # pyright: ignore[reportUnknownParameterType]
    playlist_dir = DOWNLOADS_DIR / name
    if not playlist_dir.exists():
        raise HTTPException(status_code=404, detail="Playlist download directory not found")
    playlists = get_playlists()
    pl = next((p for p in playlists if p["name"] == name), None)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")

    files = list(playlist_dir.glob("*"))
    files.sort(key=lambda f: f.name.lower())
    renamed = []
    errors = []
    for i, f in enumerate(files):
        if not f.is_file():
            continue
        if i >= len(pl["tracks"]):  # pyright: ignore[reportAny]
            errors.append(f"{f.name}: no playlist track at index {i}")  # pyright: ignore[reportUnknownMemberType]
            continue
        track = pl["tracks"][i]  # pyright: ignore[reportAny]
        parsed = parse_youtube_title(track)  # pyright: ignore[reportAny]
        new_name = parsed["filename"] + f.suffix  # pyright: ignore[reportAny]
        new_path = f.parent / new_name  # pyright: ignore[reportAny]
        if new_path.exists():  # pyright: ignore[reportAny]
            errors.append(f"{f.name}: target {new_name} already exists")  # pyright: ignore[reportUnknownMemberType]
            continue
        os.rename(f, new_path)  # pyright: ignore[reportAny]
        renamed.append({"old": f.name, "new": new_name})  # pyright: ignore[reportUnknownMemberType]
    return {"renamed": renamed, "errors": errors, "total": len(files)}  # pyright: ignore[reportUnknownVariableType]


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


class QueueAddRequest(BaseModel):
    url: str
    filename: str
    fmt: str = "mp3"
    quality: str = "720"
    playlist: str = ""
    output_dir: str = ""
    include_thumbnail: bool = False


class QueueReorderRequest(BaseModel):
    id: str
    new_index: int


@app.post("/api/queue/add")
async def queue_add(req: QueueAddRequest):
    item = download_queue.add(
        url=req.url,
        filename=req.filename,
        fmt=req.fmt,
        quality=req.quality,
        playlist=req.playlist,
        output_dir=req.output_dir,
        include_thumbnail=req.include_thumbnail,
    )
    return {"item_id": item.id}


@app.delete("/api/queue/{item_id}")
async def queue_remove(item_id: str):
    ok = download_queue.remove(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"removed": True}


@app.post("/api/queue/reorder")
async def queue_reorder(req: QueueReorderRequest):
    download_queue.reorder(req.id, req.new_index)
    return {"ok": True}


@app.post("/api/queue/clear")
async def queue_clear():
    download_queue.clear_completed()
    return {"ok": True}


@app.post("/api/queue/skip/{item_id}")
async def queue_skip(item_id: str):
    ok = download_queue.skip(item_id)
    return {"ok": ok}


class QueueResolveRequest(BaseModel):
    action: str  # "overwrite" | "skip"


@app.post("/api/queue/resolve/{item_id}")
async def queue_resolve(item_id: str, req: QueueResolveRequest):
    ok = download_queue.resolve_conflict(item_id, req.action)
    if not ok:
        raise HTTPException(status_code=400, detail="Cannot resolve conflict")
    return {"ok": True}


@app.delete("/api/queue/{item_id}")
async def queue_delete(item_id: str):
    ok = download_queue.remove(item_id)
    return {"ok": ok}


@app.get("/api/queue/progress")
async def queue_progress():
    async def event_generator():
        while True:
            state = download_queue.get_state()
            yield f"data: {json.dumps(state)}\n\n"
            await asyncio.sleep(0.5)
    return StreamingResponse(event_generator(), media_type="text/event-stream")


class QueueConfigRequest(BaseModel):
    max_concurrent: int = 2


@app.post("/api/queue/config")
async def queue_config(req: QueueConfigRequest):
    download_queue.set_max_concurrent(req.max_concurrent)
    return {"max_concurrent": req.max_concurrent}


class PlaylistImportRequest(BaseModel):
    url: str
    name: str


class PlaylistCheckRequest(BaseModel):
    tracks: list[str]
    template: str


@app.post("/api/playlists/import")
async def api_import_playlist(req: PlaylistImportRequest):
    if not req.url.strip() or not req.name.strip():
        raise HTTPException(status_code=400, detail="URL and name required")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, import_playlist_sync, req.url.strip(), req.name.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return result


@app.post("/api/playlists/import-from-url")
async def api_import_playlist_from_url(req: PlaylistImportRequest):
    if not req.url.strip():
        raise HTTPException(status_code=400, detail="URL required")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, import_playlist_from_url_sync, req.url.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return result


@app.post("/api/playlists/check-existing")
async def api_check_existing(req: PlaylistCheckRequest):
    existing = []
    for i, track in enumerate(req.tracks):
        parsed = parse_youtube_title(track)
        fields = {
            "artist": parsed.get("artist", ""),
            "title": parsed.get("title", ""),
            "misc": parsed.get("misc", ""),
            "channel": "",
            "id": "",
            "ext": "",
            "playlist": "",
            "quality": "",
            "source_title": track,
        }
        name = req.template
        name = name.replace("{artist}", fields["artist"] or "")
        name = name.replace("{title}", fields["title"] or "")
        name = name.replace("{misc}", f" [{fields['misc']}]" if fields["misc"] else "")
        name = name.replace("{channel}", "")
        name = name.replace("{id}", "")
        name = name.replace("{ext}", "")
        name = name.replace("{playlist}", "")
        name = name.replace("{quality}", "")
        name = name.replace("{source_title}", track)
        name = " ".join(name.split()).strip()
        safe = sanitize_filename(name)
        for ext in (".mp3", ".mp4", ".m4a", ".webm"):
            if (DOWNLOADS_DIR / f"{safe}{ext}").exists():
                existing.append(i)
                break
    return {"existing": existing}


@app.get("/api/ytdlp/version")
async def ytdlp_version():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _run_ytdlp_version_sync)


@app.post("/api/ytdlp/update")
async def ytdlp_update():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, _run_ytdlp_update_sync)


@app.get("/api/cookies")
async def get_cookies_status():
    return {"exists": COOKIES_FILE.exists(), "path": str(COOKIES_FILE)}


class CookiesBody(BaseModel):
    content: str


@app.post("/api/cookies")
async def save_cookies(body: CookiesBody):
    COOKIES_FILE.write_text(body.content, encoding="utf-8")  # pyright: ignore[reportUnusedCallResult]
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
async def inspect_cookies():  # pyright: ignore[reportUnknownParameterType]
    if not COOKIES_FILE.exists():
        return {"exists": False}
    content = COOKIES_FILE.read_text(encoding="utf-8")
    lines = [l.strip() for l in content.splitlines() if l.strip() and not l.strip().startswith("#") and "\t" in l]
    auth_cookies = []
    domains = set()  # pyright: ignore[reportUnknownVariableType]
    auth_names = {"SAPISID", "SSID", "HSID", "SID", "LOGIN_INFO", "__Secure-1PSID", "__Secure-3PSID"}
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 7:
            domain = parts[0].removeprefix(".")
            name = parts[5]
            domains.add(domain)  # pyright: ignore[reportUnknownMemberType]
            auth_cookies.append({  # pyright: ignore[reportUnknownMemberType]
                "name": name,
                "domain": domain,
                "is_auth": name in auth_names,
            })
    total = len(auth_cookies)  # pyright: ignore[reportUnknownArgumentType]
    auth_present = [c["name"] for c in auth_cookies if c["is_auth"]]  # pyright: ignore[reportUnknownVariableType]
    return {  # pyright: ignore[reportUnknownVariableType]
        "exists": True,
        "total_cookies": total,
        "domains": sorted(domains),  # pyright: ignore[reportUnknownArgumentType]
        "auth_cookies_present": auth_present,
        "has_all_auth": all(n in auth_present for n in ["SAPISID", "SSID", "HSID", "SID"]),
    }


@app.post("/api/cookies/signin")
async def signin_to_youtube():
    status = get_signin_status()
    if status["in_progress"]:
        return {"status": "already_in_progress"}
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, start_signin)
    return {"status": "started"}


@app.get("/api/cookies/signin/status")
async def signin_status():
    return get_signin_status()


_playlist_sig: str = ""
_playlist_sig_lock = threading.Lock()


def _compute_playlist_sig() -> str:
    parts: list[str] = []
    for f in sorted(PLAYLISTS_DIR.glob("*")):
        if f.suffix.lower() not in (".csv", ".txt"):
            continue
        try:
            st = f.stat()
            parts.append(f"{f.name}|{st.st_mtime}|{st.st_size}")
        except OSError:
            continue
    return "||".join(parts)


@app.get("/api/events/playlists")
async def playlist_events():
    async def event_generator():
        global _playlist_sig
        with _playlist_sig_lock:
            if not _playlist_sig:
                _playlist_sig = _compute_playlist_sig()
        while True:
            await asyncio.sleep(2)
            sig = _compute_playlist_sig()
            with _playlist_sig_lock:
                if sig != _playlist_sig:
                    _playlist_sig = sig
                    yield "data: changed\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/downloads")
async def list_downloads():  # pyright: ignore[reportUnknownParameterType]
    files = []
    for path in sorted(DOWNLOADS_DIR.rglob("*")):
        if path.is_file() and path.suffix.lower() in (".mp3", ".mp4", ".m4a", ".webm"):
            rel = path.relative_to(DOWNLOADS_DIR)
            files.append({"name": str(rel), "size": path.stat().st_size})  # pyright: ignore[reportUnknownMemberType]
    return {"files": files}  # pyright: ignore[reportUnknownVariableType]
