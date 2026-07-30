import argparse
import logging
import shutil
import subprocess
import sys
import webbrowser

from .config import BUNDLE_DIR, FRONTEND_DIR


def _build_ts():
    _ = subprocess.run(
        ["npx", "esbuild", "index.ts", "--bundle",
         "--outfile=index.min.js", "--target=es2020"],
        check=False, cwd=str(FRONTEND_DIR), shell=True,
    )


def main():
    parser = argparse.ArgumentParser()
    _ = parser.add_argument("--build", action="store_true", help="Build standalone .exe with PyInstaller")
    args = parser.parse_args()

    ICON_PATH = BUNDLE_DIR / "src" / "assets" / "icon.ico"

    if args.build:
        _build_ts()
        build_cmd = [
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--console",
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
        _ = subprocess.Popen(
            ["npx", "esbuild", "index.ts", "--bundle",
             "--outfile=index.min.js", "--target=es2020", "--watch"],
            cwd=str(FRONTEND_DIR), shell=True,
        )

    import uvicorn

    if getattr(sys, 'frozen', False):
        logging.getLogger("uvicorn").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
        print("Server starting at http://127.0.0.1:8000", flush=True)
        webbrowser.open("http://127.0.0.1:8000")
        uvicorn.run("app:app", host="127.0.0.1", port=8000, log_level="warning")
    else:
        uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    main()
