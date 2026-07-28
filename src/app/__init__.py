import os
from collections.abc import MutableMapping
from typing import Any

from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import FRONTEND_DIR


class _NoCacheStaticFiles(StaticFiles):
    def file_response(
        self,
        full_path: str | os.PathLike[str],
        stat_result: os.stat_result,
        scope: MutableMapping[str, Any],
        status_code: int = 200,
    ) -> Response:
        resp = super().file_response(full_path, stat_result, scope, status_code)
        if str(full_path).endswith(".js"):
            resp.headers["Cache-Control"] = "no-cache, must-revalidate"
        return resp


app = FastAPI(title="YouTube Downloader")

templates = Jinja2Templates(directory=str(FRONTEND_DIR))
app.mount("/static", _NoCacheStaticFiles(directory=str(FRONTEND_DIR)), name="static")

from . import routes

_ = routes
