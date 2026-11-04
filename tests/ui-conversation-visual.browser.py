#!/usr/bin/env python3
"""U4: individual visual pass over the conversation surface.

Covers the full conversation route, the compact panel opened from a module
route, the provider/model/configuration controls, the unconfigured, loading,
discovery-error and legacy states, the transcript with tools/actions/results/
review links, the preparing/streaming/cancelling/cancelled run states, the
actionable send failures, the approval note, the reconnect/run-in-progress
state and the attachment states (supported, unsupported, pending upload,
upload rejection, asset attachments).

Reuses ``demo-indicator.browser.py`` exactly like ``ui-inventory-visual.browser.py``:
one disposable demo installation (fictional asset dataset) with its own loopback
API/Vite pair, so the asset context and the asset attachment read are served by
the real backend.

Only the provider/agent HTTP surface is mocked (``/api/v1/agent/**``): engine
discovery, saved preference, personal providers, session create/patch/read,
the SSE message stream, cancel and session attachment upload. No provider is
contacted, no key is required and no real model runs.

Every rendered state is captured as its own PNG (scenario, state, locale,
viewport and theme in the file name) so a human can open one image at a time.
No conversation message is really sent, no lifecycle/inventory write is
confirmed and nothing here touches an existing installation.

Run: cd frontend && python3 tests/ui-conversation-visual.browser.py
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('chat_fixture', HERE / 'demo-indicator.browser.py')
f = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(f)

RAW_KEY = re.compile(r'\bui\.[a-z_]+\.[a-z_]+\b')
ASSET_ID = '11111111-2222-3333-4444-555555555555'
ASSET_ID_2 = '11111111-2222-3333-4444-666666666666'
CANDIDATE_ID = '44444444-5555-4666-8777-888888888888'
PERSONAL_PROVIDER = '33333333-4444-4555-8666-777777777777'

# Representative, not a Cartesian product: the two locales, the two themes and
# the two widths the review asked for, each rendered on the full route.
FULL_MATRIX = (
    ('es', 1440, 'light'),
    ('es', 1440, 'dark'),
    ('en', 1440, 'light'),
    ('en', 1440, 'dark'),
    ('es', 390, 'light'),
    ('es', 390, 'dark'),
    ('en', 390, 'light'),
    ('en', 390, 'dark'),
)

COPY = {
    'es': {
        'title': 'Conversación',
        'provider': 'Proveedor',
        'model': 'Modelo',
        'settings': 'Configuración',
        'org_provider': 'Proveedor de la organización',
        'unconfigured': 'Sin configurar',
        'no_models': 'Sin modelos anunciados',
        'loading': 'Consultando motores…',
        'placeholder': 'Ej.: Muéstrame los servidores de Matriz',
        'attachments': 'Adjuntos',
        'attach_help': 'Hasta 4 archivos de 4 MiB en total por mensaje:',
        'lock': 'Quita los adjuntos pendientes o envíalos antes de cambiar de motor, '
                'proveedor o modelo.',
        'preparing': 'Preparando la sesión del motor…',
        'receiving': 'Recibiendo la respuesta del agente…',
        'cancelling': 'Cancelando…',
        'cancelled': 'Ejecución cancelada.',
        'retry_help': 'La ejecución se interrumpió; el mensaje no se reenvió automáticamente.',
        'reconnect': 'Reconectar y consultar el estado',
        'running_server': 'El servidor indica una ejecución en curso.',
        'approval': 'La última operación queda pendiente de aprobación en el servidor.',
        'tools': 'Herramientas',
        'actions': 'Acciones ejecutadas',
        'results': 'Activos mencionados',
        'reviews': 'Extensiones pendientes de revisión',
        'context': 'Activo en contexto (opcional)',
        'asset_attach_label': 'Adjuntos del activo',
        'asset_attach_load': 'Cargar adjuntos del activo',
        'asset_attach_empty': 'El activo no tiene adjuntos.',
        'result_status': 'Asignado',
        'session_attachments': 'Adjuntos en esta conversación: 1 de 20.',
        'unavailable': 'El motor no está disponible en este momento.',
        'conflict': (
            'La operación no se puede completar con el estado actual.',
            'La ejecución anterior sigue activa; puedes cancelarla o reconectar '
            'sin reenviar el mensaje.',
        ),
        'incomplete': 'La conexión terminó sin un evento de cierre.',
        'modality': 'El modelo seleccionado no admite ese tipo de adjunto.',
        'role_user': 'Tú',
        'role_agent': 'Agente',
    },
    'en': {
        'title': 'Conversation',
        'provider': 'Provider',
        'model': 'Model',
        'settings': 'Settings',
        'org_provider': 'Organization provider',
        'unconfigured': 'Not configured',
        'no_models': 'No models announced',
        'loading': 'Loading engines…',
        'placeholder': 'E.g.: Show me the servers at Headquarters',
        'attachments': 'Attachments',
        'attach_help': 'Up to 4 files, 4 MiB in total per message:',
        'lock': 'Remove the pending attachments or send them before changing the engine, '
                'provider or model.',
        'preparing': 'Preparing the engine session…',
        'receiving': 'Receiving the agent reply…',
        'cancelling': 'Cancelling…',
        'cancelled': 'Run cancelled.',
        'retry_help': 'The run was interrupted; the message was not resent automatically.',
        'reconnect': 'Reconnect and check status',
        'running_server': 'The server reports a run in progress.',
        'approval': 'The last operation is waiting for server approval.',
        'tools': 'Tools',
        'actions': 'Actions executed',
        'results': 'Assets mentioned',
        'reviews': 'Extensions awaiting review',
        'context': 'Asset in context (optional)',
        'asset_attach_label': 'Asset attachments',
        'asset_attach_load': 'Load asset attachments',
        'asset_attach_empty': 'The asset has no attachments.',
        'result_status': 'Assigned',
        'session_attachments': 'Attachments in this conversation: 1 of 20.',
        'unavailable': 'The engine is not available right now.',
        'conflict': (
            'The operation cannot be completed in the current state.',
            'The previous run is still active; you can cancel it or reconnect '
            'without resending the message.',
        ),
        'incomplete': 'The connection ended without a closing event.',
        'modality': 'The selected model does not accept that attachment type.',
        'role_user': 'You',
        'role_agent': 'Agent',
    },
}

ENGINES = {
    'instances': [
        {
            'id': 'pydantic-built-in',
            'name': 'Pydantic AI',
            'engine': 'pydantic',
            'enabled': True,
            'models': [{'id': 'pydantic:default', 'inputs': {'image': True, 'file': True}}],
            'capabilities': {'tools': True},
            'attachmentsSupported': True,
        },
        {
            'id': 'opencode-local',
            'name': 'OpenCode local',
            'engine': 'opencode',
            'profile': 'itsm',
            'enabled': True,
            'models': [{'id': 'opencode/free-a'}],
            'capabilities': {'tools': True, 'streaming': True, 'cancel': True},
            'attachmentsSupported': True,
        },
        {
            'id': 'hermes-itsm',
            'name': 'Hermes ITSM',
            'engine': 'hermes',
            'profile': 'itsm',
            'version': '0.22.5',
            'enabled': True,
            'models': [{'id': 'hermes:itsm'}],
            'capabilities': {'tools': True, 'streaming': True},
        },
    ],
    'preference': {'instanceId': 'pydantic-built-in', 'model': 'pydantic:default'},
}

ENGINES_NO_ATTACHMENTS = {
    'instances': [
        {
            'id': 'pydantic-built-in',
            'name': 'Pydantic AI',
            'engine': 'pydantic',
            'enabled': True,
            'models': [{'id': 'pydantic:default'}],
            'capabilities': {'tools': True},
            'attachmentsSupported': False,
        },
    ],
    'preference': {'instanceId': 'pydantic-built-in', 'model': 'pydantic:default'},
}

ENGINES_DISCOVERY_ERROR = {
    'instances': [
        {
            'id': 'pydantic-built-in',
            'name': 'Pydantic AI',
            'engine': 'pydantic',
            'enabled': True,
            'models': [{'id': 'pydantic:default'}],
            'capabilities': {'tools': True},
            'attachmentsSupported': True,
        },
        {
            'id': 'opencode-local',
            'name': 'OpenCode local',
            'engine': 'opencode',
            'profile': 'itsm',
            'enabled': True,
            'models': [],
            'capabilities': {},
            'error': 'El binario no respondió al listar modelos.',
        },
    ],
    'preference': {'instanceId': 'pydantic-built-in', 'model': 'pydantic:default'},
}

MANAGED_ENGINES = {
    'instances': [
        {
            'id': 'opencode-local',
            'name': 'OpenCode local',
            'engine': 'opencode',
            'profile': 'itsm',
            'enabled': True,
            'models': [{'id': 'opencode/free-a'}],
            'capabilities': {'tools': True, 'streaming': True, 'cancel': True},
            'attachmentsSupported': True,
            'quota': {'mode': 'managed'},
        },
    ],
    'preference': {'instanceId': 'opencode-local', 'model': 'opencode/free-a'},
}

EMPTY_ENGINES = {'instances': [], 'preference': None}
EMPTY_PROVIDERS = {
    'items': [],
    'canManageGlobal': False,
    'canManagePersonal': False,
    'credentialStorageAvailable': True,
}
PERSONAL_PROVIDERS = {
    'items': [
        {
            'id': PERSONAL_PROVIDER,
            'name': 'Mi clave',
            'scope': 'personal',
            'baseUrl': 'https://personal.example/v1',
            'models': ['personal-model'],
            'modelCapabilities': {'personal-model': {'image': True, 'file': False}},
            'credentialConfigured': True,
            'enabled': True,
        },
    ],
    'canManageGlobal': False,
    'canManagePersonal': True,
    'credentialStorageAvailable': True,
}

SESSION_SNAPSHOT = {
    'id': 'mock-session',
    'instanceId': 'pydantic-built-in',
    'model': 'pydantic:default',
    'providerId': None,
    'status': 'running',
    'approvalPending': False,
    'messages': [
        {
            'role': 'user',
            'content': 'Adjunta el informe del activo.',
            'attachments': [
                {
                    'id': 'att-9',
                    'filename': 'informe.pdf',
                    'mediaType': 'application/pdf',
                    'kind': 'file',
                    'size': 4096,
                },
            ],
        },
        {'role': 'assistant', 'content': 'He revisado el informe adjunto.'},
    ],
    'actions': [{'tool': 'assets.get', 'status': 'completed', 'assetIds': [ASSET_ID]}],
    'results': [{'id': ASSET_ID, 'name': 'srv-db-01', 'quickCode': 'ACT-0101', 'status': 'in_use'}],
}


def sse(*frames: dict) -> str:
    return ''.join('data: ' + json.dumps(frame, ensure_ascii=False) + '\n\n' for frame in frames)


REPLY_FRAMES = {
    'es': (
        {'type': 'delta', 'text': 'En Matriz hay dos servidores de base de datos.'},
        {'type': 'tool', 'tool': 'assets.search', 'status': 'started', 'input': {'query': 'servidores'}},
        {'type': 'tool', 'tool': 'assets.search', 'status': 'completed', 'output': {'count': 2}},
        {
            'type': 'done',
            'cancelled': False,
            'approvalPending': False,
            'actions': [{'tool': 'assets.search', 'status': 'completed', 'assetIds': [ASSET_ID]}],
            'results': [
                {'id': ASSET_ID, 'name': 'srv-db-01', 'quickCode': 'ACT-0101',
                 'category': 'Servidor', 'site': 'Matriz', 'status': 'in_use'},
                {'id': ASSET_ID_2, 'name': 'srv-app-01', 'quickCode': 'ACT-0102',
                 'category': 'Servidor', 'site': 'Matriz', 'status': 'maintenance'},
                {'type': 'extension_review', 'candidateId': CANDIDATE_ID,
                 'extensionId': 'glpi-sync', 'version': '1.2.0', 'digest': 'a' * 64},
            ],
        },
    ),
    'en': (
        {'type': 'delta', 'text': 'There are two database servers at Headquarters.'},
        {'type': 'tool', 'tool': 'assets.search', 'status': 'started', 'input': {'query': 'servers'}},
        {'type': 'tool', 'tool': 'assets.search', 'status': 'completed', 'output': {'count': 2}},
        {
            'type': 'done',
            'cancelled': False,
            'approvalPending': False,
            'actions': [{'tool': 'assets.search', 'status': 'completed', 'assetIds': [ASSET_ID]}],
            'results': [
                {'id': ASSET_ID, 'name': 'srv-db-01', 'quickCode': 'ACT-0101',
                 'category': 'Server', 'site': 'Headquarters', 'status': 'in_use'},
                {'id': ASSET_ID_2, 'name': 'srv-app-01', 'quickCode': 'ACT-0102',
                 'category': 'Server', 'site': 'Headquarters', 'status': 'maintenance'},
            ],
        },
    ),
}


def new_state() -> dict:
    return {
        'engines_mode': 'ok',
        'engines': ENGINES,
        'providers': EMPTY_PROVIDERS,
        'sessions': [],
        'session_mode': 'ok',
        'message_mode': 'ok',
        'frames': '',
        'upload_mode': 'ok',
        'upload_name': 'informe.pdf',
        'upload_kind': 'file',
        'cancel': {'cancelled': True},
        'session_snapshot': SESSION_SNAPSHOT,
        'held': [],
        'writes': [],
    }


def reset(state: dict) -> None:
    state.update(new_state())


def mock_chat(page, state: dict) -> None:
    """Answer only the provider/agent HTTP surface; no provider is contacted."""

    def error(route, status: int, code: str, message: str = '') -> None:
        payload = {'error': {'code': code}}
        if message:
            payload['error']['message'] = message
        route.fulfill(status=status, content_type='application/json', body=json.dumps(payload))

    def handler(route) -> None:
        request = route.request
        path = request.url.split('?')[0].split('/api/v1', 1)[-1]
        method = request.method

        if path == '/agent/engines':
            mode = state['engines_mode']
            if mode == 'hold':
                state['held'].append(('engines', route))
                return
            if mode == 'error':
                error(route, 503, 'unavailable')
                return
            if mode == 'missing':
                route.fulfill(status=404, content_type='application/json',
                              body=json.dumps({'error': {'code': 'not_found'}}))
                return
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps(state['engines']))
            return

        if path == '/agent/providers':
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps(state['providers']))
            return

        if path == '/agent/preferences':
            state['writes'].append({'method': method, 'body': request.post_data})
            route.fulfill(status=200, content_type='application/json',
                          body=request.post_data or '{}')
            return

        if path == '/agent/sessions':
            if method == 'GET':
                route.fulfill(status=200, content_type='application/json',
                              body=json.dumps({'sessions': state['sessions']}))
                return
            if state['session_mode'] == 'hold':
                state['held'].append(('session', route))
                return
            route.fulfill(status=201, content_type='application/json', body=json.dumps({
                'id': 'mock-session',
                'instanceId': 'pydantic-built-in',
                'model': 'pydantic:default',
                'messages': [],
            }))
            return

        if path.startswith('/agent/sessions/'):
            rest = path[len('/agent/sessions/'):]
            if rest == 'mock-session':
                if method == 'PATCH':
                    body = json.loads(request.post_data or '{}')
                    route.fulfill(status=200, content_type='application/json', body=json.dumps({
                        'id': 'mock-session',
                        'model': body.get('model') or 'pydantic:default',
                        'providerId': body.get('providerId'),
                    }))
                    return
                route.fulfill(status=200, content_type='application/json',
                              body=json.dumps(state['session_snapshot']))
                return
            if rest == 'mock-session/messages':
                mode = state['message_mode']
                if mode == 'hold':
                    state['held'].append(('messages', route))
                    return
                if mode == 'error503':
                    error(route, 503, 'unavailable')
                    return
                if mode == 'error409':
                    error(route, 409, 'conflict')
                    return
                if mode == 'error401':
                    error(route, 401, 'unauthorized')
                    return
                route.fulfill(status=200, headers={'content-type': 'text/event-stream'},
                              body=state['frames'])
                return
            if rest == 'mock-session/cancel':
                route.fulfill(status=200, content_type='application/json',
                              body=json.dumps(state['cancel']))
                return
            if rest.startswith('mock-session/attachments'):
                if method == 'POST':
                    if state['upload_mode'] != 'ok':
                        error(route, 422, state['upload_mode'])
                        return
                    route.fulfill(status=201, content_type='application/json', body=json.dumps({
                        'id': 'att-1',
                        'filename': state['upload_name'],
                        'mediaType': 'application/pdf',
                        'kind': state['upload_kind'],
                        'size': 2048,
                    }))
                    return
                route.fulfill(status=204, body='')
                return
        route.fulfill(status=404, content_type='application/json',
                      body=json.dumps({'error': {'code': 'not_found'}}))

    page.route('**/api/v1/agent/**', handler)


# --------------------------------------------------------------------- helpers


def settle(page) -> None:
    page.wait_for_function(
        "() => !document.querySelector('.page-leave-active, .page-enter-active,"
        " .view-leave-active, .view-enter-active, .auth-enter-active, .auth-leave-active')"
    )
    page.wait_for_timeout(80)


def wait_mounted(page) -> None:
    page.wait_for_selector('[data-v-app] .app-shell', state='attached', timeout=30000)


def set_locale(page, tag: str) -> None:
    page.evaluate(
        "async (tag) => { await window.ItsmI18n.loadBundle(tag); window.ItsmI18n.setLocale(tag); }",
        tag,
    )
    page.wait_for_timeout(60)


def release(state: dict, kind: str, payload, status: int = 200) -> None:
    pending = [route for held_kind, route in state['held'] if held_kind == kind]
    state['held'] = [(held_kind, route) for held_kind, route in state['held'] if held_kind != kind]
    body = payload if isinstance(payload, str) else json.dumps(payload)
    for route in pending:
        if kind == 'messages':
            route.fulfill(status=status, headers={'content-type': 'text/event-stream'}, body=body)
        else:
            route.fulfill(status=status, content_type='application/json', body=body)


def measure_targets(page, label: str) -> None:
    """Every actionable control offers a 44px target (DESIGN.md touch rule)."""
    rows = page.evaluate(
        """() => {
        const root = document.querySelector('#conversation-surface');
        const out = [];
        root.querySelectorAll('button, a[href], select, textarea, input[type="checkbox"]').forEach((el) => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          if (el.closest('.sr-only') || el.id === 'conversation-attachment') return;
          let rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          if (el.type === 'checkbox') {
            const lab = el.labels && el.labels[0];
            if (lab) {
              const b = lab.getBoundingClientRect();
              const left = Math.min(rect.left, b.left), top = Math.min(rect.top, b.top);
              const right = Math.max(rect.right, b.right), bottom = Math.max(rect.bottom, b.bottom);
              rect = {width: right - left, height: bottom - top};
            }
          }
          const iconOnly = !(el.innerText || '').trim();
          out.push({
            id: el.id || el.className || el.tagName,
            text: (el.innerText || '').trim().slice(0, 32),
            w: Math.round(rect.width), h: Math.round(rect.height), iconOnly,
          });
        });
        return out;
      }""")
    small = [f"{row['id']}[{row['text'] or 'icon'}]={row['w']}x{row['h']}"
             for row in rows if row['h'] < 44 or (row['iconOnly'] and row['w'] < 44)]
    print(f'TARGETS {label} controls={len(rows)} below44={small}')
    assert not small, f'{label}: chat controls below the 44px target: {small}'


def cell(page, shots: Path, scenario: str, name: str, locale: str, width: int, theme: str,
         note: str, check=None, full: bool = True) -> str:
    page.set_viewport_size({'width': width, 'height': 1000 if width > 700 else 844})
    f.set_theme(page, theme)
    set_locale(page, locale)
    settle(page)
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(80)
    if check is not None:
        check()
    label = f'{scenario}-{name}-{locale}-{width}-{theme}'
    if width <= 700:
        measure_targets(page, label)
        if page.locator('.conversation--compact').count():
            log_compact_head(page, label)
    text = page.locator('body').inner_text()
    leak = RAW_KEY.search(text)
    assert not leak, f'{scenario}/{name}: leaked i18n key {leak.group(0)}'
    overflow = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    assert overflow <= 1, f'{scenario}/{name}: horizontal overflow {overflow}px'
    path = shots / f'{label}.png'
    page.screenshot(path=str(path), full_page=full)
    print(f'SHOT {label} route={page.evaluate("location.hash")} | {note}')
    return label


def goto_hash(page, target: str) -> None:
    page.evaluate("(target) => { window.location.hash = target; }", target)
    page.wait_for_function("(target) => window.location.hash === target", arg=target)


def goto_fresh(page, base: str, target: str = '#/conversacion', wait: str = 'networkidle') -> None:
    # A hash-only change is a same-document navigation, so the document is
    # always reloaded: every mocked state needs a real boot of the component.
    page.goto(f'{base}/{target}', wait_until='load')
    page.reload(wait_until=wait)
    wait_mounted(page)
    settle(page)


# ------------------------------------------------------------------ assertions


def assert_full_default(page, locale: str) -> None:
    expect(page.locator('#conversation-surface')).to_be_visible()
    expect(page.locator('#conversation-title')).to_have_text(COPY[locale]['title'])
    expect(page.locator('#conversation-provider')).to_be_visible()
    expect(page.locator('#conversation-provider')).to_be_enabled()
    assert page.evaluate("() => document.querySelector('#conversation-provider').value") == \
        'engine:pydantic-built-in'
    expect(page.locator('#conversation-model')).to_be_visible()
    assert page.evaluate("() => document.querySelector('#conversation-model').value") == \
        'pydantic:default'
    expect(page.locator('#conversation-config')).to_be_visible()
    expect(page.locator('#conversation-config')).to_contain_text(COPY[locale]['settings'])
    expect(page.locator('#conversation-input')).to_be_visible()
    assert page.get_attribute('#conversation-input', 'placeholder') == \
        COPY[locale]['placeholder']
    assert page.locator('#conversation-send').is_disabled(), 'empty draft keeps send disabled'
    expect(page.locator('#conversation-attach')).to_be_visible()
    assert page.locator('.conversation__turn').count() == 0, 'empty conversation hides the log'
    assert page.locator('.panel-overview').count() == 0, 'previous route panel is unmounted'


def assert_compact_open(page, locale: str) -> None:
    assert page.locator('#conversation-surface').evaluate(
        "el => el.classList.contains('conversation--compact')")
    assert page.locator('#conversation-opener').is_hidden(), 'the opener must not overlap the panel'
    expect(page.locator('#conversation-provider')).to_be_enabled()
    expect(page.locator('#conversation-title')).to_have_text(COPY[locale]['title'])
    expect(page.locator('#conversation-input')).to_be_visible()
    expect(page.locator('#conversation-send')).to_be_visible()


def assert_contained(page, selector: str, label: str) -> None:
    """No visible descendant may paint past its container's inline edges."""
    worst = page.evaluate(
        """(selector) => {
        const box = document.querySelector(selector);
        const bounds = box.getBoundingClientRect();
        let worst = 0;
        box.querySelectorAll('*').forEach((el) => {
          const style = getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'absolute') return;
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          worst = Math.max(worst, Math.round(rect.right - bounds.right),
                            Math.round(bounds.left - rect.left));
        });
        return worst;
      }""", selector)
    assert worst <= 1, f'{label}: content overflows its container by {worst}px'


