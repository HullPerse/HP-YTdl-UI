import http.client
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

import yt_dlp
from yt_dlp.cookies import extract_cookies_from_browser
from yt_dlp.utils import DownloadError as YtDownloadError

from .config import (
    COOKIES_FILE,
    EXTRACTOR_ARGS,
    PLAYLISTS_DIR,
    USER_AGENT,
    download_progress,
    get_cookie_browser_targets,
)
from .types import (
    CookieDetectResult,
    DownloadError,
    MetadataResult,
    ParsedTitle,
    PlaylistImportResult,
    PlaylistInfo,
    ProgressData,
    SearchResult,
    YdlOpts,
    YtdlpUpdateResult,
    YtdlpVersionResult,
)


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.strip(". ")
    if not name:
        name = "untitled"
    return name[:120]


def parse_youtube_title(raw_title: str) -> ParsedTitle:
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

    misc_parts: list[str] = []
    def _collect_misc(m: re.Match[str]) -> str:
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


def get_playlists() -> list[PlaylistInfo]:
    playlists: list[PlaylistInfo] = []
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


def search_youtube_sync(query: str, max_results: int = 8) -> list[SearchResult]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
    }
    search_query = f"ytsearch{max_results}:{query}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
        result = ydl.extract_info(search_query, download=False)
        entries = result.get("entries", []) if result else []
        results: list[SearchResult] = []
        for e in entries:
            if not e or not e.get("id"):
                continue
            video_id = str(e.get("id", ""))
            results.append({
                "id": video_id,
                "title": str(e.get("title", "Unknown")),
                "channel": str(e.get("channel", e.get("uploader", "Unknown"))),
                "duration": e.get("duration"),
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={video_id}",
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


def _progress_hook(d: ProgressData) -> None:
    ident = d.get("info_dict", {})
    url: str = str(ident.get("webpage_url", "") or ident.get("url", "")) if isinstance(ident, dict) else ""
    url_hash = _url_hash(url)
    download_progress[url_hash] = {
        "status": d.get("status"),
        "downloaded_bytes": d.get("downloaded_bytes", 0),
        "total_bytes": d.get("total_bytes") or d.get("total_bytes_estimate", 0),
        "speed": d.get("speed", 0),
        "eta": d.get("eta", 0),
        "percent": str(d.get("_percent_str", "")).strip(),
    }


def _build_ydl_opts(output_path: str, fmt: str, quality: str = "720", include_thumbnail: bool = False) -> YdlOpts:
    opts: YdlOpts = {
        "quiet": True,
        "no_warnings": True,
        "js_runtimes": {"node": {}},
        "extractor_args": EXTRACTOR_ARGS,
        "user_agent": USER_AGENT,
    }
    if fmt == "mp3":
        base_opts = {
            "format": "bestaudio/best",
            "outtmpl": output_path.replace(".mp3", ".%(ext)s"),
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",
            }],
            "embedmetadata": True,
        }
        if include_thumbnail:
            base_opts["writethumbnail"] = True
            base_opts["embedthumbnail"] = True
        opts.update(base_opts)
    else:
        format_spec = f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]"
        base_opts = {
            "format": format_spec,
            "outtmpl": output_path.replace(".mp4", ".%(ext)s"),
            "merge_output_format": "mp4",
            "embedmetadata": True,
        }
        if include_thumbnail:
            base_opts["writethumbnail"] = True
            base_opts["embedthumbnail"] = True
        opts.update(base_opts)
    return opts


def _try_cookiesfrombrowser(ydl_opts: YdlOpts, url: str) -> bool:
    for browser_name, profile in get_cookie_browser_targets():
        try:
            cookie_opts = {k: v for k, v in ydl_opts.items() if k != "cookiefile"}
            if profile:
                cookie_opts["cookiesfrombrowser"] = (browser_name, profile)
            else:
                cookie_opts["cookiesfrombrowser"] = (browser_name,)
            with yt_dlp.YoutubeDL(cookie_opts) as ydl:  # pyright: ignore[reportArgumentType]
                _ = ydl.download([url])
            _persist_cookies_from_browser(browser_name, profile)
            return True
        except YtDownloadError:
            continue
    return False


