#!/usr/bin/env python3
"""Rendered check for the distilled chat surface.

The chat default is provider, model and one configuration action. Quota,
budget, capability, session and technical-usage panels are gone; the
transcript, composer, send/cancel and actionable failures stay.

This script reuses the isolated backend/Vite servers of
``demo-indicator.browser.py`` (its own loopback ports, disposable database and
scratch root) and mocks only ``/agent/engines``, ``/agent/preferences`` and
``/agent/sessions`` so no provider is contacted and no real key is required.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent


def _fixture():
    spec = importlib.util.spec_from_file_location("demo_indicator", HERE / "demo-indicator.browser.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


f = _fixture()

ENGINES = {
    "instances": [
        {
            "id": "pydantic-built-in",
            "name": "Pydantic AI",
            "engine": "pydantic",
            "enabled": True,
            "models": [{"id": "pydantic:default"}],
            "capabilities": {"tools": True},
            "attachmentsSupported": True,
        },
        {
            "id": "opencode-local",
            "name": "OpenCode local",
            "engine": "opencode",
            "profile": "itsm",
            "enabled": True,
            "models": [{"id": "opencode/free-a"}, {"id": "opencode/free-b"}],
            "capabilities": {"tools": True, "streaming": True, "cancel": True},
            "attachmentsSupported": True,
        },
        {
            "id": "hermes-itsm",
            "name": "Hermes ITSM",
            "engine": "hermes",
            "profile": "itsm",
            "version": "0.22.5",
            "enabled": True,
            "models": [{"id": "hermes:itsm"}],
            "capabilities": {"tools": True, "streaming": True},
        },
        {
            "id": "hermes-default",
            "name": "Hermes personal",
            "engine": "hermes",
            "profile": "default",
            "version": "0.22.5",
            "enabled": True,
            "models": [{"id": "hermes:default"}],
            "capabilities": {"tools": True, "streaming": True},
        },
    ],
    "preference": {"instanceId": "pydantic-built-in", "model": "pydantic:default"},
}

BROWSER_CHROME = ("Choose Files", "No file chosen", "Choose File", "No file")

REMOVED_IDS = (
    "conversation-engine",
    "conversation-profile",
    "conversation-session",
    "conversation-quota",
    "conversation-quota-refresh",
    "conversation-usage",
    "conversation-help",
)

REMOVED_COPY = (
    "Motor y modelo",
    "Tu cuota diaria de IA",
    "Consumido:",
    "Reservado:",
    "Límite diario",
    "Presupuesto diario",
    "El agente pide los datos que falten",
)


MANAGED_ENGINES = {
    "instances": [
        {
            "id": "opencode-local",
            "name": "OpenCode local",
            "engine": "opencode",
            "profile": "itsm",
            "enabled": True,
            "models": [{"id": "opencode/free-a"}],
            "capabilities": {"tools": True, "streaming": True, "cancel": True},
            "attachmentsSupported": True,
            "quota": {"mode": "managed"},
        }
    ],
    "preference": {"instanceId": "opencode-local", "model": "opencode/free-a"},
}

PERSONAL_PROVIDER = "33333333-4444-4555-8666-777777777777"

PROVIDERS = {
    "items": [
        {
            "id": PERSONAL_PROVIDER,
            "name": "Mi clave",
            "scope": "personal",
            "baseUrl": "https://personal.example/v1",
            "models": ["personal-model"],
            "credentialConfigured": True,
            "enabled": True,
        }
    ],
    "canManageGlobal": False,
    "canManagePersonal": True,
    "credentialStorageAvailable": True,
}

EMPTY_ENGINES = {"instances": [], "preference": None}


def mock_agent_endpoints(page) -> tuple[list[dict], dict]:
    writes: list[dict] = []
    state: dict = {"engines": ENGINES, "providers": {"items": [], "canManageGlobal": False,
                                                     "canManagePersonal": False,
                                                     "credentialStorageAvailable": True}}

    def engines(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(state["engines"]))

    def providers(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(state["providers"]))

    def preferences(route):
        writes.append({"method": route.request.method, "body": route.request.post_data})
        route.fulfill(status=200, content_type="application/json", body=route.request.post_data or "{}")

    def sessions(route):
        if route.request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"sessions": []}))
            return
        route.fulfill(status=201, content_type="application/json", body=json.dumps({"id": "mock-session", "messages": []}))

    page.route("**/api/v1/agent/engines", engines)
    page.route("**/api/v1/agent/providers", providers)
    page.route("**/api/v1/agent/preferences", preferences)
    page.route("**/api/v1/agent/sessions", sessions)
    return writes, state


def settled(page) -> None:
    """Wait for route transitions to finish so screenshots show the settled route."""
    page.wait_for_function(
        "() => !document.querySelector('.page-leave-active, .page-enter-active,"
        " .view-leave-active, .view-enter-active')"
    )
    page.wait_for_timeout(120)


def surface_checks(page, label: str, errors: list[str], shots: Path) -> None:
    page.goto(page.url.split("#")[0] + "#/conversacion", wait_until="networkidle")
    settled(page)
    expect(page.locator("#conversation-surface")).to_be_visible()
    expect(page.locator("#conversation-provider")).to_be_visible()
    expect(page.locator("#conversation-model")).to_be_visible()
    expect(page.locator("#conversation-config")).to_be_visible()
    for element_id in REMOVED_IDS:
        assert page.locator("#" + element_id).count() == 0, f"{label}: {element_id} is gone"
    body = page.locator("#conversation-surface").inner_text()
    for copy in REMOVED_COPY:
        assert copy not in body, f"{label}: removed copy still rendered: {copy}"
    expect(page.locator("#conversation-input")).to_be_visible()
    expect(page.locator("#conversation-send")).to_be_visible()
    expect(page.locator("#conversation-attach")).to_be_visible()
    picker_box = page.locator("#conversation-attachment").evaluate(
        "el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; }"
    )
    assert picker_box[0] <= 1 and picker_box[1] <= 1, (
        f"{label}: the native picker is still rendered: {picker_box}"
    )
    attachment_text = page.locator("#conversation-form").inner_text()
    assert not any(marker in attachment_text for marker in BROWSER_CHROME), (
        f"{label}: English browser file chrome is visible: {attachment_text}"
    )
    with page.expect_file_chooser() as chooser:
        page.locator("#conversation-attach").click()
    assert chooser.value.element.get_attribute("id") == "conversation-attachment", (
        f"{label}: the attachment action opens the native picker"
    )
    leftover = page.locator(".panel-overview, .noc-widget, .universal-filter-strip").count()
    assert leftover == 0, f"{label}: previous route panel is still mounted ({leftover} nodes)"
    assert page.get_by_text("Nuevo activo").count() == 0, f"{label}: panel widgets are still rendered"
    page.evaluate("document.activeElement && document.activeElement.blur()")
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 1, f"{label}: horizontal overflow {overflow}px"
    assert not errors, f"{label}: page errors {errors}"
    print(f"SURFACE {label} ok overflow=0 errors=0")


def provider_flow(page, writes: list[dict], label: str) -> None:
    page.select_option("#conversation-provider", "engine:opencode-local")
    page.wait_for_function(
        "() => Array.from(document.querySelectorAll('#conversation-model option'))"
        ".map(option => option.value).includes('opencode/free-a')"
    )
    page.wait_for_function(
        "() => document.querySelector('#conversation-provider').value === 'engine:opencode-local'"
    )
    saved = [json.loads(item["body"]) for item in writes if item["body"]]
    assert {"instanceId": "opencode-local", "model": "opencode/free-a"} in saved, saved
    print(f"PROVIDER {label} switched to engine:opencode-local and saved {saved[-1]}")


def profile_flow(page, writes: list[dict], label: str, shots: Path) -> None:
    labels = page.locator("#conversation-provider option").all_inner_texts()
    joined = " | ".join(labels)
    assert "Hermes ITSM" in joined and "Hermes personal" in joined, (
        f"{label}: both authorized Hermes profiles are selectable: {joined}"
    )
    page.select_option("#conversation-provider", "engine:hermes-itsm")
    page.wait_for_function("() => document.querySelector('#conversation-provider').value === 'engine:hermes-itsm'")
    page.select_option("#conversation-provider", "engine:hermes-default")
    page.wait_for_function("() => document.querySelector('#conversation-model').value === 'hermes:default'")
    saved = [json.loads(item["body"]) for item in writes if item["body"]]
    assert {"instanceId": "hermes-default", "model": "hermes:default"} in saved, saved
    page.screenshot(path=str(shots / f"chat-profile-{label}.png"), full_page=True)
    page.select_option("#conversation-provider", "engine:pydantic-built-in")
    page.wait_for_function("() => document.querySelector('#conversation-provider').value === 'engine:pydantic-built-in'")
    print(f"PROFILE {label} switched Hermes ITSM -> Hermes personal and saved {saved[-1]}")


def keyboard_flow(page, label: str) -> None:
    page.locator("#conversation-provider").focus()
    assert page.evaluate("document.activeElement.id") == "conversation-provider"
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.id") == "conversation-model"
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.id") == "conversation-config", page.evaluate(
        "document.activeElement.id"
    )
    print(f"KEYBOARD {label} provider -> model -> config")


def config_flow(page, label: str) -> None:
    page.locator("#conversation-config").click()
    page.wait_for_function("() => location.hash === '#/configuracion/ia'")
    expect(page.get_by_role("heading", name="Configuración", exact=False).first).to_be_visible()
    print(f"CONFIG {label} navigated to #/configuracion/ia")


def locale_flow(page, label: str, shots: Path) -> None:
    page.goto(page.url.split("#")[0] + "#/conversacion", wait_until="networkidle")
    expect(page.locator("#conversation-provider")).to_be_visible()
    assert "Proveedor" in page.locator("#conversation-surface").inner_text()
    assert "Modelo" in page.locator("#conversation-surface").inner_text()
    assert "Configuración" in page.locator("#conversation-surface").inner_text()
    page.evaluate("async () => { await window.ItsmI18n.loadBundle('en'); window.ItsmI18n.setLocale('en'); }")
    page.wait_for_function("() => document.querySelector('#conversation-surface').innerText.includes('Provider')")
    english = page.locator("#conversation-surface").inner_text()
    assert "Provider" in english and "Model" in english and "Settings" in english, english
    assert "Proveedor" not in english and "Modelo" not in english, english
    page.screenshot(path=str(shots / f"chat-en-{label}.png"), full_page=True)
    page.evaluate("async () => { await window.ItsmI18n.loadBundle('es'); window.ItsmI18n.setLocale('es'); }")
    page.wait_for_function("() => document.querySelector('#conversation-surface').innerText.includes('Proveedor')")
    print(f"LOCALE {label} es/en labels follow the selected locale")


def state_surface(page, state: dict, engines: dict, providers: dict, label: str, shots: Path, name: str) -> None:
    state["engines"] = engines
    state["providers"] = providers
    page.goto(page.url.split("#")[0] + "#/conversacion", wait_until="networkidle")
    page.reload(wait_until="networkidle")
    settled(page)
    expect(page.locator("#conversation-surface")).to_be_visible()
    expect(page.locator("#conversation-provider")).to_be_visible()
    page.screenshot(path=str(shots / f"chat-{name}-{label}.png"), full_page=True)
    print(f"STATE {name} {label} captured")


def compact_shot(page, state: dict, label: str, shots: Path) -> None:
    state["engines"] = ENGINES
    state["providers"] = {"items": [], "canManageGlobal": False, "canManagePersonal": False,
                          "credentialStorageAvailable": True}
    page.goto(page.url.split("#")[0] + "#/panel", wait_until="networkidle")
    page.locator("#conversation-opener").wait_for(state="visible")
    page.screenshot(path=str(shots / f"chat-opener-{label}.png"))
    page.locator("#conversation-opener").click()
    page.locator("#conversation-surface").wait_for(state="visible")
    page.locator("#conversation-provider").wait_for(state="visible")
    page.wait_for_function("() => { const el = document.querySelector('#conversation-provider'); return el && !el.disabled; }")
    settled(page)
    assert page.locator("#conversation-surface").evaluate("el => el.classList.contains('conversation--compact')")
    assert page.locator("#conversation-opener").is_hidden(), (
        f"{label}: the opener must not overlap the open panel"
    )
    page.screenshot(path=str(shots / f"chat-compact-{label}.png"))
    print(f"COMPACT {label} captured")


def run() -> int:
    f.SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = f.SCRATCH / "screenshots"
    shots.mkdir()
    owner, ports = f.Owned(), []
    rows = 0
    try:
        database_dir = f.SCRATCH / "chat"
        database_dir.mkdir(parents=True, exist_ok=True)
        api_env = f.isolated_state("chat")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database_dir / "chat.db")
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = f.DEMO_PASSWORD
        f.run_command([str(f.PYTHON), "-m", "alembic", "upgrade", "head"], cli_env, "alembic upgrade head")
        f.run_command(
            [str(f.PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", f.ORDINARY_USERNAME, "--name", "chat distillation install"],
            cli_env, "bootstrap-superadmin",
        )
        base, ports = f.start_servers(owner, "chat", api_env)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for width, height in ((1440, 1000), (390, 844)):
                    context = browser.new_context(viewport={"width": width, "height": height})
                    errors: list[str] = []
                    page = context.new_page()
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    writes, state = mock_agent_endpoints(page)
                    try:
                        f.login(page, base, f.ORDINARY_USERNAME, f.DEMO_PASSWORD)
                        for theme in ("light", "dark"):
                            f.set_theme(page, theme)
                            label = f"{width}x{height}-{theme}"
                            surface_checks(page, label, errors, shots)
                            page.screenshot(path=str(shots / f"chat-{label}.png"), full_page=True)
                            rows += 1
                        if width == 1440:
                            f.set_theme(page, "light")
                            state_surface(page, state, MANAGED_ENGINES, PROVIDERS, "1440-light", shots, "managed")
                            page.select_option("#conversation-provider", "provider:" + PERSONAL_PROVIDER)
                            page.wait_for_function(
                                "() => document.querySelector('#conversation-provider').value.startsWith('provider:')"
                            )
                            page.screenshot(path=str(shots / "chat-managed-personal-1440-light.png"), full_page=True)
                            state["engines"] = ENGINES
                            state["providers"] = {"items": [], "canManageGlobal": False,
                                                  "canManagePersonal": False,
                                                  "credentialStorageAvailable": True}
                            page.goto(page.url.split("#")[0] + "#/conversacion", wait_until="networkidle")
                            page.reload(wait_until="networkidle")
                            provider_flow(page, writes, "1440")
                            profile_flow(page, writes, "1440", shots)
                            keyboard_flow(page, "1440")
                            locale_flow(page, "1440", shots)
                            state_surface(page, state, EMPTY_ENGINES, {"items": [], "canManageGlobal": False,
                                                                       "canManagePersonal": False,
                                                                       "credentialStorageAvailable": True},
                                          "1440-light", shots, "unconfigured")
                            assert page.locator("#conversation-provider").is_disabled()
                            assert page.locator("#conversation-model").is_disabled()
                            compact_shot(page, state, "1440-light", shots)
                            config_flow(page, "1440")
                        else:
                            f.set_theme(page, "light")
                            keyboard_flow(page, "390")
                            state_surface(page, state, EMPTY_ENGINES, {"items": [], "canManageGlobal": False,
                                                                       "canManagePersonal": False,
                                                                       "credentialStorageAvailable": True},
                                          "390-light", shots, "unconfigured")
                            f.set_theme(page, "dark")
                            compact_shot(page, state, "390-dark", shots)
                    finally:
                        context.close()
            finally:
                browser.close()
        print(f"RESULT chat distillation rows={rows} failures=0")
        return 0
    except Exception:
        print("DIAGNOSTICS chat (owned process log tails):")
        print(owner.log_tails())
        raise
    finally:
        owner.stop()
        leaked = f.open_ports(ports)
        if leaked:
            print(f"CLEANUP chat: LEAKED ports {leaked}")
            if sys.exc_info()[0] is None:
                raise RuntimeError(f"chat ports still open after cleanup: {leaked}")
        else:
            print(f"CLEANUP chat: owned processes stopped, ports {ports} released")


if __name__ == "__main__":
    sys.exit(run())
