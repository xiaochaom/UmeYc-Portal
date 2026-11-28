"""Loopback file previews and explicitly opened, short-lived QR URL input."""

import asyncio
from collections import OrderedDict
import html
import json
import math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import secrets
import shutil
import sys
import threading
import queue
from urllib.parse import urlsplit

# Decky loads main.py by filename rather than importing a plugin package.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from phone_input import PhoneInputSession, lan_address
from image_upload import upload_destination, ensure_upload_directory
from local_library import LocalLibrary
from web_scroll import WebScroller


SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico",
    ".pdf", ".html", ".htm", ".txt", ".md",
}
IMAGE_EXTENSIONS = SUPPORTED_EXTENSIONS - {".pdf", ".html", ".htm", ".txt", ".md"}


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        self.grants = OrderedDict()
        self.grants_lock = threading.Lock()
        self.reader_states = OrderedDict()
        self.listeners = {}
        self.stopping = False
        super().__init__(("127.0.0.1", 0), PreviewHandler)

    def authorize(self, path):
        with self.grants_lock:
            # Reuse the same page while reopening the same file in this session.
            for token, granted in self.grants.items():
                if granted == path:
                    self.grants.move_to_end(token)
                    break
            else:
                token = secrets.token_urlsafe(32)
            self.grants[token] = path
            while len(self.grants) > 64:
                self.grants.popitem(last=False)
        route = "viewer" if path.suffix.lower() in IMAGE_EXTENSIONS else "file"
        return f"http://127.0.0.1:{self.server_port}/{route}/{token}"

    def motion(self, path, x, y):
        self.broadcast(path, {"x": x, "y": y})

    def broadcast(self, path, message):
        payload = json.dumps(message)
        with self.grants_lock:
            tokens = [token for token, granted in self.grants.items() if granted == path]
            for token in tokens:
                for listener in self.listeners.get(token, []):
                    if listener.full():
                        listener.get_nowait()
                    listener.put_nowait(payload)

    def stop_readers(self):
        with self.grants_lock:
            self.stopping = True
            for listeners in self.listeners.values():
                for listener in listeners:
                    if listener.full():
                        listener.get_nowait()
                    listener.put_nowait(None)


class PreviewHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # File names and bearer tokens must not end up in the access log.
        pass

    def do_HEAD(self):
        self._respond(head=True)

    def do_GET(self):
        self._respond(head=False)

    def do_POST(self):
        parts = urlsplit(self.path).path.split("/")
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if (self.headers.get("Host") != origin.removeprefix("http://") or
                self.headers.get("Origin") not in {None, origin} or
                len(parts) != 3 or parts[1] != "state"):
            self.send_error(403)
            return
        with self.server.grants_lock:
            path = self.server.grants.get(parts[2])
        if path is None:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError()
            state = json.loads(self.rfile.read(length))
            saved = {name: float(state[name]) for name in ("top", "left", "zoom")}
            if not all(math.isfinite(value) for value in saved.values()):
                raise ValueError()
            if not (0 <= saved["top"] <= 100000 and 0 <= saved["left"] <= 100000 and
                    0.25 <= saved["zoom"] <= 8):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
            return
        with self.server.grants_lock:
            self.server.reader_states[path] = saved
            self.server.reader_states.move_to_end(path)
            while len(self.server.reader_states) > 128:
                self.server.reader_states.popitem(last=False)
        self.send_response(204)
        self.end_headers()

    def _respond(self, head):
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.send_error(403)
            return
        parts = urlsplit(self.path).path.split("/")
        if len(parts) != 3 or parts[1] not in {"viewer", "file", "script", "events"}:
            self.send_error(404)
            return
        route, token = parts[1:]
        with self.server.grants_lock:
            path = self.server.grants.get(token)
        if path is None:
            self.send_error(404)
            return

        try:
            if route == "viewer":
                with self.server.grants_lock:
                    state = dict(self.server.reader_states.get(path, {"top": 0, "left": 0, "zoom": 1}))
                template = Path(__file__).with_name("assets").joinpath("image-viewer.html")
                content = template.read_text(encoding="utf-8").replace(
                    "{{TITLE}}", html.escape(path.name)
                ).replace("{{TOKEN}}", token).replace(
                    "{{STATE}}", html.escape(json.dumps(state), quote=True)
                )
                icons = json.loads(template.with_name("zoom-icons.json").read_text())
                for key, icon in icons.items():
                    content = content.replace("{{ICON_" + key.upper() + "}}", html.escape(icon, quote=True))
                content = content.encode("utf-8")
                self._headers("text/html; charset=utf-8", len(content))
                if not head:
                    self.wfile.write(content)
            elif route == "script":
                content = Path(__file__).with_name("assets").joinpath("image-viewer.js").read_bytes()
                self._headers("text/javascript; charset=utf-8", len(content))
                if not head:
                    self.wfile.write(content)
            elif route == "events":
                if head:
                    self._headers("text/event-stream", 0)
                else:
                    self._events(token)
            else:
                with path.open("rb") as source:
                    # Use the opened file's size, avoiding a separate stat/open race.
                    size = os.fstat(source.fileno()).st_size
                    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                    if path.suffix.lower() in {".txt", ".md"}:
                        mime = "text/plain; charset=utf-8"
                    self._headers(mime, size, sandbox=True)
                    if not head:
                        shutil.copyfileobj(source, self.wfile)
        except (FileNotFoundError, PermissionError, IsADirectoryError):
            self.send_error(404, "File is unavailable; please select it again")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _events(self, token):
        listener = queue.Queue(maxsize=4)
        with self.server.grants_lock:
            subscribers = self.server.listeners.setdefault(token, [])
            if len(subscribers) >= 4:
                self.send_error(429)
                return
            subscribers.append(listener)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while not self.server.stopping:
                try:
                    payload = listener.get(timeout=15)
                    if payload is None:
                        break
                    self.wfile.write(f"data: {payload}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        finally:
            with self.server.grants_lock:
                self.server.listeners.get(token, []).remove(listener)

    def _headers(self, content_type, length, sandbox=False):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        if sandbox:
            self.send_header("Content-Security-Policy", "sandbox")
        else:
            self.send_header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'")
        self.end_headers()


class Plugin:
    def __init__(self):
        self._server = None
        self._thread = None
        self._phone = None
        self._phone_lock = asyncio.Lock()
        self._web_scroller = WebScroller()
        self._library = LocalLibrary(SUPPORTED_EXTENSIONS)

    def _start(self):
        if self._server is None:
            self._server = PreviewServer()
            self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
            self._thread.start()

    async def _main(self):
        self._start()

    async def prepare_local_file(self, path: str):
        if not isinstance(path, str) or not Path(path).is_absolute():
            raise ValueError("请选择一个本地文件")
        try:
            selected = Path(path).resolve(strict=True)
            if not selected.is_file():
                raise ValueError("请选择文件，不能选择文件夹")
            if selected.suffix.lower() not in SUPPORTED_EXTENSIONS:
                raise ValueError("支持图片、PDF、HTML 和文本文件")
            with selected.open("rb"):
                pass
        except OSError as error:
            raise ValueError("文件不存在或无法读取，请检查 SD 卡后重新选择") from error
        self._start()
        return {"url": self._server.authorize(selected)}

    async def list_local_files(self, directory: str):
        try:
            return self._library.list(directory)
        except OSError as error:
            raise ValueError("无法读取文件夹，请检查存储设备或重新选择位置") from error

    async def delete_local_file(self, token: str):
        try:
            path = self._library.delete(token)
        except OSError as error:
            raise ValueError("文件不存在或无法删除，请刷新列表后重试") from error
        if self._server is not None:
            with self._server.grants_lock:
                selected = Path(path)
                self._server.reader_states.pop(selected, None)
                for grant, granted in list(self._server.grants.items()):
                    if granted == selected:
                        self._server.grants.pop(grant)
                        for listener in self._server.listeners.get(grant, []):
                            if listener.full():
                                listener.get_nowait()
                            listener.put_nowait(None)
        return {"path": path}

    async def get_upload_directory(self, directory: str = ""):
        destination = upload_destination(directory)
        try:
            ensure_upload_directory(destination)
        except OSError as error:
            raise ValueError("图片保存位置无法使用，请重新选择文件夹") from error
        return {"directory": str(destination)}

    async def _unload(self):
        await self._web_scroller.close()
        async with self._phone_lock:
            if self._phone is not None:
                await asyncio.to_thread(self._phone.close)
                self._phone = None
        if self._server is not None:
            self._server.stop_readers()
            await asyncio.to_thread(self._server.shutdown)
            self._server.server_close()
            await asyncio.to_thread(self._thread.join, 2)
            self._server = None
            self._thread = None

    async def get_web_page_state(self, url: str, title: str = ""):
        return await self._web_scroller.page_state(url, title)

    async def scroll_web_page(self, url: str, x: float, y: float, width: float, height: float, title: str = ""):
        await self._web_scroller.scroll(url, x, y, width, height, title)

    async def release_web_scroll(self):
        await self._web_scroller.close()

    async def zoom_web_page(self, url: str, action: str, title: str = ""):
        return await self._web_scroller.zoom(url, action, title)

    async def send_web_space(self, url: str, title: str = ""):
        await self._web_scroller.space(url, title)

    async def toggle_web_fullscreen(self, url: str, title: str = ""):
        await self._web_scroller.fullscreen(url, title)

    async def set_web_media(self, url: str, action: str, title: str = ""):
        await self._web_scroller.media(url, action, title)

    async def zoom_reader(self, path: str, action: str):
        if action not in ("smaller", "default", "larger"):
            raise ValueError("Invalid zoom action")
        selected = Path(path).resolve()
        if self._server is None:
            raise ValueError("Reader is not open")
        with self._server.grants_lock:
            if selected not in self._server.grants.values() or selected.suffix.lower() not in IMAGE_EXTENSIONS:
                raise ValueError("Image has not been selected")
        self._server.broadcast(selected, {"zoom": action})

    async def set_reader_motion(self, path: str, x: float, y: float):
        if self._server is None:
            return
        if not all(isinstance(value, (float, int)) and math.isfinite(value) and
                   -1 <= value <= 1 for value in (x, y)):
            raise ValueError("Invalid stick velocity")
        selected = Path(path).resolve()
        with self._server.grants_lock:
            if selected not in self._server.grants.values():
                raise ValueError("File has not been selected")
        self._server.motion(selected, x, y)

    async def start_url_input(self, directory: str = ""):
        async with self._phone_lock:
            if self._phone is not None:
                await asyncio.to_thread(self._phone.close)
                self._phone = None
            try:
                destination = upload_destination(directory)
                self._phone = PhoneInputSession(lan_address(), upload_directory=destination)
            except OSError as error:
                raise ValueError("无法打开扫码输入，请检查网络后重试") from error
            picker_directory = destination
            while not picker_directory.is_dir():
                picker_directory = picker_directory.parent
            return {"session_id": self._phone.session_id, "url": self._phone.url, "expires_in": 300,
                    "upload_directory": str(destination), "upload_picker_directory": str(picker_directory)}

    async def get_url_input_status(self, session_id: str):
        session = self._phone
        if session is None or session.session_id != session_id:
            return {"status": "expired"}
        status = session.status()
        if status["status"] in {"received", "expired"}:
            await asyncio.to_thread(session.close)
        return status

    async def cancel_url_input(self, session_id: str):
        async with self._phone_lock:
            if self._phone is not None and self._phone.session_id == session_id:
                await asyncio.to_thread(self._phone.close)
                self._phone = None