def assert_compact_reply(page, locale: str) -> None:
    assert_compact_open(page, locale)
    expect(page.locator('.conversation__turn')).to_have_count(2)
    expect(page.locator('#conversation-results')).to_be_visible()
    assert_contained(page, '.conversation__body', 'compact panel body')
    body = page.locator('.conversation__body').bounding_box()
    form = page.locator('#conversation-form').bounding_box()
    assert form['y'] >= body['y'] + body['height'] - 1, 'the compact composer is pinned below the body'
    assert form['y'] + form['height'] <= page.viewport_size['height'] + 1, \
        'the pinned composer stays inside the viewport'


def log_compact_head(page, label: str = '') -> None:
    metrics = page.evaluate(
        "() => {"
        " const rect = (el) => { const b = el.getBoundingClientRect();"
        " return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };"
        " const head = document.querySelector('.conversation__head');"
        " const title = document.querySelector('#conversation-title');"
        " const hs = getComputedStyle(head); const ts = getComputedStyle(title);"
        " const kids = Array.from(head.children).map((el) => {"
        "   const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);"
        "   return {cls: el.className, x: Math.round(b.x), w: Math.round(b.width),"
        "     ml: cs.marginLeft, mr: cs.marginRight, flex: cs.flex}; });"
        " return {head: rect(head), title: rect(title), titleParent: rect(title.parentElement),"
        " actions: rect(document.querySelector('.conversation__window-actions')),"
        " headDisplay: hs.display, headJustify: hs.justifyContent, headAlign: hs.alignItems,"
        " headWrap: hs.flexWrap, titleAlign: ts.textAlign, titleMargin: ts.margin, children: kids}; }")
    print(f'COMPACT-HEAD {label} {json.dumps(metrics)}')


