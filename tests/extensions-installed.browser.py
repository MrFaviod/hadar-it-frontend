"""T30 (S15, S17): installed-extension composition through the real application.

One bounded run of this checkout against its own disposable backend:

* the canonical SDK generator renders a real package, augmented with four
  composition components (page/nav/widget/config) that the package registers;
* the exact bytes are validated by the fixed offline container image
  ``itsm-extension-validator:ui-composition-verification`` (``--pull=never``,
  ``--network=none``) and that real report is recorded through the host's
  internal ``record_validation_report`` (no fixture report, no fake digest);
* a bootstrap superadmin (test-owner fixture, not a product grant) uploads and
  approves the candidate through the authenticated public HTTP contract with
  Origin + CSRF, then disables it the same way;
* Chromium proves the full shell composition and its removal from painted DOM:
  ``page.inventory`` replacement, ``config.general`` addition, ``nav.reports``
  replacement, ``widget.alerts`` replacement, protected configuration sections
  (security/extensions/system) still reachable, and after disabling the core
  page/nav/widget return with no Vue page errors.

Scope limits: no production data, no provider/agent call, no full npm suite, no
Prometheus, no product source changes. All state lives under
``frontend/.verification/`` (git-ignored).
"""

from __future__ import annotations

import base64
import json
import os
import re
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
PROJECT = next(parent for parent in FRONTEND.parents if (parent / "backend" / "pyproject.toml").is_file())
BACKEND = PROJECT / "backend"
PYTHON = BACKEND / ".venv" / "bin" / "python"
SCRATCH = FRONTEND / ".verification" / ("extensions-installed-" + uuid.uuid4().hex[:12])

VALIDATOR_IMAGE = "itsm-extension-validator:ui-composition-verification"
EXTENSION_ID = "ui-composition-demo"
EXTENSION_NAME = "Composición de interfaz"
PERMISSION = "ext_ui_composition_demo.records_read"
USERNAME = "composition.owner"
PASSWORD = "Composition-Owner-Pass-9x4"
DEADLINE_SECONDS = 240.0

# Painted markers. Core markers are shipped template ids; extension markers come
# from the package-registered components, so they can only appear when the
# server-served script actually ran.
CORE_INVENTORY = "#inventory-title"
EXT_INVENTORY = ".sdk-composition-inventory"
CORE_CONFIG_GENERAL = "#config-general-title"
EXT_CONFIG = ".sdk-composition-config"
CORE_NAV_REPORTS = '[data-od-id="nav-reports"]'
EXT_NAV_REPORTS = "a.sdk-composition-nav"
CORE_WIDGET_ALERTS = '[data-od-id="dashboard-widget-alerts"]'
EXT_WIDGET_ALERTS = ".sdk-composition-widget"
PROTECTED_SECTIONS = (
    ("/configuracion/seguridad", "#access-security-title", "Usuarios y permisos"),
    ("/configuracion/extensiones", "#extension-review-title", "Revisión e instalación"),
    ("/configuracion/sistema", "#system-operations-title", "Sistema"),
)

PROVIDER_SUFFIXES = ("_API_KEY", "_APIKEY", "_API_TOKEN", "_AUTH_TOKEN")
PROVIDER_NAMES = {
    "ANTHROPIC_API_KEY", "AZURE_OPENAI_KEY", "COHERE_API_KEY", "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "HF_TOKEN",
    "HUGGINGFACE_TOKEN", "MISTRAL_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY",
    "PERPLEXITY_API_KEY", "TOGETHER_API_KEY", "VOYAGE_API_KEY", "XAI_API_KEY",
}

