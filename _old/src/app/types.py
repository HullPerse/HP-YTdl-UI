from typing import Any, NotRequired, TypedDict

YdlOpts = dict[str, Any]
ProgressData = dict[str, Any]
StateData = dict[str, Any]


class DownloadError(Exception):
    pass


class ParsedTitle(TypedDict):
    artist: str
    title: str
    misc: str
    filename: str
    source_title: str


class PlaylistInfo(TypedDict):
    name: str
    tracks: list[str]
    count: int


class SearchResult(TypedDict):
    id: str
    title: str
    channel: str
    duration: int | None
    thumbnail: str
    url: str


class MetadataResult(ParsedTitle):
    duration: int | None
    channel: str
    id: str
    thumbnail: str


class CookieDetectResult(TypedDict):
    found: bool
    total: int
    detail: str
    per_browser: dict[str, str]
    youtube_cookies: NotRequired[int]
    auth_cookies: NotRequired[int]
    missing_auth: NotRequired[list[str]]
    has_all_auth: NotRequired[bool]
    source: NotRequired[str]


class PlaylistImportResult(TypedDict):
    name: str
    count: int
    path: str


class YtdlpVersionResult(TypedDict):
    version: str
    latest: str
    available: bool
    frozen: bool
    update_available: bool


class YtdlpUpdateResult(TypedDict):
    updated: bool
    version: NotRequired[str]
    frozen: NotRequired[bool]
    error: NotRequired[str]
    output: NotRequired[str]