def assert_managed(page, locale: str) -> None:
    labels = page.locator('#conversation-provider option').all_inner_texts()
    assert any(COPY[locale]['org_provider'] in label for label in labels), labels
    assert any('Mi clave' in label for label in labels), labels


def assert_personal_provider(page) -> None:
    assert page.evaluate("() => document.querySelector('#conversation-provider').value") == \
        'provider:' + PERSONAL_PROVIDER
    assert page.evaluate("() => document.querySelector('#conversation-model').value") == \
        'personal-model'
    help_text = page.locator('#conversation-attachment-help').inner_text()
    assert 'PDF' not in help_text, f'provider marks PDF as unsupported: {help_text}'


def assert_unconfigured(page, locale: str) -> None:
    assert page.locator('#conversation-provider').is_disabled()
    assert page.locator('#conversation-model').is_disabled()
    options = page.locator('#conversation-provider option').all_inner_texts()
    assert COPY[locale]['unconfigured'] in options, options
    models = page.locator('#conversation-model option').all_inner_texts()
    assert COPY[locale]['no_models'] in models, models
    expect(page.locator('#conversation-config')).to_be_visible()


def assert_loading(page, locale: str) -> None:
    status = page.locator('.conversation__meta[role="status"]')
    expect(status).to_contain_text(COPY[locale]['loading'])
    assert page.locator('#conversation-provider').is_disabled()
    assert page.locator('.conversation__error').count() == 0, 'loading must not paint an error'