def _persist_cookies_from_browser(browser_name: str, profile: str | None = None) -> None:
    if extract_cookies_from_browser is not None:
        try:
            jar = extract_cookies_from_browser(browser_name, profile=profile)
            if jar:
                youtube_count = len([c for c in jar if "youtube.com" in (c.domain or "")])
                if youtube_count > 0:
                    netscape = _cookiejar_to_netscape(jar)
                    COOKIES_FILE.parent.mkdir(parents=True, exist_ok=True)
                    COOKIES_FILE.write_text(netscape, encoding="utf-8")
        except Exception:  # noqa: BLE001, S110
            pass


def download_sync(url: str, output_path: str, fmt: str, quality: str = "720", include_thumbnail: bool = False) -> None:
    ydl_opts = _build_ydl_opts(output_path, fmt, quality, include_thumbnail=include_thumbnail)
    ydl_opts["progress_hooks"] = [_progress_hook]
    _add_cookies_to_opts(ydl_opts)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
            _ = ydl.download([url])
    except YtDownloadError as e:
        error_str = str(e)
        if "cookiefile" in ydl_opts and ("403" in error_str or "forbidden" in error_str.lower()):  # noqa: SIM102
            if _try_cookiesfrombrowser(ydl_opts, url):
                return
        raise DownloadError(str(e))


def _add_cookies_to_opts(ydl_opts: YdlOpts) -> None:
    if COOKIES_FILE.exists():
        ydl_opts["cookiefile"] = str(COOKIES_FILE)
    else:
        for browser_name, profile in get_cookie_browser_targets():
            try:
                if profile:
                    ydl_opts["cookiesfrombrowser"] = (browser_name, profile)
                else:
                    ydl_opts["cookiesfrombrowser"] = (browser_name,)
                return
            except Exception:  # noqa: BLE001,S112
                continue


def get_video_stream_url_sync(video_id: str, quality: str = "360") -> str:
    url = f"https://www.youtube.com/watch?v={video_id}"
    ydl_opts: YdlOpts = {
        "quiet": True,
        "no_warnings": True,
        "format": f"best[height<={quality}]/best",
    }
    _add_cookies_to_opts(ydl_opts)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
        info = ydl.extract_info(url, download=False)
    return str(info.get("url", ""))


def get_video_metadata_sync(url: str) -> MetadataResult:
    ydl_opts: YdlOpts = {
        "quiet": True,
        "no_warnings": True,
        "js_runtimes": {"node": {}},
        "extractor_args": EXTRACTOR_ARGS,
        "user_agent": USER_AGENT,
    }
    _add_cookies_to_opts(ydl_opts)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
        info = ydl.extract_info(url, download=False)
    raw_title: str = str(info.get("title") or "")
    parsed = parse_youtube_title(raw_title)
    info_id: str = str(info.get("id") or "")
    return {
        **parsed,
        "duration": info.get("duration"),
        "channel": str(info.get("channel", info.get("uploader", ""))),
        "id": info_id,
        "thumbnail": f"https://img.youtube.com/vi/{info_id}/hqdefault.jpg",
    }


def _cookiejar_to_netscape(cj: http.cookiejar.CookieJar) -> str:
    lines = ["# Netscape HTTP Cookie File", "# Generated by HP YTdl UI"]
    for c in cj:
        if not c.value:
            continue
        include_subs = "TRUE" if c.domain_initial_dot else "FALSE"
        secure = "TRUE" if c.secure else "FALSE"
        if c.expires is None:
            expires = "0"
        else:
            try:
                expires = str(int(c.expires))
            except (TypeError, ValueError):
                expires = "0"
        domain = c.domain or ""
        path = c.path or "/"
        name = c.name
        value = c.value
        lines.append(f"{domain}\t{include_subs}\t{path}\t{secure}\t{expires}\t{name}\t{value}")
    return "\r\n".join(lines) + "\r\n"