COMPONENTS = {
    "CompositionInventory": {
        "className": "CompositionInventory",
        "marker": "sdk-composition-inventory",
        "template": (
            '<section class="sdk-composition-inventory">'
            '<h2>Inventario compuesto por la extensión</h2>'
            '<p>Esta página la aporta el paquete instalado.</p>'
            '</section>'
        ),
    },
    "CompositionConfigNote": {
        "className": "CompositionConfigNote",
        "marker": "sdk-composition-config",
        "template": (
            '<div class="sdk-composition-config">'
            '<p>Ajuste añadido por la extensión.</p>'
            '</div>'
        ),
    },
    "CompositionReportsNav": {
        "className": "CompositionReportsNav",
        "marker": "sdk-composition-nav",
        "template": (
            '<a class="nav-link sdk-composition-nav" href="#/reportes">'
            '<span>Reportes de la extensión</span></a>'
        ),
    },
    "CompositionAlertsWidget": {
        "className": "CompositionAlertsWidget",
        "marker": "sdk-composition-widget",
        "template": (
            '<section class="noc-widget sdk-composition-widget">'
            '<h2>Alertas de la extensión</h2>'
            '<p>Widget aportado por el paquete instalado.</p>'
            '</section>'
        ),
    },
}

CONTRIBUTIONS = [
    {
        "id": "inventory-composition",
        "label": "Inventario compuesto",
        "target": "page.inventory",
        "mode": "replace",
        "permission": PERMISSION,
        "component": "CompositionInventory",
        "order": 10,
    },
    {
        "id": "general-config-note",
        "label": "Nota de configuración",
        "target": "config.general",
        "mode": "add",
        "permission": PERMISSION,
        "component": "CompositionConfigNote",
        "order": 20,
    },
    {
        "id": "reports-navigation",
        "label": "Reportes compuestos",
        "target": "nav.reports",
        "mode": "replace",
        "permission": PERMISSION,
        "component": "CompositionReportsNav",
        "order": 30,
    },
    {
        "id": "alerts-widget",
        "label": "Alertas compuestas",
        "target": "widget.alerts",
        "mode": "replace",
        "permission": PERMISSION,
        "component": "CompositionAlertsWidget",
        "order": 40,
    },
]

# Same-origin authenticated mutations. The CSRF token is read back from the
# real session envelope; the browser supplies the Origin header itself.
CSRF_PREFIX = (
    "async (payload) => { const me = await fetch('/api/v1/auth/me', {credentials: 'same-origin'});"
    " const envelope = await me.json();"
)

UPLOAD_SCRIPT = CSRF_PREFIX + """
  const binary = atob(payload.zip);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const response = await fetch('/api/v1/extensions/candidates', {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/zip', 'X-CSRF-Token': envelope.csrfToken,
              'X-Package-Digest': payload.digest},
    body: bytes
  });
  return {status: response.status, body: await response.json()};
}"""

APPROVE_SCRIPT = CSRF_PREFIX + """
  const response = await fetch('/api/v1/extensions/candidates/' + payload.candidateId + '/approve', {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': envelope.csrfToken},
    body: JSON.stringify({digest: payload.digest, expectedVersion: payload.expectedVersion})
  });
  return {status: response.status, body: await response.json()};
}"""

DISABLE_SCRIPT = CSRF_PREFIX + """
  const response = await fetch('/api/v1/extensions/' + payload.extensionId + '/enabled', {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': envelope.csrfToken},
    body: JSON.stringify({enabled: false, expectedVersion: payload.expectedVersion})
  });
  return {status: response.status, body: await response.json()};
}"""

DISCOVERY_SCRIPT = """
async () => {
  const me = await fetch('/api/v1/auth/me', {credentials: 'same-origin'});
  const envelope = await me.json();
  const response = await fetch('/api/v1/extensions', {credentials: 'same-origin'});
  return {me: me.status, envelope: envelope, status: response.status, body: await response.json()};
}"""

SCRIPT_SCRIPT = """
async (payload) => {
  const response = await fetch('/api/v1/extensions/' + payload.extensionId
    + '/frontend.js?digest=' + payload.digest, {credentials: 'same-origin'});
  const text = await response.text();
  return {status: response.status, length: text.length, hasComponent: text.indexOf(payload.marker) !== -1};
}"""

STARTED = time.monotonic()


def budget() -> float:
    remaining = DEADLINE_SECONDS - (time.monotonic() - STARTED)
    if remaining <= 5:
        raise RuntimeError(f"bounded run exceeded {DEADLINE_SECONDS:.0f}s")
    return remaining