def assert_engines_error(page, locale: str) -> None:
    alert = page.locator('.conversation__error[role="alert"]').first
    expect(alert).to_contain_text(COPY[locale]['unavailable'])
    assert page.locator('#conversation-provider').is_disabled()


def assert_discovery_error(page) -> None:
    errors = page.locator('.conversation__errors[role="alert"] li')
    assert errors.count() >= 1, 'discovery error list is missing'
    text = errors.first.inner_text()
    assert 'OpenCode local' in text and 'El binario no respondió' in text, text


def assert_legacy(page, locale: str) -> None:
    assert page.locator('#conversation-provider').count() == 0, 'legacy chat has no provider control'
    assert page.locator('#conversation-model').count() == 0, 'legacy chat has no model control'
    expect(page.locator('#conversation-input')).to_be_visible()
    expect(page.locator('#conversation-send')).to_be_visible()


def assert_preparing(page, locale: str) -> None:
    expect(page.get_by_text(COPY[locale]['preparing'])).to_be_visible()
    assert page.locator('#conversation-input').is_disabled(), 'the composer is locked while busy'
    expect(page.locator('#conversation-cancel')).to_be_visible()


def assert_streaming(page, locale: str) -> None:
    expect(page.locator('.conversation__turn')).to_have_count(1)
    expect(page.locator('.conversation__turn--user')).to_contain_text('srv-db-01')
    expect(page.get_by_text(COPY[locale]['receiving'])).to_be_visible()
    expect(page.locator('#conversation-cancel')).to_be_visible()


