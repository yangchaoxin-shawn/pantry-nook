"""独立设计评审服务：只读白名单素材，不提供业务 API 或目录浏览。"""
import argparse
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
SHARED = REPO / 'frontend' / 'src'
ALLOWED_CSS = {
    'App.css', 'styles/journal.css', 'styles/handwriting.css',
    'shared/ui/journal-scene-hero.css', 'features/journal/journal-page.css',
    'features/catalog/catalog.css', 'features/menu/menu-timeline.css',
    'features/inventory/inventory-view.css',
}

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = unquote(urlsplit(self.path).path)
        file = None
        if route in ('/', '/index.html', '/prototype.css', '/prototype.js', '/reference-pages.js', '/assets/table-memories.png'):
            file = ROOT / ('index.html' if route == '/' else route[1:])
        elif route.startswith('/reference/'):
            relative = route.removeprefix('/reference/')
            target = (SHARED / relative).resolve()
            assets = (SHARED / 'assets' / 'journal').resolve()
            if relative in ALLOWED_CSS or (target.is_relative_to(assets) and target.suffix in ('.webp', '.svg', '.woff2')):
                file = target
        elif route.startswith('/samples/'):
            index = route.removeprefix('/samples/').removesuffix('.jpg')
            if index.isdigit() and 0 <= int(index) < len(self.server.samples):
                file = self.server.samples[int(index)]
        if not file or not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5232)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--samples', type=Path, required=True)
    args = parser.parse_args()
    photos = sorted(args.samples.glob('*.jpg'))[:5]
    if len(photos) < 5:
        parser.error('请指定包含至少 5 张 JPG 测试素材的目录。')
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.samples = photos
    print(f'Prototype: http://{args.host}:{args.port}/', flush=True)
    server.serve_forever()
