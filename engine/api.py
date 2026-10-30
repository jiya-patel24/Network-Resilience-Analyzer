"""
api.py: dependency-free server (Python standard library only).
Serves the dashboard AND the analysis API from one port.

Run (inside /engine):   python api.py          then open http://127.0.0.1:8000
Optional port:          python api.py 8080
"""

import json
import os
import sys
import traceback
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from time import perf_counter

from graph import Graph
from tarjan import find_articulation_points
from generate_snapshots import build_snapshot_sequence, snapshot

DASH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard")
MAX_NODES = 2000
MAX_BODY = 5 * 1024 * 1024
ZONES = {"internet", "dmz", "internal", "data"}


class ApiError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _num(value, name, lo, hi, default):
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(422, f"'{name}' must be a number")
    return max(lo, min(hi, float(value)))


def build_graph(payload):
    """Validate an uploaded network and turn it into a Graph. Returns (graph, budget)."""
    if not isinstance(payload, dict):
        raise ApiError(422, "Body must be a JSON object with 'nodes' and 'edges'")
    nodes, edges = payload.get("nodes"), payload.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ApiError(422, "'nodes' and 'edges' must both be lists")
    if len(nodes) > MAX_NODES:
        raise ApiError(413, f"Too many nodes (max {MAX_NODES} for now)")
    budget = payload.get("budget", 15)
    if isinstance(budget, bool) or not isinstance(budget, int) or not (0 <= budget <= 100):
        raise ApiError(422, "'budget' must be a whole number between 0 and 100")

    g, ids = Graph(), set()
    for i, n in enumerate(nodes):
        if not isinstance(n, dict):
            raise ApiError(422, f"nodes[{i}] must be an object")
        nid = n.get("id")
        if isinstance(nid, bool) or not isinstance(nid, (int, str)) or nid == "":
            raise ApiError(422, f"nodes[{i}] needs an 'id' that is a number or a non-empty string")
        if nid in ids:
            raise ApiError(422, f"Duplicate node id: {nid}")
        zone = n.get("zone")
        if zone is not None and zone not in ZONES:
            raise ApiError(422, f"Node {nid}: zone must be one of {sorted(ZONES)} (or omitted)")
        ids.add(nid)
        g.add_node(
            nid,
            label=str(n.get("label") or f"Node {nid}"),
            role=str(n.get("role") or "server"),
            zone=zone,
            criticality=_num(n.get("criticality"), "criticality", 1, 10, 3),
            risk=_num(n.get("risk"), "risk", 0, 1, 0),
        )
    for i, e in enumerate(edges):
        if not isinstance(e, dict):
            raise ApiError(422, f"edges[{i}] must be an object with 'source' and 'target'")
        s, t = e.get("source"), e.get("target")
        if s not in ids or t not in ids:
            raise ApiError(422, f"Edge references an unknown node: {s} - {t}")
        g.add_edge(s, t)
    return g, budget


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".json": "application/json",
                      ".css": "text/css", ".html": "text/html"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DASH, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        try:
            if path == "/api/health":
                return self._json(200, {"status": "ok"})
            if path == "/api/snapshots":
                snaps, _, _, _ = build_snapshot_sequence()
                return self._json(200, snaps)
            if path.startswith("/api/"):
                return self._json(404, {"detail": "Unknown API route"})
        except Exception as exc:                      # never leave the browser hanging
            traceback.print_exc()
            return self._json(500, {"detail": f"Server error: {exc}"})
        return super().do_GET()                       # static dashboard files

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/analyze":
            return self._json(404, {"detail": "Unknown API route"})
        try:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "Bad Content-Length header")
            if length <= 0:
                raise ApiError(400, "Empty request body")
            if length > MAX_BODY:
                raise ApiError(413, "Upload too large (max 5 MB)")
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ApiError(400, "Body is not valid JSON")

            g, budget = build_graph(payload)
            t = perf_counter()
            critical = find_articulation_points(g)
            ms = (perf_counter() - t) * 1000
            snap = snapshot(g, critical, "Uploaded network", "baseline",
                            "Tarjan (iterative)", ms, None, budget)
            return self._json(200, snap)
        except ApiError as e:
            return self._json(e.status, {"detail": e.detail})
        except Exception as exc:
            traceback.print_exc()
            return self._json(500, {"detail": f"Server error: {exc}"})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving dashboard + API on http://127.0.0.1:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()