def assert_cancelling(page, locale: str) -> None:
    expect(page.locator('#conversation-cancel')).to_have_text(COPY[locale]['cancelling'])
    assert page.locator('#conversation-cancel').is_disabled()


def assert_cancelled(page, locale: str) -> None:
    expect(page.get_by_text(COPY[locale]['cancelled'])).to_be_visible()
    assert page.locator('#conversation-cancel').count() == 0


def assert_reply(page, locale: str) -> None:
    expect(page.locator('.conversation__turn')).to_have_count(2)
    expect(page.locator('#conversation-tools')).to_have_text(COPY[locale]['tools'])
    expect(page.locator('#conversation-actions')).to_have_text(COPY[locale]['actions'])
    expect(page.locator('#conversation-results')).to_have_text(COPY[locale]['results'])
    expect(page.locator(f'.conversation__result-link[href="#/activo/{ASSET_ID}"]')).to_be_visible()
    row = page.locator(f'.conversation__result:has(.conversation__result-link[href="#/activo/{ASSET_ID}"])')
    row_text = row.inner_text().replace('\n', ' ')
    assert f' · {COPY[locale]["result_status"]}' in row_text, row_text
    if locale == 'es':
        expect(page.locator('#conversation-extension-reviews')).to_be_visible()
        expect(page.locator('#conversation-extension-reviews')).to_contain_text(
            COPY[locale]['reviews'])
    assert page.locator('#conversation-error').count() == 0, 'a complete reply paints no error'
    assert_contained(page, '#conversation-surface', 'conversation surface')


def assert_incomplete(page, locale: str) -> None:
    expect(page.get_by_text(COPY[locale]['incomplete'])).to_be_visible()
    expect(page.locator('.conversation__turn')).to_have_count(2)


def assert_stream_error(page, locale: str) -> None:
    expect(page.locator('#conversation-error')).to_be_visible()
    expect(page.get_by_text(COPY[locale]['retry_help'])).to_be_visible()
    expect(page.locator('#conversation-error button')).to_be_visible()


def assert_send_error(page, locale: str) -> None:
    expect(page.locator('#conversation-error')).to_be_visible()
    expect(page.locator('#conversation-error')).to_contain_text(COPY[locale]['unavailable'])
    expect(page.get_by_text(COPY[locale]['retry_help'])).to_be_visible()
    assert page.input_value('#conversation-input'), 'the rejected draft is restored'
    assert page.locator('.conversation__turn').count() == 0, 'a rejected run leaves no turn'


def assert_conflict(page, locale: str) -> None:
    error = page.locator('#conversation-error')
    expect(error).to_contain_text(COPY[locale]['conflict'][0])
    expect(error).to_contain_text(COPY[locale]['conflict'][1])


def assert_approval(page, locale: str) -> None:
    expect(page.locator('.conversation__approval')).to_have_text(COPY[locale]['approval'])


def assert_running(page, locale: str) -> None:
    expect(page.get_by_text(COPY[locale]['running_server'])).to_be_visible()
    expect(page.locator('#conversation-cancel')).to_be_visible()
    assert page.locator('#conversation-error').count() == 0, 'a successful reconnect clears the error'
    expect(page.locator('.conversation__attachment-name')).to_contain_text('informe.pdf')


def assert_attach_supported(page, locale: str) -> None:
    expect(page.locator('#conversation-attach')).to_have_text(COPY[locale]['attachments'])
    help_text = page.locator('#conversation-attachment-help').inner_text()
    assert help_text.startswith(COPY[locale]['attach_help']), help_text
    assert 'PDF' in help_text, help_text


def assert_attach_unsupported(page) -> None:
    assert page.locator('#conversation-attach').count() == 0, 'unsupported engine offers no upload'
    assert page.locator('#conversation-attachment-help').count() == 0


def assert_pending_attachment(page, locale: str) -> None:
    pending = page.locator('.conversation__attachment-list').first
    expect(pending).to_contain_text('informe.pdf')
    expect(page.get_by_text(COPY[locale]['lock'])).to_be_visible()
    assert page.locator('#conversation-provider').is_disabled(), 'pending files lock the provider'
    assert page.locator('#conversation-model').is_disabled(), 'pending files lock the model'
    expect(page.get_by_text(COPY[locale]['session_attachments'])).to_be_visible()
    expect(page.locator('#conversation-send')).to_be_enabled()


def assert_attachment_error(page, locale: str) -> None:
    expect(page.locator('#conversation-form .conversation__error')).to_have_text(
        COPY[locale]['modality'])
    assert page.locator('.conversation__attachment-list').count() == 0, 'a rejected upload adds no row'


