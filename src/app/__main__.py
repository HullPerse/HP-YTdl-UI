import argparse
import ctypes
import shutil
import subprocess
import sys
import threading
import time

from .config import APP_TITLE, BUNDLE_DIR, FRONTEND_DIR


def _build_ts():
    _ = subprocess.run(
        ["npx", "esbuild", "index.ts", "--bundle",
         "--outfile=index.min.js", "--target=es2020"],
        check=False, cwd=str(FRONTEND_DIR), shell=True,
    )


def main():
    parser = argparse.ArgumentParser()
    _ = parser.add_argument("--app", action="store_true", help="Open in native window")
    _ = parser.add_argument("--build", action="store_true", help="Build standalone .exe with PyInstaller")
    args = parser.parse_args()

    ICON_PATH = BUNDLE_DIR / "src" / "assets" / "icon.ico"


    if args.build:  # pyright: ignore[reportAny]
        _build_ts()
        build_cmd = [
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--noconsole",
            "--name", "hp-ytdl-ui",
            "--add-data", f"{FRONTEND_DIR};src/frontend",
            "--hidden-import", "uvicorn.logging",
            "--hidden-import", "uvicorn.loops",
            "--hidden-import", "uvicorn.protocols",
            "--hidden-import", "uvicorn.middleware",
            "--hidden-import", "yt_dlp",
            "--paths", str(BUNDLE_DIR / "src"),
            "--icon", str(ICON_PATH),
            str(BUNDLE_DIR / "run.py"),
        ]
        print("Building hp-ytdl-ui.exe ...", flush=True)
        result = subprocess.run(build_cmd, check=False)
        if result.returncode == 0:
            build_dir = BUNDLE_DIR / "build"
            if build_dir.exists():
                shutil.rmtree(build_dir)
            print("Done! dist/hp-ytdl-ui.exe created.", flush=True)
        else:
            sys.exit(result.returncode)
        sys.exit(0)

    if not getattr(sys, 'frozen', False):
        _build_ts()

    dev_mode = not getattr(sys, 'frozen', False) and not args.app
    if dev_mode:
        _ = subprocess.Popen(
            ["npx", "esbuild", "index.ts", "--bundle",
             "--outfile=index.min.js", "--target=es2020", "--watch"],
            cwd=str(FRONTEND_DIR), shell=True,
        )

    if getattr(sys, 'frozen', False) or args.app:  # pyright: ignore[reportAny]
        from .config import set_app_mode
        set_app_mode("desktop")
        import webview  # type: ignore[import-untyped]

        def _start_server():
            import uvicorn
            uvicorn.run("app:app", host="127.0.0.1", port=8000, log_level="info")  # pyright: ignore[reportUnknownMemberType]

        t = threading.Thread(target=_start_server, daemon=True)
        t.start()
        time.sleep(1.5)
        _ = webview.create_window(APP_TITLE, "http://127.0.0.1:8000")  # pyright: ignore[reportUnknownMemberType]

        try:

          item = ctypes.windll.user32.FindWindowW(None, APP_TITLE)  # pyright: ignore[reportAny]

          if item:
            ctypes.windll.user32.SetWindowTextW(item, APP_TITLE)

          ctypes.windll.kernel32.SetConsoleTitleW(APP_TITLE)

        except:  # noqa: E722, S110
          pass

        webview.start()
    else:
        import uvicorn
        uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)  # pyright: ignore[reportUnknownMemberType]


if __name__ == "__main__":
    main()
