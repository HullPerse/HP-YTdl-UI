import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

APP_VERSION = "1.0.0"

BUNDLE_DIR = Path(sys._MEIPASS) if getattr(sys, 'frozen', False) else Path(__file__).parent.parent.parent  # type: ignore[attr-defined]  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType, reportAttributeAccessIssue]
APP_DIR = Path(sys.executable).parent if getattr(sys, 'frozen', False) else BUNDLE_DIR

FRONTEND_DIR = BUNDLE_DIR / "src" / "frontend"
DATA_DIR = APP_DIR / "data"

PLAYLISTS_DIR = DATA_DIR / "playlists"
DOWNLOADS_DIR = DATA_DIR / "downloads"
COOKIES_FILE = DATA_DIR / "cookies.txt"

PLAYLISTS_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

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

def get_cookie_browser_targets() -> list[tuple[str, str | None]]:
    seen: set[tuple[str, str | None]] = set()
    targets: list[tuple[str, str | None]] = []
    for b in STANDARD_BROWSERS:
        key = (b, None)
        if key not in seen:
            targets.append(key)
            seen.add(key)
    for profile in CHROME_PROFILES:
        key = ("chrome", profile)
        if key not in seen:
            targets.append(key)
            seen.add(key)
    return targets

APP_TITLE = "HP YTdl UI"
APP_MODE = "web"


def set_app_mode(mode: str) -> None:
    global APP_MODE
    APP_MODE = mode


download_progress: dict[str, dict[str, Any]] = {}  # pyright: ignore[reportExplicitAny]