# The scratch helper runs inside the backend virtualenv so the canonical SDK
# generator, the fixed validator wrapper and the internal report ingestion are
# the shipped implementations, not re-implementations.
HELPER_SOURCE = '''"""Scratch helper: canonical build plus real validator report ingestion."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def build(spec: dict, outdir: Path) -> dict:
    from itsm.extensions.sdk.generator import generate_package
    from itsm.extensions.sdk.package import build_package

    extension_id = spec["extensionId"]
    generated = generate_package(
        extension_id=extension_id,
        name=spec["name"],
        description=spec["description"],
    )
    manifest = json.loads(json.dumps(generated.manifest))
    declared = [item["code"] for item in manifest["permissions"]]
    permission = spec["permission"]
    assert permission in declared, (permission, declared)
    manifest["frontend"]["contributions"] = spec["contributions"]

    files = dict(generated.files)
    files["extension.json"] = json.dumps(manifest, ensure_ascii=False)

    script = files["frontend.js"]
    pattern = re.compile(
        r'host\\.register\\("' + re.escape(extension_id) + r'", \\{ components: \\{([^}]*)\\} \\}\\);'
    )
    match = pattern.search(script)
    assert match, "generated frontend.js registration not found"
    existing = [name.strip() for name in match.group(1).split(",") if name.strip()]
    added = [component["className"] for component in spec["components"]]
    definitions = "\\n".join(
        "  const %s = { name: %s, template: %s };"
        % (item["className"], json.dumps(item["className"]), json.dumps(item["template"]))
        for item in spec["components"]
    )
    names = ", ".join(existing + added)
    replacement = (
        definitions
        + '\\n\\n  host.register("%s", { components: { %s } });' % (extension_id, names)
    )
    files["frontend.js"] = script[: match.start()] + replacement + script[match.end():]

    built = build_package(files, known_core_permissions=())
    outdir.mkdir(parents=True, exist_ok=True)
    target = outdir / "package.zip"
    target.write_bytes(built.data)
    result = {
        "digest": built.digest,
        "bytes": len(built.data),
        "extensionId": extension_id,
        "name": spec["name"],
        "version": manifest["version"],
        "permission": permission,
        "declaredPermissions": declared,
        "components": [component["className"] for component in spec["components"]],
        "contributions": spec["contributions"],
        "package": str(target),
    }
    (outdir / "package-meta.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def record(args) -> dict:
    from itsm.config import get_settings
    from itsm.database import create_engine_from_settings, create_session_factory
    from itsm.extensions.host import ExtensionHostService
    from itsm.extensions.validator import ContainerValidator
    from itsm.identity.permissions import PERMISSION_CODES

    settings = get_settings()
    engine = create_engine_from_settings(settings)
    factory = create_session_factory(engine)
    data = Path(args.package).read_bytes()
    validator = ContainerValidator(
        core_permissions=PERMISSION_CODES,
        image=args.image,
        timeout=settings.extension_validation_timeout_seconds,
    )
    result = {"available": False, "image": args.image}
    result["available"] = validator.available()
    if not result["available"]:
        return result
    report = validator.validate(data, digest=args.digest)
    result["report"] = {
        "status": report.get("status"),
        "digest": report.get("digest"),
        "sdkVersion": report.get("sdkVersion"),
        "errors": report.get("errors"),
        "checks": [
            {"name": check.get("name"), "status": check.get("status")}
            for check in report.get("checks", [])
        ],
        "container": report.get("container"),
    }
    if report.get("status") != "passed" or report.get("digest") != args.digest:
        result["recorded"] = False
        return result
    host = ExtensionHostService(settings, factory)
    detail = host.record_validation_report(
        args.candidate_id, report, expected_version=args.revision
    )
    result["recorded"] = True
    result["candidate"] = {
        "id": detail.get("id"),
        "revision": detail.get("revision"),
        "digest": detail.get("digest"),
        "state": detail.get("state"),
        "validationStatus": (detail.get("validation") or {}).get("status")
        if isinstance(detail.get("validation"), dict)
        else None,
    }
    return result


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    build_cmd = sub.add_parser("build")
    build_cmd.add_argument("--spec", required=True)
    build_cmd.add_argument("--out", required=True)
    record_cmd = sub.add_parser("record")
    record_cmd.add_argument("--package", required=True)
    record_cmd.add_argument("--digest", required=True)
    record_cmd.add_argument("--candidate-id", required=True)
    record_cmd.add_argument("--revision", required=True, type=int)
    record_cmd.add_argument("--image", required=True)
    args = parser.parse_args(argv)

    if args.mode == "build":
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        payload = build(spec, Path(args.out))
        print(json.dumps(payload))
        return 0

    payload = record(args)
    print(json.dumps(payload))
    if not payload.get("available"):
        return 4
    if payload.get("report", {}).get("status") != "passed":
        return 3
    if not payload.get("recorded"):
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
'''


