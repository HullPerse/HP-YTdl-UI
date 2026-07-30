import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

APP_VERSION = "1.0.0"

_meipass = getattr(sys, '_MEIPASS', None)
BUNDLE_DIR = Path(_meipass) if _meipass else Path(__file__).parent.parent.parent
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

download_progress: dict[str, dict[str, object]] = {}

CONFIG_FILE = DATA_DIR / "config.json"


def _load_config() -> dict[str, str]:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_config(data: dict[str, str]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
