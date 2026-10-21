(function () {
  'use strict';

  // Deterministic force layout: positions are seeded from the node id, so the same
  // topology renders in the same place on every load. The simulation is pure data:
  // the view only reads positions and never depends on requestAnimationFrame.
  const MIN_DISTANCE = 112;
  const REPULSION = 34000;
  const SPRING_LENGTH = 148;
  const SPRING_STRENGTH = 0.035;
  const GROUP_PULL = 0.015;
  const CENTER_PULL = 0.0022;
  const DAMPING = 0.82;
  const MAX_SPEED = 14;

  function hash(value) {
    let result = 2166136261;
    const source = String(value || '');
    for (let index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return Math.abs(result);
  }

  function widthOf(width) {
    return Math.max(320, Number(width) || 900);
  }

  function heightOf(height) {
    return Math.max(260, Number(height) || 560);
  }

  function create(options) {
    const opts = options || {};
    const groupOf = typeof opts.groupOf === 'function' ? opts.groupOf : function () { return 'all'; };
    const nodes = (opts.nodes || []).map(function (node) {
      const seed = hash(node.id);
      return {
        id: node.id,
        data: node,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pinned: false,
        group: String(groupOf(node) || 'all'),
        angle: (seed % 360) * Math.PI / 180,
        radius: 40 + (seed % 90)
      };
    });
    const byId = {};
    nodes.forEach(function (node) { byId[node.id] = node; });
    const links = (opts.links || [])
      .filter(function (link) { return byId[link.from] && byId[link.to] && link.from !== link.to; })
      .map(function (link) {
        return { id: link.id, source: byId[link.from], target: byId[link.to], data: link };
      });

    const state = {
      nodes: nodes,
      links: links,
      width: widthOf(opts.width),
      height: heightOf(opts.height),
      alpha: 1,
      anchors: {}
    };

    function groupKeys() {
      const seen = [];
      nodes.forEach(function (node) {
        if (seen.indexOf(node.group) === -1) seen.push(node.group);
      });
      return seen.sort();
    }

    function computeAnchors() {
      const keys = groupKeys();
      const cx = state.width / 2;
      const cy = state.height / 2;
      const radius = Math.min(state.width, state.height) * 0.3;
      state.anchors = {};
      if (keys.length <= 1) {
        keys.forEach(function (key) { state.anchors[key] = { x: cx, y: cy }; });
        return;
      }
      keys.forEach(function (key, index) {
        const angle = (index / keys.length) * Math.PI * 2 - Math.PI / 2;
        state.anchors[key] = {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius
        };
      });
    }

    function seed() {
      computeAnchors();
      const grouped = {};
      nodes.forEach(function (node) {
        grouped[node.group] = grouped[node.group] || [];
        grouped[node.group].push(node);
      });
      Object.keys(grouped).forEach(function (key) {
        const anchor = state.anchors[key] || { x: state.width / 2, y: state.height / 2 };
        grouped[key].forEach(function (node, index) {
          const angle = node.angle + index * 2.399;
          const spread = 26 + node.radius * 0.55 * Math.sqrt(index + 1);
          node.x = anchor.x + Math.cos(angle) * spread;
          node.y = anchor.y + Math.sin(angle) * spread;
          node.vx = 0;
          node.vy = 0;
        });
      });
    }

    function step() {
      const cx = state.width / 2;
      const cy = state.height / 2;
      const alpha = state.alpha;
      nodes.forEach(function (node) {
        if (node.pinned) return;
        const anchor = state.anchors[node.group] || { x: cx, y: cy };
        node.vx += (anchor.x - node.x) * GROUP_PULL * alpha + (cx - node.x) * CENTER_PULL * alpha;
        node.vy += (anchor.y - node.y) * GROUP_PULL * alpha + (cy - node.y) * CENTER_PULL * alpha;
      });

      for (let a = 0; a < nodes.length; a += 1) {
        for (let b = a + 1; b < nodes.length; b += 1) {
          const first = nodes[a];
          const second = nodes[b];
          let dx = second.x - first.x;
          let dy = second.y - first.y;
          let distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 0.01) {
            dx = 1;
            dy = 0;
            distance = 1;
          }
          const force = (REPULSION / (distance * distance)) * alpha;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          if (!first.pinned) { first.vx -= fx; first.vy -= fy; }
          if (!second.pinned) { second.vx += fx; second.vy += fy; }
          if (distance < MIN_DISTANCE) {
            const push = (MIN_DISTANCE - distance) * 0.5;
            const px = (dx / distance) * push;
            const py = (dy / distance) * push;
            if (!first.pinned) { first.x -= px; first.y -= py; }
            if (!second.pinned) { second.x += px; second.y += py; }
          }
        }
      }

      links.forEach(function (link) {
        const source = link.source;
        const target = link.target;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (distance - SPRING_LENGTH) * SPRING_STRENGTH * alpha;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        if (!source.pinned) { source.vx += fx; source.vy += fy; }
        if (!target.pinned) { target.vx -= fx; target.vy -= fy; }
      });

      nodes.forEach(function (node) {
        if (node.pinned) {
          node.vx = 0;
          node.vy = 0;
          return;
        }
        node.vx *= DAMPING;
        node.vy *= DAMPING;
        const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        if (speed > MAX_SPEED) {
          node.vx = (node.vx / speed) * MAX_SPEED;
          node.vy = (node.vy / speed) * MAX_SPEED;
        }
        node.x += node.vx;
        node.y += node.vy;
        const padX = 64;
        const padY = 56;
        if (node.x < padX) { node.x = padX; node.vx = Math.abs(node.vx) * 0.4; }
        if (node.x > state.width - padX) { node.x = state.width - padX; node.vx = -Math.abs(node.vx) * 0.4; }
        if (node.y < padY) { node.y = padY; node.vy = Math.abs(node.vy) * 0.4; }
        if (node.y > state.height - padY) { node.y = state.height - padY; node.vy = -Math.abs(node.vy) * 0.4; }
      });

      state.alpha = Math.max(0.004, state.alpha * 0.985);
      return state.alpha;
    }

    function settle(maxSteps) {
      const limit = Math.max(1, Number(maxSteps) || 260);
      for (let index = 0; index < limit; index += 1) {
        step();
        if (state.alpha <= 0.01) break;
      }
      return state;
    }

    function reheat(alpha) {
      state.alpha = Math.max(0.35, Math.min(1, Number(alpha) || 0.8));
    }

    function resize(width, height) {
      const nextWidth = widthOf(width);
      const nextHeight = heightOf(height);
      if (nextWidth === state.width && nextHeight === state.height) return false;
      const scaleX = nextWidth / state.width;
      const scaleY = nextHeight / state.height;
      state.width = nextWidth;
      state.height = nextHeight;
      nodes.forEach(function (node) {
        node.x *= scaleX;
        node.y *= scaleY;
      });
      computeAnchors();
      return true;
    }

    function pin(id, x, y) {
      const node = byId[id];
      if (!node) return null;
      node.pinned = true;
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
      return node;
    }

    function release(id) {
      const node = byId[id];
      if (!node) return null;
      node.pinned = false;
      return node;
    }

    function nodeById(id) {
      return byId[id] || null;
    }

    function bounds() {
      const width = state.width;
      const height = state.height;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      nodes.forEach(function (node) {
        minX = Math.min(minX, node.x - 52);
        minY = Math.min(minY, node.y - 44);
        maxX = Math.max(maxX, node.x + 52);
        maxY = Math.max(maxY, node.y + 64);
      });
      if (!isFinite(minX)) return { x: 0, y: 0, width: width, height: height };
      return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }

    seed();

    return {
      state: state,
      nodes: nodes,
      links: links,
      step: step,
      settle: settle,
      reheat: reheat,
      resize: resize,
      pin: pin,
      release: release,
      nodeById: nodeById,
      bounds: bounds,
      groupKeys: groupKeys,
      get alpha() { return state.alpha; }
    };
  }

  window.AssetGraphLayout = {
    create: create,
    hash: hash
  };
})();