def scrubbed_environment() -> tuple[dict[str, str], list[str]]:
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
    for _ in range(50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            port = int(probe.getsockname()[1])
        if port not in USED_PORTS:
            USED_PORTS.append(port)
            return port
    raise RuntimeError("could not allocate a fresh loopback port")


def wait_for(url: str, timeout: float = 120.0) -> None:
    deadline = time.monotonic() + min(timeout, budget())
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

    def log_tails(self, lines: int = 20) -> str:
        chunks: list[str] = []
        for name, _process, log, _handle in self.processes:
            try:
                text = log.read_text(encoding="utf-8", errors="replace").strip().splitlines()
            except OSError:
                continue
            if text:
                chunks.append(f"--- {name} log tail ---\n" + "\n".join(text[-lines:]))
        return "\n".join(chunks)


def run_command(
    command: list[str],
    env: dict[str, str],
    label: str,
    *,
    cwd: Path = BACKEND,
    timeout: float = 180.0,
) -> str:
    result = subprocess.run(
        command, cwd=str(cwd), env=env, capture_output=True, text=True,
        timeout=min(timeout, budget()),
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
        "ITSM_EXTENSION_VALIDATOR_IMAGE": VALIDATOR_IMAGE,
        "PYTHONPATH": str(BACKEND),
        "PYTHONUNBUFFERED": "1",
    })
    return env


def goto(page, base: str, route: str) -> None:
    page.goto(f"{base}/#{route}", wait_until="domcontentloaded")
    expect(page.locator(".app-shell")).to_be_visible()


def login(page, base: str) -> None:
    page.goto(f"{base}/#/login", wait_until="networkidle")
    expect(page.get_by_role("heading", name="Iniciar sesión", exact=True)).to_be_visible()
    page.get_by_label("Usuario", exact=True).fill(USERNAME)
    page.get_by_label("Contraseña", exact=True).fill(PASSWORD)
    page.get_by_role("button", name="Entrar", exact=True).click()
    expect(page.locator(".app-shell")).to_be_visible()
    print(f"LOGIN {USERNAME} on {base}: shell visible")


def assert_composed(page, base: str) -> list[str]:
    """Painted proof that the installed package composes four surfaces."""
    rows: list[str] = []
    goto(page, base, "/inventario")
    expect(page.locator(EXT_INVENTORY)).to_be_visible()
    expect(page.locator(EXT_INVENTORY)).to_contain_text("Inventario compuesto")
    expect(page.locator(CORE_INVENTORY)).to_have_count(0)
    rows.append("page.inventory=replaced(core#inventory-title absent)")

    goto(page, base, "/configuracion/general")
    expect(page.locator(CORE_CONFIG_GENERAL)).to_be_visible()
    expect(page.locator(EXT_CONFIG)).to_be_visible()
    expect(page.locator(EXT_CONFIG)).to_contain_text("Ajuste añadido")
    rows.append("config.general=added(core#config-general-title present)")

    goto(page, base, "/panel")
    expect(page.locator(EXT_WIDGET_ALERTS)).to_be_visible()
    expect(page.locator(CORE_WIDGET_ALERTS)).to_have_count(0)
    expect(page.locator(EXT_NAV_REPORTS)).to_be_visible()
    expect(page.locator(CORE_NAV_REPORTS)).to_have_count(0)
    rows.append("widget.alerts=replaced(core dashboard-widget-alerts absent)")
    rows.append("nav.reports=replaced(core nav-reports absent)")

    for route, selector, text in PROTECTED_SECTIONS:
        goto(page, base, route)
        expect(page.locator(selector)).to_be_visible()
        expect(page.locator(selector)).to_contain_text(text)
        expect(page.locator(".ui-composition-additions .sdk-composition-config")).to_have_count(0)
        rows.append(f"{route}=protected core({selector}: {text})")
    return rows


