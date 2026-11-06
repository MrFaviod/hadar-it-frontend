#!/usr/bin/env python3
"""Bounded READ-only layout proof of `#/configuracion/mantenimiento` (U12).

Resolves the earlier ambiguous observation from the operations settings visit:
"the category/interval columns look crowded on the Spanish desktop cell". A
painted-text measurement on the Spanish 1440 cell proved three rows whose
category label was painted into the interval column; the acceptance here is now
zero painted-text collisions, one declared grid track per real child cell and no
unused trailing track, on the same two cells.

This proof is read-only on purpose:

* one fresh isolated installation (own SQLite file, loopback API + Vite,
  process environment only, no `.env`, no provider or device access);
* two cells only, the ones the observation named: `es` 1440 light and
  `en` 390 dark;
* the route is opened through the real application and its canonical settings
  reads are awaited before anything is measured;
* no Vue injection, no route mock, no template or preference write, no button
  click other than the product's own theme toggle and the product's own i18n
  API (the same pattern the existing configuration proofs use);
* every rendered label/control of the maintenance settings surface is measured
  from its native box: containment in the owning card, containment in the page,
  and intersections between boxes that are not ancestor/descendant pairs;
* full-page screenshots are kept at native size and cropped into bands plus a
  targeted category/interval crop, so the judgement is made on images, not only
  on numbers.

The installation seeds 14 maintenance templates and 5 maintenance types, so the
row geometry is measured on real rows without any template or type write. Only
the two named cells are opened; other viewports and states are not claimed.

Usage: python3 tests/ui-config-maintenance-layout.browser.py
"""

from __future__ import annotations

import importlib.util
import sys
import uuid
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader, f"cannot import {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The operations proof already owns the maintenance section visit; reuse its
# module chain (documents visual -> shared disposable fixture) instead of
# duplicating the installation, server and cleanup lifecycle.
ops = _load(Path(__file__).with_name("ui-config-operations.browser.py"), "config_operations")
v = ops.v  # ui-documents-visual: capture/record/fail/require/body_text/CATALOG/BASE
fixture = ops.fixture
PYTHON, BACKEND, FRONTEND = ops.PYTHON, ops.BACKEND, ops.FRONTEND
USERNAME, PASSWORD = ops.USERNAME, ops.PASSWORD
CATALOG = v.CATALOG