def _classify_cookie_error(entry: str, exc: Exception) -> str:
    msg = (str(exc) or "").lower()
    browser = entry.split(":")[0]
    if not msg:
        return f"{browser}:error"
    if "could not find" in msg or "no such file" in msg or "not found" in msg:
        return "not_found"
    if "could not copy" in msg or "permission denied" in msg or "being used" in msg or "locked" in msg:
        return "locked"
    if "no cookies" in msg or "empty" in msg:
        return "no_cookies"
    if "keyring" in msg or "decrypt" in msg:
        return "decrypt_failed"
    return f"{browser}:error:{msg[:60]}"


def _build_cookie_targets() -> list[tuple[str, str | None]]:
    return get_cookie_browser_targets()


AUTH_COOKIE_NAMES = {"SAPISID", "SSID", "HSID", "SID"}


def _count_auth_cookies(jar: http.cookiejar.CookieJar) -> int:
    return sum(1 for c in jar if c.name in AUTH_COOKIE_NAMES and c.value)


def auto_detect_cookies_sync() -> CookieDetectResult:
    result_info: dict[str, str] = {}
    if extract_cookies_from_browser is None:
        return {
            "found": False,
            "total": 0,
            "detail": "yt-dlp cookies API not available in this build",
            "per_browser": result_info,
        }

    best_jar = None
    best_label = ""
    best_score = -1
    best_youtube_count = 0
    best_total = 0

    for browser_name, profile in _build_cookie_targets():
        label = browser_name if profile is None else f"{browser_name}:{os.path.basename(profile) if profile else 'default'}"
        try:
            jar = extract_cookies_from_browser(browser_name, profile=profile)
        except FileNotFoundError:
            result_info[label] = "not_found"
            continue
        except PermissionError:
            result_info[label] = "locked"
            continue
        except Exception as e:  # noqa: BLE001
            result_info[label] = _classify_cookie_error(label, e)
            continue

        if not jar:
            result_info[label] = "no_cookies"
            continue

        youtube_cookies = [c for c in jar if "youtube.com" in (c.domain or "")]
        yt_count = len(youtube_cookies)
        auth_count = _count_auth_cookies(jar)
        score = (yt_count * 10) + auth_count * 100 + len(jar)
        result_info[label] = f"{len(jar)}cookies({yt_count}yt,{auth_count}auth)"

        if score > best_score:
            best_jar = jar
            best_label = label
            best_score = score
            best_youtube_count = yt_count
            best_total = len(jar)

    if best_jar is None:
        detail = "; ".join(f"{k}: {v}" for k, v in result_info.items())
        return {"found": False, "total": 0, "detail": detail or "no supported browsers found", "per_browser": result_info}

    try:
        youtube_jar = http.cookiejar.CookieJar()
        for c in best_jar:
            if "youtube.com" in (c.domain or "") and c.value:
                youtube_jar.set_cookie(c)
        netscape = _cookiejar_to_netscape(youtube_jar)
        COOKIES_FILE.parent.mkdir(parents=True, exist_ok=True)
        COOKIES_FILE.write_text(netscape, encoding="utf-8")
    except OSError as e:
        return {"found": False, "total": 0, "detail": f"write_failed:{e}", "per_browser": result_info}

    auth_count = _count_auth_cookies(best_jar)
    missing_auth = AUTH_COOKIE_NAMES - {c.name for c in best_jar if c.value}

    return {
        "found": True,
        "total": best_youtube_count,
        "youtube_cookies": best_youtube_count,
        "auth_cookies": auth_count,
        "missing_auth": sorted(missing_auth),
        "has_all_auth": len(missing_auth) == 0,
        "source": best_label,
        "detail": f"Extracted {best_total} cookies from {best_label} ({best_youtube_count} for YouTube, {auth_count} auth cookies)",
        "per_browser": result_info,
    }


