import dataclasses
import os
import threading
import uuid
from pathlib import Path
from typing import Any

import yt_dlp  # type: ignore[import-untyped]
from yt_dlp.utils import DownloadError as YtDownloadError  # type: ignore[attr-defined]

from .config import COOKIES_FILE, DOWNLOADS_DIR, get_cookie_browser_targets
from .utils import _build_ydl_opts, _persist_cookies_from_browser, sanitize_filename

QUEUE_ITEM_STATUSES = ("waiting", "downloading", "completed", "failed", "cancelled")


@dataclasses.dataclass
class QueueItem:
    id: str = ""
    url: str = ""
    filename: str = ""
    fmt: str = "mp3"
    quality: str = "720"
    playlist: str = ""
    output_dir: str = ""
    include_thumbnail: bool = False
    status: str = "waiting"
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    speed: float = 0.0
    eta: int = 0
    error: str = ""
    output_path: str = ""


class DownloadQueueManager:
    def __init__(self, max_concurrent: int = 2):
        self.items: list[QueueItem] = []
        self._lock: threading.Lock = threading.Lock()
        self._max_concurrent: int = max_concurrent
        self._active_count: int = 0

    def _add_cookies(self, ydl_opts: dict[str, Any]) -> None:  # pyright: ignore[reportExplicitAny]
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

    def add(self, url: str, filename: str, fmt: str, quality: str, playlist: str, output_dir: str, include_thumbnail: bool = False) -> QueueItem:
        item = QueueItem(
            id=str(uuid.uuid4())[:8],
            url=url,
            filename=filename,
            fmt=fmt,
            quality=quality,
            playlist=playlist,
            output_dir=output_dir,
            include_thumbnail=include_thumbnail,
        )
        with self._lock:
            self.items.append(item)
        self._try_process()
        return item

    def remove(self, item_id: str) -> bool:
        with self._lock:
            for i, it in enumerate(self.items):
                if it.id == item_id:
                    if it.status == "downloading":
                        it.status = "cancelled"
                    else:
                        _ = self.items.pop(i)
                    return True
        return False

    def skip(self, item_id: str) -> bool:
        with self._lock:
            for i, it in enumerate(self.items):
                if it.id == item_id:
                    if it.status == "downloading":
                        it.status = "cancelled"
                    else:
                        _ = self.items.pop(i)
                    return True
        return False

    def reorder(self, item_id: str, new_index: int) -> None:
        with self._lock:
            idx = next(i for i, it in enumerate(self.items) if it.id == item_id)
            item = self.items.pop(idx)
            new_index = max(0, min(new_index, len(self.items)))
            self.items.insert(new_index, item)

    def clear_completed(self) -> None:
        with self._lock:
            self.items = [it for it in self.items if it.status in ("waiting", "downloading")]

    def set_max_concurrent(self, n: int) -> None:
        with self._lock:
            self._max_concurrent = max(1, n)

    def get_state(self) -> list[dict[str, Any]]:  # pyright: ignore[reportExplicitAny]
        with self._lock:
            return [dataclasses.asdict(it) for it in self.items]

    def _try_process(self) -> None:
        with self._lock:
            while self._active_count < self._max_concurrent:
                waiting = [it for it in self.items if it.status == "waiting"]
                if not waiting:
                    break
                item = waiting[0]
                item.status = "downloading"
                self._active_count += 1
                t = threading.Thread(target=self._download_worker, args=(item,), daemon=True)
                t.start()

    def _download_worker(self, item: QueueItem) -> None:
        ydl_opts: dict[str, Any] = {}  # pyright: ignore[reportExplicitAny]
        try:
            safe_name = sanitize_filename(item.filename)
            ext = item.fmt

            if item.output_dir:
                base_dir = Path(item.output_dir)
            else:
                base_dir = DOWNLOADS_DIR

            if item.playlist:
                subdir = base_dir / item.playlist
                subdir.mkdir(parents=True, exist_ok=True)
                item.output_path = str(subdir / f"{safe_name}.{ext}")
            else:
                item.output_path = str(base_dir / f"{safe_name}.{ext}")

            if os.path.exists(item.output_path):
                with self._lock:
                    item.status = "completed"
                    item.progress = 100
                return

            ydl_opts = _build_ydl_opts(item.output_path, item.fmt, item.quality, include_thumbnail=item.include_thumbnail)

            def hook(d: dict[str, Any]) -> None:  # pyright: ignore[reportExplicitAny]
                with self._lock:
                    if item.status == "cancelled":
                        raise YtDownloadError("Skipped")
                    item.downloaded_bytes = d.get("downloaded_bytes", 0)
                    item.total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
                    item.speed = d.get("speed", 0)
                    item.eta = d.get("eta", 0)
                    if item.total_bytes > 0:
                        item.progress = (item.downloaded_bytes / item.total_bytes) * 100
                    if d.get("status") == "finished" or item.downloaded_bytes >= item.total_bytes > 0:
                        item.progress = 100

            ydl_opts["progress_hooks"] = [hook]
            self._add_cookies(ydl_opts)

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore[reportArgumentType]
                _ = ydl.download([item.url])

            with self._lock:
                item.status = "completed"
                item.progress = 100
        except YtDownloadError as e:
            error_str = str(e)
            if error_str == "Skipped":
                with self._lock:
                    item.status = "cancelled"
                return
            if "cookiefile" in ydl_opts and ("403" in error_str or "forbidden" in error_str.lower()):
                for browser_name, profile in get_cookie_browser_targets():
                    try:
                        retry_opts = {k: v for k, v in ydl_opts.items() if k != "cookiefile"}
                        if profile:
                            retry_opts["cookiesfrombrowser"] = (browser_name, profile)
                        else:
                            retry_opts["cookiesfrombrowser"] = (browser_name,)
                        with yt_dlp.YoutubeDL(retry_opts) as ydl:  # pyright: ignore[reportArgumentType]
                            _ = ydl.download([item.url])
                        _persist_cookies_from_browser(browser_name, profile)
                        with self._lock:
                            item.status = "completed"
                            item.progress = 100
                        return
                    except YtDownloadError:
                        continue
            with self._lock:
                item.status = "failed"
                item.error = error_str
        except Exception as e:  # noqa: BLE001
            with self._lock:
                item.status = "failed"
                item.error = str(e)
        finally:
            with self._lock:
                self._active_count -= 1
            self._try_process()


download_queue = DownloadQueueManager(max_concurrent=2)