SCRATCH = FRONTEND / ".verification" / ("ui-config-maintenance-layout-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = ops.RESULTS, ops.FAILURES

ROUTE = "#/configuracion/mantenimiento"
MARKER = ".maint-settings"
CELLS = [("es", 1440, 1000, "light"), ("en", 390, 844, "dark")]

# Canonical reads the section cannot be considered settled without.
SETTINGS_READS = ("/api/v1/inventory/config", "/api/v1/maintenance/templates")

MEASURE = r"""
() => {
  const out = {
    cells: [], overlaps: [], parentChildPairs: 0, errors: [],
    cardCount: 0, tableCount: 0, templateRowCount: 0, typeRowCount: 0,
    templateGrid: '', templateHeadCount: 0, typeGrid: '', typeHeadCount: 0,
    scrollY: window.scrollY, scrollX: window.scrollX,
    pageWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    devicePixelRatio: window.devicePixelRatio
  };
  const root = document.querySelector('.maint-settings');
  if (!root) { out.errors.push('missing .maint-settings'); return out; }
  const cards = Array.prototype.slice.call(root.querySelectorAll('.maint-settings-block'));
  out.cardCount = cards.length;
  const rect = (el) => {
    const b = el.getBoundingClientRect();
    return {
      x: +(b.x + window.scrollX).toFixed(2), y: +(b.y + window.scrollY).toFixed(2),
      w: +b.width.toFixed(2), h: +b.height.toFixed(2)
    };
  };
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0.5 && b.height > 0.5;
  };
  const tag = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\s+/).join('.') : '');
  };
  const cardOf = (el) => {
    const card = el.closest('.maint-settings-block');
    return card ? cards.indexOf(card) : -1;
  };
  // The painted text box, not the grid box: a cell can clip or spill its glyphs
  // while its own border box stays inside the track.
  const textBox = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const b = range.getBoundingClientRect();
    return {
      x: +(b.x + window.scrollX).toFixed(2), y: +(b.y + window.scrollY).toFixed(2),
      w: +b.width.toFixed(2), h: +b.height.toFixed(2)
    };
  };
  const targets = [];
  const push = (key, el) => { targets.push({ key: key, el: el }); };
  const tables = Array.prototype.slice.call(root.querySelectorAll('.maint-config-table'));
  out.tableCount = tables.length;
  out.templateRowCount = tables[0] ? tables[0].querySelectorAll('.maint-config-table__row').length : 0;
  out.typeRowCount = tables[1] ? tables[1].querySelectorAll('.maint-config-table__row').length : 0;
  out.rows = [];
  if (tables[0]) {
    const head = tables[0].querySelector('.maint-config-table__head');
    out.templateGrid = head ? getComputedStyle(head).gridTemplateColumns : '';
    out.templateHeadCount = head ? head.children.length : 0;
    Array.prototype.slice.call(head ? head.children : []).forEach((el, i) => push('templates.head[' + i + ']', el));
    Array.prototype.slice.call(tables[0].querySelectorAll('.maint-config-table__row')).forEach((row, i) => {
      const cells = Array.prototype.slice.call(row.children);
      const entry = { index: i, cells: [] };
      ['category', 'interval', 'actions'].forEach((name, offset) => {
        const cell = cells[offset + 1];
        if (!cell) return;
        push('templates.row[' + i + '].' + name, cell);
        const box = rect(cell);
        const painted = textBox(cell);
        entry.cells.push({
          name: name, rect: box, painted: painted,
          text: (cell.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          clientWidth: +cell.clientWidth.toFixed(2),
          scrollWidth: +cell.scrollWidth.toFixed(2),
          overflowX: +(cell.scrollWidth - cell.clientWidth).toFixed(2)
        });
      });
      out.rows.push(entry);
    });
  }
  if (tables[1]) {
    const head = tables[1].querySelector('.maint-config-table__head');
    out.typeGrid = head ? getComputedStyle(head).gridTemplateColumns : '';
    out.typeHeadCount = head ? head.children.length : 0;
    Array.prototype.slice.call(head ? head.children : []).forEach((el, i) => push('types.head[' + i + ']', el));
  }
  const tableData = (table) => {
    if (!table) return null;
    const head = table.querySelector('.maint-config-table__head');
    const headCells = head ? Array.prototype.slice.call(head.children) : [];
    const rows = Array.prototype.slice.call(table.querySelectorAll('.maint-config-table__row'));
    const rowInfo = rows.map((row, i) => {
      const cs = getComputedStyle(row);
      const cells = Array.prototype.slice.call(row.children);
      return {
        index: i,
        rect: rect(row),
        grid: cs.gridTemplateColumns,
        gap: parseFloat(cs.columnGap) || 0,
        paddingRight: parseFloat(cs.paddingRight) || 0,
        cells: cells.map((cell, j) => ({
          index: j,
          rect: rect(cell),
          painted: textBox(cell),
          overflowX: +(cell.scrollWidth - cell.clientWidth).toFixed(2),
          text: (cell.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
        })),
        buttons: Array.prototype.slice.call(row.querySelectorAll('button')).map((btn) => ({
          rect: rect(btn),
          text: (btn.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
        }))
      };
    });
    return {
      rect: rect(table),
      grid: head ? getComputedStyle(head).gridTemplateColumns : (rowInfo[0] ? rowInfo[0].grid : ''),
      headVisible: head ? shown(head) : false,
      headCount: headCells.length,
      headWidths: headCells.map((el) => +rect(el).w.toFixed(2)),
      rowCount: rows.length,
      rows: rowInfo
    };
  };
  out.tables = { templates: tableData(tables[0]), types: tableData(tables[1]) };
  Array.prototype.slice.call(root.querySelectorAll('.field')).forEach((el, i) => push('field[' + i + ']', el));
  Array.prototype.slice.call(root.querySelectorAll('.field__label')).forEach((el, i) => push('fieldLabel[' + i + ']', el));
  Array.prototype.slice.call(root.querySelectorAll('.field select, .field input, .field textarea, .field .select-field'))
    .forEach((el, i) => push('control[' + i + ']', el));
  Array.prototype.slice.call(root.querySelectorAll('.maint-switch')).forEach((el, i) => push('switch[' + i + ']', el));
  Array.prototype.slice.call(root.querySelectorAll('.maint-switch input')).forEach((el, i) => push('switchInput[' + i + ']', el));
  Array.prototype.slice.call(root.querySelectorAll('.maint-config-form__foot button')).forEach((el, i) => push('footButton[' + i + ']', el));
  const visible = [];
  targets.forEach((entry) => {
    const isShown = shown(entry.el);
    const box = rect(entry.el);
    const index = cardOf(entry.el);
    const card = index >= 0 ? rect(cards[index]) : null;
    const row = {
      key: entry.key, tag: tag(entry.el),
      text: (entry.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      visible: isShown, rect: box, cardIndex: index, card: card
    };
    if (isShown && card) {
      row.insideCard = box.x >= card.x - 0.5 && box.y >= card.y - 0.5 &&
        box.x + box.w <= card.x + card.w + 0.5 && box.y + box.h <= card.y + card.h + 0.5;
      row.insidePage = box.x >= -0.5 && box.x + box.w <= out.pageWidth + 0.5;
    }
    out.cells.push(row);
    if (isShown) visible.push({ key: entry.key, el: entry.el, rect: box });
  });
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i];
      const b = visible[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) { out.parentChildPairs += 1; continue; }
      const w = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      const h = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      if (w > 0.5 && h > 0.5) {
        out.overlaps.push({
          a: a.key, b: b.key, w: +w.toFixed(2), h: +h.toFixed(2), area: +(w * h).toFixed(2)
        });
      }
    }
  }
  return out;
}
"""

MEASURED: dict[str, dict] = {}
DEFECTS: dict[str, list[dict]] = {}
LEDGER: dict[str, object] = {"requests": [], "responses": []}


def crop_png(source: Path, dest: Path, box: dict) -> tuple[int, int]:
    from PIL import Image

    with Image.open(source) as image:
        left = max(0, int(round(box["x"])))
        top = max(0, int(round(box["y"])))
        right = min(image.width, int(round(box["x"] + box["w"])))
        bottom = min(image.height, int(round(box["y"] + box["h"])))
        if right <= left or bottom <= top:
            return (0, 0)
        image.crop((left, top, right, bottom)).save(dest)
        return (right - left, bottom - top)


def band_crops(source: Path) -> list[str]:
    from PIL import Image

    produced: list[str] = []
    with Image.open(source) as image:
        count = 3
        for index in range(count):
            top = index * image.height // count
            bottom = image.height if index == count - 1 else (index + 1) * image.height // count
            dest = source.with_name(source.stem + f"-band{index + 1}.png")
            image.crop((0, top, image.width, bottom)).save(dest)
            produced.append(f"{dest.name} {image.width}x{bottom - top}")
    return produced


PHASE = ["start"]

def attach_ledger(page) -> None:
    requests: list[dict] = LEDGER["requests"]  # type: ignore[assignment]
    responses: list[dict] = LEDGER["responses"]  # type: ignore[assignment]

    def on_request(request) -> None:
        requests.append({"method": request.method, "url": request.url, "phase": PHASE[0]})

    def on_response(response) -> None:
        responses.append({"status": response.status, "url": response.url, "phase": PHASE[0]})

    page.on("request", on_request)
    page.on("response", on_response)


def path_of(url: str) -> str:
    marker = "/api/v1"
    index = url.find(marker)
    return url[index:] if index >= 0 else url


def check_cell(page, locale: str, theme: str, width: int) -> str:
    label = f"mantenimiento {locale} {width} {theme}"
    page.evaluate("() => window.scrollTo(0, 0)")
    v.settle(page)
    data = page.evaluate(MEASURE)
    MEASURED[f"{locale}-{width}-{theme}"] = data

    for error in data["errors"]:
        v.fail(f"{label}: measurement error {error}")

    v.require(data["cardCount"] > 0, f"{label}: no .maint-settings-block owner cards")
    v.require(data["tableCount"] == 2, f"{label}: expected 2 config tables, saw {data['tableCount']}")
    v.require(data["scrollWidth"] - data["pageWidth"] <= 1,
              f"{label}: horizontal overflow {data['scrollWidth'] - data['pageWidth']}px")

    visible = [row for row in data["cells"] if row["visible"]]
    v.require(len(visible) >= 8, f"{label}: only {len(visible)} visible measured boxes")

    for row in visible:
        if row["cardIndex"] < 0:
            v.fail(f"{label}: {row['key']} has no owning card")
            continue
        if not row.get("insideCard"):
            v.fail(f"{label}: {row['key']} escapes its card {row['rect']} vs {row['card']}")
        if not row.get("insidePage"):
            v.fail(f"{label}: {row['key']} escapes the page {row['rect']} page={data['pageWidth']}")

    if data["overlaps"]:
        for item in data["overlaps"]:
            v.fail(f"{label}: {item['a']} overlaps {item['b']} by {item['area']}px2")

    # Every real child must own exactly one declared track, and the last cell
    # must end at the row content edge. A leftover track (or a missing one) is
    # what pushed the category label into the interval column, so the geometry
    # is asserted instead of inferred from the screenshot.
    collisions: list[dict] = []
    stacked_rows = 0
    side_by_side_rows = 0
    worst_overflow = 0.0
    trailing: dict[str, float] = {}
    for table_name in ("templates", "types"):
        table = data["tables"][table_name]
        if not table or not table["rowCount"]:
            v.fail(f"{label}: {table_name} table has no measured rows")
            continue
        if table["headVisible"]:
            head_tracks = [part for part in table["grid"].split() if part]
            v.require(
                len(head_tracks) == table["headCount"],
                f"{label}: {table_name} header declares {len(head_tracks)} grid tracks "
                f"for {table['headCount']} cells ({table['grid']})",
            )
        for row in table["rows"]:
            tracks = [part for part in row["grid"].split() if part]
            cells = row["cells"]
            if len(tracks) == 1:
                # Narrow breakpoint: one stacked column, header hidden.
                stacked_rows += 1
            else:
                side_by_side_rows += 1
                v.require(
                    len(tracks) == len(cells),
                    f"{label}: {table_name} row[{row['index']}] declares {len(tracks)} grid "
                    f"tracks for {len(cells)} cells ({row['grid']})",
                )
                last = cells[-1]
                content_right = row["rect"]["x"] + row["rect"]["w"] - row["paddingRight"]
                unused = round(content_right - (last["rect"]["x"] + last["rect"]["w"]), 2)
                trailing[table_name] = max(trailing.get(table_name, 0.0), abs(unused))
                v.require(
                    abs(unused) <= 1.5,
                    f"{label}: {table_name} row[{row['index']}] leaves {unused}px between "
                    f"the last cell and the row content edge",
                )
            # Painted text, not the border box: a cell with min-width 0 can spill
            # its glyphs over the next column while its own box stays in place.
            for cell in cells:
                painted = cell["painted"]
                worst_overflow = max(worst_overflow, cell["overflowX"])
                if painted["w"] <= 0:
                    continue
                following = cells[cell["index"] + 1] if cell["index"] + 1 < len(cells) else None
                # Only a horizontally adjacent cell can be collided with; below the
                # narrow breakpoint the next cell starts at the same x, one row down.
                adjacent = (following is not None
                            and following["rect"]["x"] >= cell["rect"]["x"] + cell["rect"]["w"] - 1.0)
                left_spill = round(cell["rect"]["x"] - painted["x"], 2)
                right_spill = round(painted["x"] + painted["w"] -
                                    (cell["rect"]["x"] + cell["rect"]["w"]), 2)
                into_next = (round(painted["x"] + painted["w"] - following["rect"]["x"], 2)
                             if adjacent else 0.0)
                spill = max(left_spill, right_spill, into_next)
                if spill > 1.0:
                    collisions.append({
                        "table": table_name, "row": row["index"], "cell": cell["index"],
                        "text": cell["text"],
                        "next": following["text"] if following is not None else "",
                        "spill": spill, "overflow": cell["overflowX"],
                        "cellWidth": cell["rect"]["w"], "paintedWidth": painted["w"],
                    })
            # Every action stays inside the actions cell and inside its row.
            actions = cells[-1]
            for button in row["buttons"]:
                box = button["rect"]
                contained = (
                    box["x"] >= actions["rect"]["x"] - 0.5
                    and box["x"] + box["w"] <= actions["rect"]["x"] + actions["rect"]["w"] + 0.5
                    and box["y"] >= row["rect"]["y"] - 0.5
                    and box["y"] + box["h"] <= row["rect"]["y"] + row["rect"]["h"] + 0.5
                )
                v.require(
                    contained,
                    f"{label}: {table_name} row[{row['index']}] action {button['text']!r} "
                    f"escapes its actions cell {box} vs {actions['rect']}",
                )

    for item in collisions:
        v.fail(
            f"{label}: {item['table']} row[{item['row']}] cell[{item['cell']}] text "
            f"{item['text']!r} paints {item['spill']}px outside its cell into "
            f"{item['next']!r}; cell={item['cellWidth']}px painted={item['paintedWidth']}px "
            f"overflowX={item['overflow']}px"
        )
    rows_measured = sum(table["rowCount"] for table in data["tables"].values() if table)
    v.require(
        not collisions,
        f"{label}: {len(collisions)} painted-text collisions across {rows_measured} rows",
    )
    if width < 640:
        v.require(stacked_rows == rows_measured,
                  f"{label}: expected every row stacked at {width}px, got "
                  f"stacked={stacked_rows} sideBySide={side_by_side_rows}")
    else:
        v.require(stacked_rows == 0,
                  f"{label}: {stacked_rows} rows collapsed to one column at {width}px")

    for table_name in ("templates", "types"):
        table = data["tables"][table_name]
        if not table:
            continue
        v.record(
            f"HEAD {label}: table={table_name} headVisible={table['headVisible']} "
            f"headCells={table['headCount']} widths={[round(value, 1) for value in table['headWidths']]} "
            f"grid={table['grid']} "
            f"rowTracks={[len([part for part in row['grid'].split() if part]) for row in table['rows'][:3]]} "
            f"unusedTrailing={round(trailing.get(table_name, 0.0), 2)}px rows={table['rowCount']}"
        )
    if not collisions:
        v.record(
            f"NO_DEFECT {label}: 0 painted-text collisions across {rows_measured} rows; "
            f"stackedRows={stacked_rows} worst overflow {worst_overflow}px"
        )
    DEFECTS.setdefault(label, collisions)


    # Stored business labels must be exactly the shipped catalog strings. The
    # narrow breakpoint hides the table head with `display: none`, so a hidden
    # header is verified from its own DOM text and recorded as hidden rather
    # than treated as a missing label.
    texts = {row["key"]: row["text"] for row in data["cells"]}
    expected = {
        "templates.head[0]": CATALOG[locale]["ui.maintenance.settings.col_template"],
        "templates.head[1]": CATALOG[locale]["ui.maintenance.field.category"],
        "templates.head[2]": CATALOG[locale]["ui.maintenance.settings.col_interval"],
        "templates.head[3]": CATALOG[locale]["ui.maintenance.settings.col_state"],
        "types.head[0]": CATALOG[locale]["ui.maintenance.field.type"],
        "types.head[1]": CATALOG[locale]["ui.maintenance.settings.col_usage"],
        "types.head[2]": CATALOG[locale]["ui.maintenance.settings.col_effect"],
    }
    checked_labels = 0
    hidden_labels = 0
    for key, wanted in expected.items():
        if key not in texts:
            v.fail(f"{label}: {key} is absent from the DOM, stored label {wanted!r} unverified")
            continue
        v.require(texts[key] == wanted,
                  f"{label}: {key} text {texts[key]!r} != stored label {wanted!r}")
        checked_labels += 1
        row = next(item for item in data["cells"] if item["key"] == key)
        if not row["visible"]:
            hidden_labels += 1

    # The prefs form is the only form rendered in the READ state; its label
    # strings must also match the stored catalog.
    pref_labels = [CATALOG[locale]["ui.maintenance.settings.initial_view"],
                   CATALOG[locale]["ui.maintenance.settings.show_completed"]]
    body = v.body_text(page)
    for needle in pref_labels:
        v.require(needle in body, f"{label}: stored preference label missing {needle!r}")
        checked_labels += 1

    category = next((row for row in data["cells"] if row["key"] == "templates.head[1]"), None)
    interval = next((row for row in data["cells"] if row["key"] == "templates.head[2]"), None)
    category_state = "hidden" if category is None or not category["visible"] else f"{category['rect']}"
    interval_state = "hidden" if interval is None or not interval["visible"] else f"{interval['rect']}"
    return (
        f"visible={len(visible)} cards={data['cardCount']} rows={data['templateRowCount']} "
        f"types={data['typeRowCount']} overlaps=0 parentChildPairs={data['parentChildPairs']} "
        f"labels={checked_labels} hiddenLabels={hidden_labels} "
        f"category={category_state} interval={interval_state} "
        f"rowTextCollisions={len(collisions)} stackedRows={stacked_rows} "
        f"trailingEmpty={trailing} grid={data['templateGrid']}"
    )


def crop_pass(page, shots: Path) -> None:
    """Re-open each cell and derive native crops from its full-page capture."""
    for locale, width, height, theme in CELLS:
        page.set_viewport_size({"width": width, "height": height})
        v.open_route(page, ROUTE, MARKER)
        v.set_locale(page, locale)
        v.set_theme(page, theme)
        v.settle(page)
        data = page.evaluate(MEASURE)
        source = shots / f"config-mantenimiento-{locale}-{width}-{theme}.png"
        if not source.exists():
            v.fail(f"crop pass: missing capture {source.name}")
            continue
        for produced in band_crops(source):
            v.record(f"BAND {locale} {width} {theme} {produced}")

        head_cells = [row for row in data["cells"]
                      if row["key"].startswith("templates.head[") and row["visible"]]
        if len(head_cells) >= 3:
            span = head_cells[1:3]
            left = min(row["rect"]["x"] for row in span) - 8
            right = max(row["rect"]["x"] + row["rect"]["w"] for row in span) + 8
            top = min(row["rect"]["y"] for row in span) - 8
            bottom = max(row["rect"]["y"] + row["rect"]["h"] for row in span) + 8
            box = {"x": left, "y": top, "w": right - left, "h": bottom - top}
            dest = shots / f"config-mantenimiento-{locale}-{width}-{theme}-category-interval.png"
            size = crop_png(source, dest, box)
            v.require(size[0] > 0 and size[1] > 0,
                      f"category/interval crop empty for {locale} {width} {theme}")
            v.record(
                f"CROP {dest.name} {size[0]}x{size[1]} native-width "
                f"region=category+interval locale={locale} viewport={width} "
                f"boxes={[row['rect'] for row in span]}"
            )
        else:
            v.record(
                f"CROP category-interval unavailable locale={locale} viewport={width}: "
                f"header not rendered ({len(head_cells)} visible head cells); "
                f"responsive rule hides .maint-config-table__head below the breakpoint"
            )

        table = next((row for row in data["cells"] if row["key"] == "templates.head[0]"), None)
        if table is not None and table["card"] is not None:
            box = {"x": table["card"]["x"], "y": table["card"]["y"] + 60,
                   "w": table["card"]["w"], "h": max(60.0, table["card"]["h"] - 60)}
            dest = shots / f"config-mantenimiento-{locale}-{width}-{theme}-templates-block.png"
            size = crop_png(source, dest, box)
            if size[0] > 0 and size[1] > 0:
                v.record(f"CROP {dest.name} {size[0]}x{size[1]} region=templates-block")

        rows = data["tables"]["templates"]["rows"] if data["tables"]["templates"] else []
        if rows:
            # Native crops of the category and interval columns over the real
            # data rows, split in halves so each image stays legible and every
            # row (including the three that used to collide) is covered.
            half = (len(rows) + 1) // 2
            for part, chunk in (("a", rows[:half]), ("b", rows[half:])):
                if not chunk:
                    continue
                left = min(row["cells"][1]["rect"]["x"] for row in chunk) - 8
                right = max(row["cells"][2]["rect"]["x"] + row["cells"][2]["rect"]["w"]
                            for row in chunk) + 8
                top = min(row["rect"]["y"] for row in chunk) - 6
                bottom = max(row["rect"]["y"] + row["rect"]["h"] for row in chunk) + 6
                box = {"x": left, "y": top, "w": right - left, "h": bottom - top}
                dest = shots / (f"config-mantenimiento-{locale}-{width}-{theme}"
                                f"-rows-{part}-category-interval.png")
                size = crop_png(source, dest, box)
                v.require(size[0] > 0 and size[1] > 0,
                          f"category/interval row crop empty for {locale} {width} {theme} {part}")
                v.record(
                    f"CROP {dest.name} {size[0]}x{size[1]} native-width "
                    f"region=category+interval locale={locale} viewport={width} "
                    f"rows={[row['index'] for row in chunk]} "
                    f"categories={[row['cells'][1]['text'] for row in chunk]} "
                    f"cellWidths={[row['cells'][1]['rect']['w'] for row in chunk][:1]} "
                    f"paintedWidths={[row['cells'][1]['painted']['w'] for row in chunk]}"
                )


def zoom_attempt(context, page) -> None:
    """Try a real browser-supported 200% zoom; never fake it with a CSS transform."""
    before = page.evaluate(
        "() => ({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth,"
        " dpr: window.devicePixelRatio, visual: (window.visualViewport || {}).scale || 1})"
    )
    detail = []
    reflowed = False
    try:
        client = context.new_cdp_session(page)
        client.send("Emulation.setPageScaleFactor", {"pageScaleFactor": 2})
        page.wait_for_timeout(200)
        after = page.evaluate(
            "() => ({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth,"
            " dpr: window.devicePixelRatio, visual: (window.visualViewport || {}).scale || 1})"
        )
        detail.append(f"Emulation.setPageScaleFactor(2) -> {after}")
        reflowed = after["innerWidth"] != before["innerWidth"]
        client.send("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
        client.detach()
    except Exception as exc:  # noqa: BLE001 - capability probe, reported as evidence
        detail.append(f"Emulation.setPageScaleFactor failed: {type(exc).__name__}: {exc}")

    try:
        page.keyboard.press("Control++")
        page.wait_for_timeout(200)
        keyed = page.evaluate(
            "() => ({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth})"
        )
        detail.append(f"Control++ keypress -> {keyed}")
        reflowed = reflowed or keyed["innerWidth"] != before["innerWidth"]
    except Exception as exc:  # noqa: BLE001 - capability probe, reported as evidence
        detail.append(f"Control++ keypress failed: {type(exc).__name__}: {exc}")

    v.record(
        f"ZOOM_200 before={before} reflow={reflowed} detail={'; '.join(detail)}"
    )
    if reflowed:
        v.record("ZOOM_200 a real layout zoom reflow was observed; not used for the native proof cells")
    else:
        v.record(
            "ZOOM_200 UNAVAILABLE: this headless Chromium exposes no browser layout-zoom setting "
            "(page scale factor is visual-only, the Control++ shortcut is renderer-scoped). "
            "No CSS transform or viewport substitution was used, and no tooling was installed."
        )


def ledger_check() -> None:
    requests: list[dict] = LEDGER["requests"]  # type: ignore[assignment]
    responses: list[dict] = LEDGER["responses"]  # type: ignore[assignment]
    writes = [item for item in requests if item["method"] not in ("GET", "HEAD", "OPTIONS")]
    setup = [item for item in writes if item["phase"] == "login"]
    runtime = [item for item in writes if item["phase"] != "login"]
    workspace_puts = [item for item in runtime if item["method"] == "PUT" and "/workspace" in item["url"]]
    maintenance_writes = [item for item in writes if "/maintenance/" in item["url"]]
    other_writes = [item for item in runtime if item not in workspace_puts]
    failed = [item for item in responses
              if item["status"] >= 400 and item["phase"] != "login"
              and path_of(item["url"]).startswith("/api/v1")]
    phases: dict[str, int] = {}
    for item in workspace_puts:
        phases[item["phase"]] = phases.get(item["phase"], 0) + 1
    v.record(f"LEDGER requests={len(requests)} setup_writes={len(setup)} "
             f"runtime_writes={len(runtime)} workspace_PUT={len(workspace_puts)} "
             f"maintenance_writes={len(maintenance_writes)} api_errors={len(failed)}")
    for item in setup:
        v.record(f"LEDGER setup write {item['method']} {path_of(item['url'])}")
    for item in workspace_puts:
        v.record(f"LEDGER separate workspace write PUT {path_of(item['url'])} phase={item['phase']}")
    v.record("LEDGER workspace_PUT by phase: " +
             (", ".join(f"{name}={count}" for name, count in sorted(phases.items())) or "none"))
    for item in other_writes:
        v.fail(f"LEDGER unexpected write {item['method']} {path_of(item['url'])} phase={item['phase']}")
    for item in maintenance_writes:
        v.fail(f"LEDGER maintenance write {item['method']} {path_of(item['url'])}")
    for item in failed:
        v.fail(f"LEDGER api error {item['status']} {path_of(item['url'])} phase={item['phase']}")

    for needle in SETTINGS_READS:
        hits = [item for item in responses
                if path_of(item["url"]).startswith(needle) and item["status"] == 200]
        v.require(bool(hits), f"LEDGER canonical read {needle} never returned 200")
    v.record("LEDGER canonical reads settled: " + ", ".join(SETTINGS_READS))


def scenario(browser, shots: Path) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    attach_ledger(page)
    PHASE[0] = "login"
    fixture.login(page, v.BASE, USERNAME, PASSWORD)
    try:
        for locale, width, height, theme in CELLS:
            name = f"{locale}-{width}-{theme}"
            PHASE[0] = name + ":open"
            page.set_viewport_size({"width": width, "height": height})
            v.open_route(page, ROUTE, MARKER)
            PHASE[0] = name + ":locale"
            v.set_locale(page, locale)
            PHASE[0] = name + ":theme"
            v.set_theme(page, theme)
            PHASE[0] = name + ":settle"
            v.settle(page)
            PHASE[0] = name + ":measure"
            detail = check_cell(page, locale, theme, width)
            PHASE[0] = name + ":shot"
            v.shot(page, shots, "config-mantenimiento", ROUTE, locale, width, height, theme, detail)
        PHASE[0] = "crops"
        crop_pass(page, shots)
        PHASE[0] = "zoom"
        page.set_viewport_size({"width": 1440, "height": 1000})
        v.open_route(page, ROUTE, MARKER)
        v.set_locale(page, "es")
        v.set_theme(page, "light")
        v.settle(page)
        zoom_attempt(context, page)
        PHASE[0] = "ledger"
        ledger_check()
        v.require(not errors, f"page errors: {errors}")
        v.record("CONFIG_MAINTENANCE_PROOF pageerrors=0")
    finally:
        context.close()


def main() -> int:
    SCRATCH.mkdir(parents=True, exist_ok=False)
    shots = SCRATCH / "screenshots"
    shots.mkdir()
    print(f"SCRATCH {SCRATCH} (git-ignored verification root)")
    print(f"ENV scrubbed {len(fixture.DROPPED_KEYS)} inherited keys: "
          f"{', '.join(sorted(fixture.DROPPED_KEYS)) or 'none'}")
    for path in (PYTHON, BACKEND, FRONTEND / "node_modules"):
        assert path.exists(), path

    owner, ports = fixture.Owned(), []
    failed = False
    try:
        database_dir = SCRATCH / "ordinary"
        database_dir.mkdir(parents=True, exist_ok=True)
        database = database_dir / "maintenance-layout.db"
        api_env = fixture.isolated_state("ordinary")
        api_env["ITSM_DATABASE_URL"] = "sqlite+pysqlite:///" + str(database)
        api_env["RELEASE_MODE"] = "prod"
        cli_env = dict(api_env)
        cli_env["ITSM_BOOTSTRAP_PASSWORD"] = PASSWORD
        fixture.run_command([str(PYTHON), "-m", "alembic", "upgrade", "head"], cli_env,
                            "alembic upgrade head")
        fixture.run_command(
            [str(PYTHON), "-m", "itsm.identity.cli", "bootstrap-superadmin",
             "--username", USERNAME, "--name", "UI maintenance layout install"],
            cli_env, "bootstrap-superadmin",
        )
        print(f"SETUP migrations exit=0 bootstrap-superadmin exit=0 db={database}")

        v.BASE, ports = fixture.start_servers(owner, "maintenance-layout", api_env)
        with fixture.sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                scenario(browser, shots)
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001 - diagnostics, then re-raise
        failed = True
        print(f"EXCEPTION {type(exc).__name__}: {exc}")
        print("DIAGNOSTICS (owned process log tails):")
        print(owner.log_tails(30))
        raise
    finally:
        owner.stop()
        leaked = fixture.open_ports(ports)
        if leaked:
            print(f"CLEANUP LEAKED ports {leaked}")
            if sys.exc_info()[0] is None:
                failed = True
        else:
            print(f"CLEANUP owned processes stopped, ports {ports} released")

    print()
    print(f"rows={len(RESULTS)} failures={len(FAILURES)} "
          f"screenshots={len(list(shots.glob('*.png')))}")
    print(f"screenshots: {shots}")
    print(f"logs: {SCRATCH / 'logs'}")
    if FAILURES:
        print("FAILURES:")
        for item in FAILURES:
            print(f"- {item}")
        return 1
    total = sum(len(items) for items in DEFECTS.values())
    if total:
        print(f"RESULT proof completed; confirmed layout defects={total}")
        for label, items in DEFECTS.items():
            print(f"- {label}: {len(items)} rows with category text painted into the interval column")
    else:
        print("RESULT maintenance settings layout proof passed; confirmed layout defects=0")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