def import_playlist_sync(url: str, name: str) -> PlaylistImportResult:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "ignoreerrors": True,
    }
    _add_cookies_to_opts(ydl_opts)
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
            info = ydl.extract_info(url, download=False)
    except YtDownloadError as e:
        detail = str(e)
        if "[DRM]" in detail:
            detail = "This URL is not supported. Only YouTube playlists work with this feature."
        raise DownloadError(detail)
    if not info:
        raise DownloadError("This URL is not supported. Only YouTube playlists work with this feature.")
    entries = info.get("entries") or []
    tracks: list[str] = []
    for e in entries:
        if e and e.get("title"):
            tracks.append(str(e.get("title", "")))
    playlist_path = PLAYLISTS_DIR / f"{sanitize_filename(name)}.csv"
    _ = playlist_path.write_text("\n".join(tracks), encoding="utf-8")
    return {"name": name, "count": len(tracks), "path": str(playlist_path)}


def import_playlist_from_url_sync(url: str) -> PlaylistImportResult:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "ignoreerrors": True,
    }
    _add_cookies_to_opts(ydl_opts)
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
            info = ydl.extract_info(url, download=False)
    except YtDownloadError as e:
        detail = str(e)
        if "[DRM]" in detail:
            detail = "This URL is not supported. Only YouTube playlists work with this feature."
        raise DownloadError(detail)
    if not info:
        raise DownloadError("This URL is not supported. Only YouTube playlists work with this feature.")
    name = str(info.get("title", "Untitled Playlist") or "Untitled Playlist")
    entries = info.get("entries") or []
    tracks: list[str] = []
    for e in entries:
        if e and e.get("title"):
            tracks.append(str(e.get("title", "")))
    playlist_path = PLAYLISTS_DIR / f"{sanitize_filename(name)}.csv"
    _ = playlist_path.write_text("\n".join(tracks), encoding="utf-8")
    return {"name": name, "count": len(tracks), "path": str(playlist_path)}




def _get_installed_ytdlp_version() -> str:
    _ver_mod = getattr(yt_dlp, "version", None)
    ver = str(getattr(_ver_mod, "__version__", "") or "") if _ver_mod else ""
    if ver:
        return ver
    try:
        from importlib.metadata import version as _dist_version
        return _dist_version("yt-dlp")
    except Exception:  # noqa: BLE001
        return ""


def _fetch_latest_pypi_version_sync() -> str:
    try:
        req = urllib.request.Request(
            "https://pypi.org/pypi/yt-dlp/json",
            headers={"User-Agent": "hp-ytdl-ui/1.0"},
        )
        _response = urllib.request.urlopen(req, timeout=10)
        with _response:
            resp: http.client.HTTPResponse = _response
            data = json.loads(resp.read().decode("utf-8"))
        ver = data.get("info", {}).get("version", "")
        return str(ver) if ver else ""
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return ""


def _normalize_version(ver: str) -> str:
    parts = ver.split(".")
    return ".".join(p.lstrip("0") or "0" for p in parts)


def _run_ytdlp_version_sync() -> YtdlpVersionResult:
    current = _get_installed_ytdlp_version()
    latest = _fetch_latest_pypi_version_sync()
    cur_norm = _normalize_version(current) if current else ""
    lat_norm = _normalize_version(latest) if latest else ""
    return {
        "version": current,
        "latest": latest,
        "available": bool(current),
        "frozen": bool(getattr(sys, "frozen", False)),
        "update_available": bool(current and latest and cur_norm != lat_norm),
    }


def _run_ytdlp_update_sync() -> YtdlpUpdateResult:
    if getattr(sys, "frozen", False):
        return {
            "updated": False,
            "frozen": True,
            "error": "yt-dlp is bundled with this app. Download a new release to update yt-dlp.",
        }
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "yt-dlp"],
            capture_output=True, text=True, timeout=120, check=False,
        )
        if result.returncode == 0:
            new_version = _get_installed_ytdlp_version()
            return {"updated": True, "version": new_version, "output": result.stdout.strip()}
        return {"updated": False, "error": (result.stderr or result.stdout).strip()}
    except Exception as e:  # noqa: BLE001
        return {"updated": False, "error": str(e)}
