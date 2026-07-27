from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import FRONTEND_DIR

app = FastAPI(title="YouTube Downloader")

templates = Jinja2Templates(directory=str(FRONTEND_DIR))
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

from . import routes

_ = routes
