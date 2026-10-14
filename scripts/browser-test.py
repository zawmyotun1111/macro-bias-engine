"""Run the dashboard in local Chromium using Playwright; no provider requests."""
import functools
import http.server
import pathlib
import shutil
import threading
import subprocess
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[1]
browser = next((shutil.which(name) for name in ['chromium', 'chromium-browser', 'google-chrome'] if shutil.which(name)), None)
if not browser:
    raise SystemExit('Chromium or Google Chrome is required for browser integration tests')

bootstrap = subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./macro-data.js').emptySnapshot()))"], cwd=root)

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path == '/data/economic-data.json':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(bootstrap)
        else:
            super().do_GET()
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        app = p.chromium.launch(executable_path=browser, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = app.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/tests/browser.html')
        page.wait_for_function("/^(PASS|FAIL) /.test(document.getElementById('result').textContent)", timeout=20000)
        result = page.locator('#result').inner_text()
        app.close()
        if not result.startswith('PASS ') or errors:
            raise SystemExit('Browser integration failed: ' + result + '\n' + '\n'.join(errors))
        print(result)
finally:
    server.shutdown()