def assert_asset_attachments(page, locale: str) -> None:
    expect(page.locator('#conversation-load-asset-attachments')).to_be_visible()
    expect(page.get_by_text(COPY[locale]['asset_attach_empty'])).to_be_visible()
    examined = 'Examinados' if locale == 'es' else 'Examined'
    assert page.get_by_text(examined).count() == 0, \
        'an asset with no attachments shows only the factual empty message, not a zero count'


def assert_asset_load_name(page, locale: str) -> None:
    """WCAG 2.5.3: the accessible name must contain the visible label."""
    visible = page.locator('#conversation-load-asset-attachments').inner_text().strip()
    assert visible == COPY[locale]['asset_attach_load'], visible
    expect(page.get_by_role('button', name=visible, exact=True)).to_be_visible()
    label = page.locator('.conversation__asset-attachments .conversation__label').bounding_box()
    button = page.locator('#conversation-load-asset-attachments').bounding_box()
    assert button['y'] >= label['y'] + label['height'] - 1, \
        'the block label sits on its own line above the action'
    assert_contained(page, '.conversation__asset-attachments', 'asset attachments block')


# ----------------------------------------------------------------------- flows


def run_chat(page, base: str, shots: Path) -> list[str]:
    rows: list[str] = []
    state = new_state()
    mock_chat(page, state)
    f.login(page, base, f.DEMO_USERNAME, f.DEMO_PASSWORD)

    # 1. Full route: both locales, both themes, both widths. One document load
    # covers the whole matrix: theme, locale and viewport do not remount it.
    reset(state)
    goto_fresh(page, base)
    for locale, width, theme in FULL_MATRIX:
        rows.append(cell(page, shots, 'full', 'default', locale, width, theme,
                         'default conversation route',
                         lambda locale=locale: assert_full_default(page, locale)))

    # 2. Compact panel opened from the panel route.
    reset(state)
    page.goto(f'{base}/#/panel', wait_until='networkidle')
    settle(page)
    expect(page.locator('#conversation-opener')).to_be_visible()
    rows.append(cell(page, shots, 'compact', 'entry', 'es', 1440, 'light',
                     'conversation entry lane on the panel route', full=False))
    page.locator('#conversation-opener').click()
    expect(page.locator('#conversation-surface')).to_be_visible()
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-provider');"
        " return el && !el.disabled; }")
    settle(page)
    rows.append(cell(page, shots, 'compact', 'open', 'es', 1440, 'light',
                     'compact panel over the panel route', full=False,
                     check=lambda: assert_compact_open(page, 'es')))
    page.locator('.conversation__body').evaluate('el => { el.scrollTop = el.scrollHeight; }')
    page.wait_for_timeout(80)
    log_compact_head(page)
    rows.append(cell(page, shots, 'compact', 'end', 'es', 390, 'dark',
                     'compact panel scrolled to the composer', full=False,
                     check=lambda: assert_compact_open(page, 'es')))

    # 2b. The compact panel with a transcript: the composer stays pinned and the
    # transcript scrolls inside the panel body.
    state['frames'] = sse(*REPLY_FRAMES['es'])
    page.fill('#conversation-input', '¿Qué servidores hay en Matriz?')
    page.click('#conversation-send')
    page.wait_for_function("() => document.querySelectorAll('.conversation__turn').length === 2")
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-input');"
        " return el && !el.disabled; }")
    settle(page)
    rows.append(cell(page, shots, 'compact', 'reply', 'es', 1440, 'light',
                     'transcript inside the compact panel', full=False,
                     check=lambda: assert_compact_reply(page, 'es')))
    rows.append(cell(page, shots, 'compact', 'reply', 'es', 390, 'light',
                     'transcript inside the compact panel, phone width', full=False,
                     check=lambda: assert_compact_reply(page, 'es')))

    # 3. Provider, model and configuration states.
    reset(state)
    state['engines'] = MANAGED_ENGINES
    state['providers'] = PERSONAL_PROVIDERS
    goto_fresh(page, base)
    page.wait_for_function(
        "() => Array.from(document.querySelectorAll('#conversation-provider option'))"
        ".some(option => option.value.startsWith('provider:'))")
    rows.append(cell(page, shots, 'provider', 'managed', 'es', 1440, 'light',
                     'managed engine offers organization and personal providers',
                     lambda: assert_managed(page, 'es')))
    page.select_option('#conversation-provider', 'provider:' + PERSONAL_PROVIDER)
    page.wait_for_function(
        "() => document.querySelector('#conversation-provider').value.startsWith('provider:')")
    page.wait_for_function(
        "() => document.querySelector('#conversation-model').value === 'personal-model'")
    rows.append(cell(page, shots, 'provider', 'personal', 'es', 1440, 'light',
                     'personal provider selected, model from that provider',
                     lambda: assert_personal_provider(page)))
    saves = [json.loads(item['body']) for item in state['writes'] if item['body']]
    print(f'OBSERVED provider preference writes {saves}')

    reset(state)
    state['engines'] = EMPTY_ENGINES
    goto_fresh(page, base)
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-provider');"
        " return el && el.disabled; }")
    rows.append(cell(page, shots, 'provider', 'unconfigured', 'es', 1440, 'light',
                     'no engine announced by the server',
                     lambda: assert_unconfigured(page, 'es')))
    rows.append(cell(page, shots, 'provider', 'unconfigured', 'en', 390, 'dark',
                     'no engine announced, phone and dark',
                     lambda: assert_unconfigured(page, 'en')))

    reset(state)
    state['engines_mode'] = 'hold'
    goto_fresh(page, base, wait='load')
    settle(page)
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-provider');"
        " return el && el.disabled; }")
    rows.append(cell(page, shots, 'provider', 'engines-loading', 'es', 1440, 'light',
                     'held engine discovery', lambda: assert_loading(page, 'es')))
    release(state, 'engines', ENGINES)
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-provider');"
        " return el && !el.disabled; }")

    reset(state)
    state['engines_mode'] = 'error'
    goto_fresh(page, base)
    page.wait_for_function("() => !!document.querySelector('.conversation__error[role=\"alert\"]')")
    rows.append(cell(page, shots, 'provider', 'engines-error', 'es', 1440, 'light',
                     '503 engine discovery', lambda: assert_engines_error(page, 'es')))

    reset(state)
    state['engines'] = ENGINES_DISCOVERY_ERROR
    goto_fresh(page, base)
    page.wait_for_function("() => !!document.querySelector('.conversation__errors li')")
    rows.append(cell(page, shots, 'provider', 'discovery-error', 'es', 1440, 'dark',
                     'one engine reports a discovery error',
                     lambda: assert_discovery_error(page)))

    reset(state)
    state['engines_mode'] = 'missing'
    goto_fresh(page, base)
    page.wait_for_function("() => document.querySelector('#conversation-provider') === null")
    rows.append(cell(page, shots, 'provider', 'legacy', 'es', 1440, 'light',
                     '404 discovery keeps the legacy single-prompt chat',
                     lambda: assert_legacy(page, 'es')))

    # 4. The run: preparing -> streaming -> cancelling -> cancelled.
    reset(state)
    state['session_mode'] = 'hold'
    state['message_mode'] = 'hold'
    goto_fresh(page, base)
    page.fill('#conversation-input', '¿Estado de srv-db-01?')
    page.click('#conversation-send')
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-input');"
        " return el && el.disabled; }")
    rows.append(cell(page, shots, 'run', 'preparing', 'es', 1440, 'light',
                     'session creation held by the server',
                     lambda: assert_preparing(page, 'es')))
    release(state, 'session', {'id': 'mock-session', 'instanceId': 'pydantic-built-in',
                               'model': 'pydantic:default', 'messages': []})
    page.wait_for_function("() => document.querySelectorAll('.conversation__turn').length === 1")
    settle(page)
    rows.append(cell(page, shots, 'run', 'streaming', 'es', 1440, 'light',
                     'message sent, first frame still pending',
                     lambda: assert_streaming(page, 'es')))
    page.click('#conversation-cancel')
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-cancel');"
        " return el && el.textContent.includes('Cancelando'); }")
    rows.append(cell(page, shots, 'run', 'cancelling', 'es', 390, 'dark',
                     'cancel accepted, run still open',
                     lambda: assert_cancelling(page, 'es')))
    release(state, 'messages', sse(
        {'type': 'delta', 'text': 'Cancelado por la persona.'},
        {'type': 'done', 'cancelled': True}))
    page.wait_for_function("() => document.querySelectorAll('.conversation__turn').length === 2")
    page.wait_for_function("() => !document.querySelector('#conversation-cancel')")
    rows.append(cell(page, shots, 'run', 'cancelled', 'es', 390, 'dark',
                     'run closed as cancelled',
                     lambda: assert_cancelled(page, 'es')))

    # 5. A complete reply with tools, actions, results and a review link.
    for locale, width, theme in (('es', 1440, 'light'), ('en', 390, 'light'), ('es', 390, 'light')):
        reset(state)
        state['frames'] = sse(*REPLY_FRAMES[locale])
        goto_fresh(page, base)
        page.fill('#conversation-input', '¿Qué servidores hay en Matriz?'
                  if locale == 'es' else 'Which servers are at Headquarters?')
        page.click('#conversation-send')
        page.wait_for_function(
            "() => document.querySelectorAll('.conversation__turn').length >= 2")
        page.wait_for_function(
            "() => { const el = document.querySelector('#conversation-input');"
            " return el && !el.disabled; }")
        settle(page)
        rows.append(cell(page, shots, 'reply', 'complete', locale, width, theme,
                         'complete streamed reply with tool, action, results and review',
                         lambda locale=locale: assert_reply(page, locale)))

    # 6. Stream ends without a closing frame.
    reset(state)
    state['frames'] = sse({'type': 'delta', 'text': 'He encontrado un servidor en Matriz.'})
    goto_fresh(page, base)
    page.fill('#conversation-input', 'Busca servidores en Matriz')
    page.click('#conversation-send')
    page.wait_for_function("() => document.querySelectorAll('.conversation__turn').length === 2")
    page.wait_for_function(
        "() => document.querySelector('#conversation-surface').innerText"
        ".includes('sin un evento de cierre')")
    rows.append(cell(page, shots, 'reply', 'incomplete', 'es', 1440, 'light',
                     'stream closed without a done frame',
                     lambda: assert_incomplete(page, 'es')))

    # 7. Actionable failures and the reconnect/run-in-progress state.
    reset(state)
    state['frames'] = sse(
        {'type': 'delta', 'text': 'Consultando el activo…'},
        {'type': 'error', 'message': 'El proveedor rechazó la credencial configurada.',
         'retryable': True})
    goto_fresh(page, base)
    page.fill('#conversation-input', 'Revisa el activo srv-db-01')
    page.click('#conversation-send')
    page.wait_for_function("() => !!document.querySelector('#conversation-error')")
    page.wait_for_function(
        "() => { const el = document.querySelector('#conversation-input');"
        " return el && !el.disabled; }")
    rows.append(cell(page, shots, 'error', 'stream', 'es', 1440, 'light',
                     'engine-reported stream error with verbatim server copy',
                     lambda: assert_stream_error(page, 'es')))

    reset(state)
    state['message_mode'] = 'error503'
    goto_fresh(page, base)
    page.fill('#conversation-input', 'Estado de srv-db-01')
    page.click('#conversation-send')
    page.wait_for_function("() => !!document.querySelector('#conversation-error')")
    rows.append(cell(page, shots, 'error', 'send', 'es', 1440, 'light',
                     '503 on the message POST, draft restored',
                     lambda: assert_send_error(page, 'es')))
    state['session_snapshot'] = SESSION_SNAPSHOT
    page.click('#conversation-error button')
    page.wait_for_function(
        "() => !!document.querySelector('.conversation__approval')"
        " || !!document.querySelector('#conversation-cancel')")
    settle(page)
    rows.append(cell(page, shots, 'state', 'reconnect-running', 'es', 1440, 'light',
                     'reconnect reports a run still in progress, snapshot rendered',
                     lambda: assert_running(page, 'es')))

    reset(state)
    state['message_mode'] = 'error409'
    goto_fresh(page, base)
    page.fill('#conversation-input', 'Estado de srv-db-01')
    page.click('#conversation-send')
    page.wait_for_function("() => !!document.querySelector('#conversation-error')")
    rows.append(cell(page, shots, 'error', 'conflict', 'es', 1440, 'light',
                     '409 conflict keeps the message unsent',
                     lambda: assert_conflict(page, 'es')))

    reset(state)
    state['frames'] = sse(
        {'type': 'delta', 'text': 'Preparo el cambio de estado.'},
        {'type': 'done', 'cancelled': False, 'approvalPending': True})
    goto_fresh(page, base)
    page.fill('#conversation-input', 'Cambia el activo a mantenimiento')
    page.click('#conversation-send')
    page.wait_for_function("() => !!document.querySelector('.conversation__approval')")
    rows.append(cell(page, shots, 'state', 'approval', 'es', 1440, 'light',
                     'operation awaiting server approval',
                     lambda: assert_approval(page, 'es')))

    # 8. Attachments.
    reset(state)
    goto_fresh(page, base)
    page.wait_for_function("() => !!document.querySelector('#conversation-attachment-help')")
    rows.append(cell(page, shots, 'attach', 'supported', 'es', 1440, 'light',
                     'engine and model accept images, PDF and text',
                     lambda: assert_attach_supported(page, 'es')))

    reset(state)
    state['engines'] = ENGINES_NO_ATTACHMENTS
    goto_fresh(page, base)
    page.wait_for_function("() => !!document.querySelector('#conversation-attach')"
                          " || !!document.querySelector('#conversation-send')")
    rows.append(cell(page, shots, 'attach', 'unsupported', 'en', 1440, 'light',
                     'engine declares no attachment support',
                     lambda: assert_attach_unsupported(page)))

    reset(state)
    goto_fresh(page, base)
    page.set_input_files('#conversation-attachment', files=[{
        'name': 'informe.pdf',
        'mimeType': 'application/pdf',
        'buffer': b'%PDF-1.4 fixture',
    }])
    page.wait_for_function("() => !!document.querySelector('.conversation__attachment-list')")
    settle(page)
    rows.append(cell(page, shots, 'attach', 'pending', 'es', 1440, 'light',
                     'one uploaded attachment blocks the engine controls',
                     lambda: assert_pending_attachment(page, 'es')))

    reset(state)
    state['upload_mode'] = 'model_modality_unsupported'
    goto_fresh(page, base)
    page.set_input_files('#conversation-attachment', files=[{
        'name': 'informe.pdf',
        'mimeType': 'application/pdf',
        'buffer': b'%PDF-1.4 fixture',
    }])
    page.wait_for_function(
        "() => !!document.querySelector('#conversation-form .conversation__error')")
    rows.append(cell(page, shots, 'attach', 'rejected', 'es', 1440, 'light',
                     'server rejects the file for the selected model',
                     lambda: assert_attachment_error(page, 'es')))

    # 9. Asset context and the real asset attachment read.
    reset(state)
    goto_fresh(page, base)
    goto_hash(page, '#/inventario')
    page.wait_for_selector('.asset-table', timeout=30000)
    settle(page)
    goto_hash(page, '#/conversacion')
    page.wait_for_function("() => !!document.querySelector('#conversation-asset')")
    expect(page.locator('#conversation-asset')).to_be_visible()
    context_value = page.locator('#conversation-asset option').nth(1).get_attribute('value')
    page.select_option('#conversation-asset', context_value)
    expect(page.locator('#conversation-load-asset-attachments')).to_be_visible()
    rows.append(cell(page, shots, 'asset', 'context', 'es', 1440, 'light',
                     'one server asset selected as context',
                     lambda: assert_asset_load_name(page, 'es')))
    page.click('#conversation-load-asset-attachments')
    page.wait_for_function(
        "(text) => document.querySelector('#conversation-surface').innerText"
        " .includes(text)", arg=COPY['es']['asset_attach_empty'])
    rows.append(cell(page, shots, 'asset', 'attachments', 'es', 1440, 'light',
                     'real asset attachment read on the isolated installation',
                     lambda: assert_asset_attachments(page, 'es')))
    rows.append(cell(page, shots, 'asset', 'attachments', 'en', 390, 'dark',
                     'asset attachment read, phone and dark',
                     lambda: assert_asset_attachments(page, 'en')))

    return rows


