"""T17 (S8, S13): bounded real-Chromium proof of the demo notice.

Two sequential scenarios, each against its own disposable backend and its own
loopback API/Vite pair:

* ``marked``   -- installed with ``python -m itsm.demo init`` (durable marker).
* ``ordinary`` -- migrations plus ``bootstrap-superadmin`` (no marker).

For every scenario the script proves, from the painted page and not from a
regular expression:

* the notice is absent on the unauthenticated login surface;
* ``GET /api/v1/auth/me`` answers a real boolean ``demoMode``;
* the notice is present (marked) or absent (ordinary) at 1440 and 390 widths in
  light and dark themes, with a visible non-empty box inside the viewport, no
  horizontal overflow and WCAG contrast for the painted colors;
* the session leaves no demo flag in localStorage/sessionStorage;
* a real logout returns to the login surface, unmounts the shell, hides the
  notice and makes ``/auth/me`` answer 401.

The parent process environment is scrubbed of every inherited ``ITSM_*``
variable and provider credential before any child process starts, so nothing
leaks in from a local ``.env``/shell configuration. All database, queue, blob
and extension state lives inside ``frontend/.verification/`` (git-ignored).

Required: Python Playwright + Chromium, ``backend/.venv`` for the backend CLI,
and the already installed frontend ``node_modules``. No Docker, no Prometheus,
no agent/provider calls, no external targets.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

FRONTEND = Path(__file__).resolve().parent.parent
BACKEND = FRONTEND.parent / "backend"
PYTHON = BACKEND / ".venv" / "bin" / "python"
SCRATCH = FRONTEND / ".verification" / ("demo-indicator-" + uuid.uuid4().hex[:12])

DEMO_PASSWORD = "Demo-Notice-Pass-7x3"
DEMO_USERNAME = "demo.owner"
ORDINARY_USERNAME = "ordinary.admin"

SHELL_NOTICE = '.app-shell .demo-notice[data-od-id="demo-mode-notice"]'
ANY_NOTICE = ".demo-notice"
NOTICE_TEXT = "Modo demostración"
VIEWPORTS = ((1440, 1000), (390, 844))
THEMES = ("light", "dark")

PROVIDER_SUFFIXES = ("_API_KEY", "_APIKEY", "_API_TOKEN", "_AUTH_TOKEN")
PROVIDER_NAMES = {
    "ANTHROPIC_API_KEY", "AZURE_OPENAI_KEY", "COHERE_API_KEY", "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "HF_TOKEN",
    "HUGGINGFACE_TOKEN", "MISTRAL_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
    "PERPLEXITY_API_KEY", "TOGETHER_API_KEY", "VOYAGE_API_KEY", "XAI_API_KEY",
}

# Painted colors of the notice must stay readable in both themes.
MIN_CONTRAST = 4.5

# Reads the painted colors/styles of the notice and its effective background.
# Returns numbers, so the assertion is against the rendered page, not the source.
CONTRAST_SCRIPT = """(selector) => {
  const node = document.querySelector(selector);
  if (!node) return { error: 'missing notice' };
  const parse = (value) => {
    const match = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (rgb) => 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  const style = getComputedStyle(node);
  const foreground = parse(style.color);
  let background = parse(style.backgroundColor);
  let cursor = node;
  while ((!background || background.a === 0) && cursor.parentElement) {
    cursor = cursor.parentElement;
    background = parse(getComputedStyle(cursor).backgroundColor);
  }
  if (!foreground || !background) return { error: 'unresolved colors', color: style.color };
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return {
    ratio: (high + 0.05) / (low + 0.05),
    color: style.color,
    background: 'rgb(' + background.r + ', ' + background.g + ', ' + background.b + ')',
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    visibility: style.visibility,
    display: style.display,
    opacity: style.opacity,
  };
}"""


def scrubbed_environment() -> tuple[dict[str, str], list[str]]:
    """Drop every inherited ITSM_* variable and provider credential."""
    kept: dict[str, str] = {}
    dropped: list[str] = []
    for key, value in os.environ.items():
        upper = key.upper()
        if upper.startswith("ITSM_") or upper in PROVIDER_NAMES or upper.endswith(PROVIDER_SUFFIXES):
            dropped.append(key)
            continue
        kept[key] = value
    return kept, dropped


CLEAN_ENV, DROPPED_KEYS = scrubbed_environment()

USED_PORTS: list[int] = []


def free_port() -> int:
    """Allocate a loopback port this script has not used before."""
    for _ in range(50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            port = int(probe.getsockname()[1])
        if port not in USED_PORTS:
            USED_PORTS.append(port)
            return port
    raise RuntimeError("could not allocate a fresh loopback port")


def wait_for(url: str, timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    last: object = "no attempt"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                response.read(64)
            return
        except (urllib.error.URLError, OSError) as exc:
            last = exc
            time.sleep(0.4)
    raise RuntimeError(f"timed out waiting for {url}: {last}")


def open_ports(ports: list[int]) -> list[int]:
    """Ports from this script that still accept connections after cleanup."""
    still_open: list[int] = []
    for port in ports:
        deadline = time.monotonic() + 10
        while True:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.5)
                connected = probe.connect_ex(("127.0.0.1", port)) == 0
            if not connected:
                break
            if time.monotonic() > deadline:
                still_open.append(port)
                break
            time.sleep(0.2)
    return still_open


class Owned:
    """Processes started by this script, stopped in reverse order."""

    def __init__(self) -> None:
        self.processes: list[tuple[str, subprocess.Popen, Path, object]] = []

    def spawn(self, name: str, command: list[str], cwd: Path, env: dict[str, str]) -> None:
        log = SCRATCH / "logs" / f"{name}.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        handle = log.open("w", encoding="utf-8")
        process = subprocess.Popen(
            command, cwd=str(cwd), env=env, stdout=handle, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.processes.append((name, process, log, handle))
        print(f"START {name} pid={process.pid} log={log}")

    def stop(self) -> None:
        for name, process, log, handle in reversed(self.processes):
            if process.poll() is None:
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    process.terminate()
                try:
                    code = process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                    except (ProcessLookupError, PermissionError):
                        process.kill()
                    code = process.wait(timeout=10)
            else:
                code = process.returncode
            try:
                handle.close()
            except OSError:
                pass
            print(f"STOP {name} exit={code} log={log}")

    def log_tails(self, lines: int = 15) -> str:
        chunks: list[str] = []
        for name, _process, log, _handle in self.processes:
            try:
                text = log.read_text(encoding="utf-8", errors="replace").strip().splitlines()
            except OSError:
                continue
            if text:
                chunks.append(f"--- {name} log tail ---\n" + "\n".join(text[-lines:]))
        return "\n".join(chunks)


def run_command(command: list[str], env: dict[str, str], label: str, timeout: float = 300.0) -> str:
    result = subprocess.run(
        command, cwd=str(BACKEND), env=env, capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{label} failed (exit {result.returncode}): {' '.join(command)}\n"
            f"stdout: {result.stdout[-2000:]}\nstderr: {result.stderr[-2000:]}"
        )
    return result.stdout


def isolated_state(label: str) -> dict[str, str]:
    """Disposable queue/blob/extension paths inside the ignored scratch root."""
    root = SCRATCH / f"{label}-state"
    paths = {name: root / name for name in ("queue", "attachments", "extensions")}
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    env = dict(CLEAN_ENV)
    env.update({
        "ITSM_ENVIRONMENT": "development",
        "ITSM_TASK_STORAGE": "sqlite",
        "ITSM_TASK_SQLITE_PATH": str(paths["queue"] / "huey.db"),
        "ITSM_ATTACHMENT_STORAGE_PATH": str(paths["attachments"]),
        "ITSM_EXTENSION_WORKSPACE_PATH": str(paths["extensions"]),
    })
    return env


def start_servers(owner: Owned, label: str, api_env: dict[str, str]) -> tuple[str, list[int]]:
    """Start this scenario's own API and Vite on fresh loopback ports."""
    api_port = free_port()
    web_port = free_port()
    api_base = f"http://127.0.0.1:{api_port}"
    base = f"http://127.0.0.1:{web_port}"

    env = dict(api_env)
    env.update({
        "ITSM_AUTH_ORIGIN": base,
        "ITSM_AUTH_COOKIE_SECURE": "false",
        "ITSM_REPORT_BASE_URL": base,
        "ITSM_MONITORING_PUBLIC_URL": base,
    })
    owner.spawn(
        f"{label}-api",
        [str(PYTHON), "-m", "uvicorn", "itsm.main:app", "--host", "127.0.0.1",
         "--port", str(api_port), "--log-level", "warning"],
        cwd=BACKEND,
        env=env,
    )
    wait_for(f"{api_base}/api/v1/health/live")

    web_env = dict(CLEAN_ENV)
    web_env["ITSM_DEV_API_URL"] = api_base
    owner.spawn(
        f"{label}-web",
        ["npm", "run", "dev", "--", "--port", str(web_port), "--strictPort"],
        cwd=FRONTEND,
        env=web_env,
    )
    wait_for(f"{base}/index.html")
    print(f"READY {label}: api={api_base} web={base} auth_origin={base} cookie_secure=false")
    return base, [api_port, web_port]


def set_theme(page, theme: str) -> None:
    """Reach the theme through the real toggle, not by rewriting the DOM."""
    if page.evaluate("document.documentElement.dataset.theme") != theme:
        page.locator(".app-shell .theme-toggle").first.click()
        page.wait_for_function(
            "(target) => document.documentElement.dataset.theme === target", arg=theme
        )
    assert page.evaluate("document.documentElement.dataset.theme") == theme, theme


def login(page, base: str, username: str, password: str) -> None:
    page.goto(f"{base}/#/login", wait_until="networkidle")
    assert page.evaluate("location.origin") == base, page.evaluate("location.origin")
    expect(page.get_by_role("heading", name="Iniciar sesión", exact=True)).to_be_visible()
    expect(page.locator(ANY_NOTICE)).to_have_count(0)
    print(f"UNAUTH login surface at {base}: {ANY_NOTICE} count=0")
    page.get_by_label("Usuario", exact=True).fill(username)
    page.get_by_label("Contraseña", exact=True).fill(password)
    page.get_by_role("button", name="Entrar", exact=True).click()
    expect(page.locator(".app-shell")).to_be_visible()


def session_demo_mode(page, expected: bool) -> None:
    payload = page.evaluate(
        "async () => { const response = await fetch('/api/v1/auth/me', {credentials: 'same-origin'});"
        " return {status: response.status, body: await response.json()}; }"
    )
    assert payload["status"] == 200, payload
    value = payload["body"].get("demoMode")
    assert isinstance(value, bool), payload
    assert value is expected, payload
    print(f"AUTH/ME demoMode={value!r} (boolean) expected={expected!r}")


def logout(page) -> None:
    page.locator(".user-trigger").click()
    item = page.get_by_role("menuitem", name="Cerrar sesión")
    expect(item).to_be_visible()
    item.click()
    expect(page.get_by_role("heading", name="Iniciar sesión", exact=True)).to_be_visible()
    expect(page.locator(".app-shell")).to_have_count(0)
    expect(page.locator(ANY_NOTICE)).to_have_count(0)
    status = page.evaluate(
        "async () => (await fetch('/api/v1/auth/me', {credentials: 'same-origin'})).status"
    )
    assert status == 401, status
    print(f"LOGOUT: login surface visible, .app-shell count=0, {ANY_NOTICE} count=0, /auth/me={status}")


def assert_no_demo_storage(page) -> None:
    stored = page.evaluate(
        "() => { const dump = (store) => Object.keys(store).map((key) => key + '=' + store.getItem(key));"
        " return {local: dump(localStorage), session: dump(sessionStorage)}; }"
    )
    blob = " ".join(stored["local"] + stored["session"]).lower()
    assert "demomode" not in blob and "demo_mode" not in blob, stored
    print(f"STORAGE: {len(stored['local'])} localStorage/{len(stored['session'])} sessionStorage keys, no demo flag")


def check_matrix(page, label: str, notice_expected: bool, shots: Path) -> list[str]:
    rows: list[str] = []
    for width, height in VIEWPORTS:
        page.set_viewport_size({"width": width, "height": height})
        for theme in THEMES:
            set_theme(page, theme)
            overflow = page.evaluate(
                "document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            assert overflow <= 1, f"{label} {width}x{height} {theme}: horizontal overflow {overflow}px"
            if notice_expected:
                notice = page.locator(SHELL_NOTICE)
                expect(notice).to_have_count(1)
                expect(notice).to_be_visible()
                text = notice.inner_text().strip()
                assert text == NOTICE_TEXT, text
                box = notice.bounding_box()
                assert box and box["width"] > 0 and box["height"] > 0, box
                assert box["x"] >= -0.5 and box["y"] >= -0.5, box
                assert box["x"] + box["width"] <= width + 0.5, (box, width)
                assert box["y"] + box["height"] <= height + 0.5, (box, height)
                metrics = page.evaluate(CONTRAST_SCRIPT, SHELL_NOTICE)
                assert "error" not in metrics, metrics
                assert metrics["visibility"] == "visible", metrics
                assert float(metrics["opacity"]) > 0.9, metrics
                assert metrics["ratio"] >= MIN_CONTRAST, metrics
                detail = (
                    f"present text={text!r} "
                    f"box=({box['x']:.0f},{box['y']:.0f},{box['width']:.0f},{box['height']:.0f}) "
                    f"contrast={metrics['ratio']:.2f} color={metrics['color']} bg={metrics['background']} "
                    f"font={metrics['fontSize']}/{metrics['fontWeight']}"
                )
            else:
                expect(page.locator(ANY_NOTICE)).to_have_count(0)
                detail = "absent"
            shot = shots / f"{label}-{width}x{height}-{theme}.png"
            page.screenshot(path=str(shot), full_page=True)
            rows.append(
                f"MATRIX {label} {width}x{height} {theme} notice={detail} overflow={overflow}px screenshot={shot}"
            )
            print(rows[-1])
    return rows


def drive(browser, base: str, label: str, username: str, password: str,
          notice_expected: bool, shots: Path) -> list[str]:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    try:
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        login(page, base, username, password)
        session_demo_mode(page, notice_expected)
        rows = check_matrix(page, label, notice_expected, shots)
        assert_no_demo_storage(page)
        logout(page)
        assert not errors, f"{label} page errors: {errors}"
        print(f"PAGEERRORS {label}: 0")
        return rows
    finally:
        context.close()


def scenario_marked(shots: Path) -> list[str]:
    owner, ports = Owned(), []
    try:
        demo_dir = SCRATCH / "marked"
        env = dict(CLEAN_ENV)
        env["ITSM_BOOTSTRAP_PASSWORD"] = DEMO_PASSWORD
        stdout = run_command(
            [str(PYTHON), "-m", "itsm.demo", "init", "--directory", str(demo_dir),
             "--username", DEMO_USERNAME],
            env, "itsm.demo init",
        )
        payload = json.loads(stdout.strip().splitlines()[-1])
        assert payload.get("mode") == "demo", payload
        assert payload.get("dataset") == "fictional-infrastructure-v1", payload
        assert DEMO_PASSWORD not in stdout and "password" not in payload, payload
        assert (demo_dir / "demo.db").is_file(), demo_dir
        print(
            f"SETUP marked: itsm.demo init exit=0 mode=demo dataset={payload['dataset']} "
            f"db={payload['databaseUrl']} (password not printed)"
        )

        api_env = isolated_state("marked")
        api_env["ITSM_DATABASE_URL"] = payload["databaseUrl"]
        base, ports = start_servers(owner, "marked", api_env)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                return drive(browser, base, "marked", DEMO_USERNAME, DEMO_PASSWORD, True, shots)
            finally:
                browser.close()
    except Exception:
        print("DIAGNOSTICS marked (owned process log tails):")
        print(owner.log_tails())
        raise
    finally:
        owner.stop()
        leaked = open_ports(ports)
        if leaked:
            print(f"CLEANUP marked: LEAKED ports {leaked}")
            if sys.exc_info()[0] is None:
                raise RuntimeError(f"marked ports still open after cleanup: {leaked}")
        else:
            print(f"CLEANUP marked: owned processes stopped, ports {ports} released")


def scenario_ordinary(shots: Path) -> list[str]:
    owner, ports = Owned(), []
    try:
        database_dir = SCRATCH / "ordinary"
        database_dir.mkdir(parents=True, exist_ok=True)
        database = database_dir / "ordinary.db"
        api_env = isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = DEMO_PASSWORD
        run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env, "alembic upgrade head")
        run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", ORDINARY_USERNAME, "--name", "T17 ordinary install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP ordinary: migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        base, ports = start_servers(owner, "ordinary", api_env)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                return drive(browser, base, "ordinary", ORDINARY_USERNAME, DEMO_PASSWORD, False, shots)
            finally:
                browser.close()
    except Exception:
        print("DIAGNOSTICS ordinary (owned process log tails):")
        print(owner.log_tails())
        raise
    finally:
        owner.stop()
        leaked = open_ports(ports)
        if leaked:
            print(f"CLEANUP ordinary: LEAKED ports {leaked}")
            if sys.exc_info()[0] is None:
                raise RuntimeError(f"ordinary ports still open after cleanup: {leaked}")
        else:
            print(f"CLEANUP ordinary: owned processes stopped, ports {ports} released")


def main() -> int:
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    print(f"ENV scrubbed {len(DROPPED_KEYS)} inherited keys: {', '.join(sorted(DROPPED_KEYS)) or 'none'}")
    assert not any(key.upper().startswith("ITSM_") for key in CLEAN_ENV)
    assert not any(key.upper().endswith(PROVIDER_SUFFIXES) for key in CLEAN_ENV)
    for path in (PYTHON, BACKEND):
        assert path.exists(), path

    rows: list[str] = []
    failed = False
    try:
        rows += scenario_marked(shots)
        rows += scenario_ordinary(shots)
    except Exception as exc:  # report the exact failing step, then stop
        failed = True
        print(f"FAILED: {type(exc).__name__}: {exc}")

    print("\n=== RESULT ===")
    for row in rows:
        print(row)
    print(f"scenarios completed: {len(rows)} matrix rows across marked/ordinary")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    print("bounded scope: no full npm test/build, no Docker, no Prometheus, no agent/provider calls")
    if failed:
        return 1
    print("PASS T17 demo indicator: marked present / ordinary absent on 1440+390 light+dark, real logout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