def assert_restored(page, base: str) -> list[str]:
    """Painted proof that disabling the extension returns every core surface."""
    rows: list[str] = []
    goto(page, base, "/inventario")
    expect(page.locator(CORE_INVENTORY)).to_be_visible()
    expect(page.locator(CORE_INVENTORY)).to_contain_text("Inventario de activos")
    expect(page.locator(EXT_INVENTORY)).to_have_count(0)
    rows.append("page.inventory=core(#inventory-title present, extension absent)")

    goto(page, base, "/configuracion/general")
    expect(page.locator(CORE_CONFIG_GENERAL)).to_be_visible()
    expect(page.locator(EXT_CONFIG)).to_have_count(0)
    rows.append("config.general=core(no extension addition)")

    goto(page, base, "/panel")
    expect(page.locator(CORE_WIDGET_ALERTS)).to_be_visible()
    expect(page.locator(EXT_WIDGET_ALERTS)).to_have_count(0)
    expect(page.locator(CORE_NAV_REPORTS)).to_be_visible()
    expect(page.locator(EXT_NAV_REPORTS)).to_have_count(0)
    rows.append("widget.alerts=core(dashboard-widget-alerts present)")
    rows.append("nav.reports=core(nav-reports present)")

    for route, selector, text in PROTECTED_SECTIONS:
        goto(page, base, route)
        expect(page.locator(selector)).to_be_visible()
        expect(page.locator(selector)).to_contain_text(text)
        rows.append(f"{route}=protected core({selector})")
    return rows