def drive(browser, base: str, shots: Path) -> list[str]:
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors: list[str] = []
    page = None
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        rows = run_chat(page, base, shots)
        assert not errors, f'page errors: {errors}'
        print('PAGEERRORS: 0')
        return rows
    finally:
        if page is not None:
            try:
                page.unroute_all(behavior='ignoreErrors')
            except Exception as error:  # noqa: BLE001 - teardown must not mask the run result
                print(f'TEARDOWN unroute: {error}')
        context.close()


def run() -> int:
    f.SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = f.SCRATCH / 'screenshots'
    shots.mkdir()
    print(f'SCRATCH {f.SCRATCH} (git-ignored verification root)')
    assert f.PYTHON.exists(), f.PYTHON
    owner, ports = f.Owned(), []
    rows: list[str] = []
    try:
        demo_dir = f.SCRATCH / 'conversation'
        env = dict(f.CLEAN_ENV)
        env['ITSM_BOOTSTRAP_PASSWORD'] = f.DEMO_PASSWORD
        env['RELEASE_MODE'] = 'demo'
        stdout = f.run_command(
            [str(f.PYTHON), '-m', 'itsm.demo', 'init', '--directory', str(demo_dir),
             '--username', f.DEMO_USERNAME],
            env, 'itsm.demo init',
        )
        payload = json.loads(stdout.strip().splitlines()[-1])
        assert payload.get('mode') == 'demo', payload
        print(f"SETUP conversation: itsm.demo init exit=0 dataset={payload.get('dataset')} "
              f'(password not printed)')
        api_env = f.isolated_state('conversation')
        api_env['ITSM_DATABASE_URL'] = payload['databaseUrl']
        api_env['RELEASE_MODE'] = 'demo'
        # The demo install counts every request against a small burst budget
        # (60 by default). A visual pass loads a fresh document per mocked
        # state, so the disposable install raises only that budget; every
        # other demo restriction and the real backend authorization stay.
        api_env['ITSM_DEMO_RATE_LIMIT_BURST'] = '100000'
        api_env['ITSM_DEMO_RATE_LIMIT_PER_MINUTE'] = '100000'
        api_env['ITSM_DEMO_LOGIN_RATE_BURST'] = '20'
        api_env['ITSM_DEMO_LOGIN_RATE_PER_MINUTE'] = '100'
        base, ports = f.start_servers(owner, 'conversation', api_env)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                rows = drive(browser, base, shots)
            finally:
                browser.close()
        print('\n=== RESULT ===')
        for row in rows:
            print(row)
        print(f'shots: {len(rows)} individually named PNG under {shots}')
        print('bounded scope: no full npm test/build, no provider call, no real message sent')
        return 0
    except Exception:
        print('DIAGNOSTICS conversation (owned process log tails):')
        print(owner.log_tails())
        raise
    finally:
        owner.stop()
        leaked = f.open_ports(ports)
        if leaked:
            print(f'CLEANUP conversation: LEAKED ports {leaked}')
            if sys.exc_info()[0] is None:
                raise RuntimeError(f'conversation ports still open after cleanup: {leaked}')
        else:
            print(f'CLEANUP conversation: owned processes stopped, ports {ports} released')


if __name__ == '__main__':
    sys.exit(run())