def run_scenario(owner: Owned, shots: Path) -> list[str]:
    database_dir = SCRATCH / "database"
    database_dir.mkdir(parents=True, exist_ok=True)
    database = database_dir / "app.db"
    api_env = isolated_state("installed")
    api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)

    cli_env = dict(api_env)
    cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
    run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                "alembic upgrade head", timeout=180)
    run_command(
        [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
         "--username", USERNAME, "--name", "T30 composition owner"],
        cli_env, "bootstrap-superadmin", timeout=120,
    )
    print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

    helper = SCRATCH / "sdk_helper.py"
    helper.write_text(HELPER_SOURCE, encoding="utf-8")
    spec = SCRATCH / "package-spec.json"
    spec.write_text(json.dumps({
        "extensionId": EXTENSION_ID,
        "name": EXTENSION_NAME,
        "description": "Composición de interfaz verificada en un navegador real.",
        "permission": PERMISSION,
        "contributions": CONTRIBUTIONS,
        "components": list(COMPONENTS.values()),
    }, ensure_ascii=False), encoding="utf-8")

    built = json.loads(run_command(
        [str(PYTHON), str(helper), "build", "--spec", str(spec), "--out", str(SCRATCH / "package")],
        api_env, "canonical build_package", cwd=SCRATCH, timeout=90,
    ).strip().splitlines()[-1])
    digest = built["digest"]
    package_path = Path(built["package"])
    assert re.fullmatch(r"[0-9a-f]{64}", digest), digest
    assert package_path.is_file() and package_path.stat().st_size > 0, package_path
    assert built["permission"] == PERMISSION and len(built["contributions"]) == 4, built
    assert built["version"] == "1.0.0", built
    print(
        f"PACKAGE canonical generate+build exit=0 digest={digest} bytes={built['bytes']} "
        f"components={','.join(built['components'])} contributions={len(built['contributions'])}"
    )

    api_port = free_port()
    web_port = free_port()
    api_base = f"http://127.0.0.1:{api_port}"
    base = f"http://127.0.0.1:{web_port}"
    api_env.update({
        "ITSM_AUTH_ORIGIN": base,
        "ITSM_AUTH_COOKIE_SECURE": "false",
        "ITSM_REPORT_BASE_URL": base,
        "ITSM_MONITORING_PUBLIC_URL": base,
    })
    owner.spawn(
        "installed-api",
        [str(PYTHON), "-m", "uvicorn", "itsm.main:app", "--host", "127.0.0.1",
         "--port", str(api_port), "--log-level", "warning"],
        BACKEND, api_env,
    )
    wait_for(f"{api_base}/api/v1/health/live")

    web_env = dict(CLEAN_ENV)
    web_env["ITSM_DEV_API_URL"] = api_base
    owner.spawn(
        "installed-web",
        ["npm", "run", "dev", "--", "--port", str(web_port), "--strictPort"],
        FRONTEND, web_env,
    )
    wait_for(f"{base}/index.html")
    print(f"READY api={api_base} web={base} auth_origin={base} cookie_secure=false image={VALIDATOR_IMAGE}")

    rows: list[str] = []
    errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                page = context.new_page()
                page.set_default_timeout(20000)
                page.on("pageerror", lambda error: errors.append(str(error)))

                login(page, base)

                # Baseline: no extension installed yet.
                goto(page, base, "/inventario")
                expect(page.locator(CORE_INVENTORY)).to_be_visible()
                expect(page.locator(EXT_INVENTORY)).to_have_count(0)
                print("BASELINE pre-install: core inventory present, no extension marker")

                zip_b64 = base64.b64encode(package_path.read_bytes()).decode("ascii")
                uploaded = page.evaluate(UPLOAD_SCRIPT, {"zip": zip_b64, "digest": digest})
                assert uploaded["status"] == 201, uploaded
                candidate = uploaded["body"]
                assert candidate["digest"] == digest, candidate
                assert candidate["revision"] == 1, candidate
                print(
                    f"HTTP POST /extensions/candidates -> 201 candidate={candidate['id']} "
                    f"digest={candidate['digest']} revision={candidate['revision']}"
                )

                recorded = json.loads(run_command(
                    [str(PYTHON), str(helper), "record",
                     "--package", str(package_path), "--digest", digest,
                     "--candidate-id", candidate["id"], "--revision", str(candidate["revision"]),
                     "--image", VALIDATOR_IMAGE],
                    api_env, "container validate + record", cwd=SCRATCH, timeout=180,
                ).strip().splitlines()[-1])
                report = recorded.get("report") or {}
                assert recorded.get("available") is True, recorded
                assert report.get("status") == "passed", recorded
                assert report.get("digest") == digest, recorded
                container = report.get("container") or {}
                assert container.get("image") == VALIDATOR_IMAGE, container
                assert container.get("network") == "none", container
                assert recorded.get("recorded") is True, recorded
                checks = report.get("checks") or []
                assert checks and all(item["status"] == "passed" for item in checks), checks
                print(
                    "VALIDATOR real container report: status=passed digest="
                    f"{report['digest']} image={container['image']} network={container['network']} "
                    f"checks={len(checks)} -> record_validation_report recorded "
                    f"revision={(recorded.get('candidate') or {}).get('revision')}"
                )

                approved = page.evaluate(APPROVE_SCRIPT, {
                    "candidateId": candidate["id"], "digest": digest, "expectedVersion": None,
                })
                assert approved["status"] == 200, approved
                assert approved["body"]["digest"] == digest, approved
                print(
                    f"HTTP POST /extensions/candidates/{candidate['id']}/approve -> 200 "
                    f"digest={approved['body']['digest']} state={approved['body'].get('state')}"
                )

                discovery = page.evaluate(DISCOVERY_SCRIPT)
                assert discovery["status"] == 200, discovery
                assert discovery["me"] == 200, discovery
                permissions = (discovery["envelope"] or {}).get("permissions") or []
                assert PERMISSION in permissions, discovery["envelope"]
                items = (discovery["body"] or {}).get("items") or []
                item = next((entry for entry in items if entry.get("id") == EXTENSION_ID), None)
                assert item and item["digest"] == digest and item["enabled"] is True, items
                installed_contributions = (
                    (item.get("manifest") or {}).get("frontend") or {}
                ).get("contributions") or []
                assert len(installed_contributions) == 4, item.get("manifest")
                revision = item["revision"]
                served = page.evaluate(SCRIPT_SCRIPT, {
                    "extensionId": EXTENSION_ID, "digest": digest,
                    "marker": COMPONENTS["CompositionAlertsWidget"]["marker"],
                })
                assert served["status"] == 200 and served["hasComponent"] is True, served
                print(
                    f"DISCOVERY authenticated /extensions -> 200 item enabled digest={item['digest']} "
                    f"revision={revision} contributions={len(installed_contributions)}; "
                    f"declared permission granted; GET frontend.js -> 200 bytes={served['length']} "
                    "contains packaged component"
                )

                page.reload(wait_until="networkidle")
                expect(page.locator(".app-shell")).to_be_visible()
                rows += assert_composed(page, base)
                page.screenshot(path=str(shots / "composed-panel.png"), full_page=True)

                disabled = page.evaluate(DISABLE_SCRIPT, {
                    "extensionId": EXTENSION_ID, "expectedVersion": revision,
                })
                assert disabled["status"] == 200, disabled
                assert disabled["body"]["enabled"] is False, disabled
                assert disabled["body"]["revision"] == revision + 1, disabled
                print(
                    f"HTTP POST /extensions/{EXTENSION_ID}/enabled -> 200 enabled=False "
                    f"expectedVersion={revision} revision={disabled['body']['revision']}"
                )

                page.reload(wait_until="networkidle")
                expect(page.locator(".app-shell")).to_be_visible()
                rows += assert_restored(page, base)
                page.screenshot(path=str(shots / "restored-panel.png"), full_page=True)

                after = page.evaluate(DISCOVERY_SCRIPT)
                after_item = next(
                    (entry for entry in (after["body"] or {}).get("items") or []
                     if entry.get("id") == EXTENSION_ID), None)
                assert after_item and after_item["enabled"] is False, after
                assert not after_item.get("frontendUrl"), after_item
                print("DISCOVERY after disable: enabled=False frontendUrl=absent")

                assert not errors, f"page errors: {errors}"
                print("PAGEERRORS 0 across install, composition and disable")
                context.close()
            finally:
                browser.close()
    except Exception:
        print("DIAGNOSTICS owned process log tails:")
        print(owner.log_tails())
        raise
    finally:
        owner.stop()
        leaked = open_ports([api_port, web_port])
        if leaked:
            print(f"CLEANUP LEAKED ports {leaked}")
            if sys.exc_info()[0] is None:
                raise RuntimeError(f"ports still open after cleanup: {leaked}")
        else:
            print(f"CLEANUP owned processes stopped, ports {[api_port, web_port]} released")
    return rows


def main() -> int:
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    print(f"ENV scrubbed {len(DROPPED_KEYS)} inherited keys: {', '.join(sorted(DROPPED_KEYS)) or 'none'}")
    assert not any(key.upper().startswith("ITSM_") for key in CLEAN_ENV)
    for path in (PYTHON, FRONTEND / "node_modules", BACKEND / "itsm"):
        assert path.exists(), path

    owner = Owned()
    rows: list[str] = []
    failed = False
    try:
        rows = run_scenario(owner, shots)
    except Exception as exc:  # report the exact failing step, then stop
        failed = True
        print(f"FAILED: {type(exc).__name__}: {exc}")

    print("\n=== RESULT ===")
    for row in rows:
        print(row)
    print(f"steps completed: {len(rows)} painted assertions")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    print(
        "bounded scope: one disposable backend + loopback Vite, fixed validator image, "
        "no full npm suite, no Prometheus, no provider/agent calls"
    )
    print(f"elapsed: {time.monotonic() - STARTED:.1f}s (limit {DEADLINE_SECONDS:.0f}s)")
    if failed:
        return 1
    print(
        "PASS T30 installed extension: real validated package composed page.inventory/"
        "config.general/nav.reports/widget.alerts in the authenticated shell; protected "
        "config sections reachable; disable restored core"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
