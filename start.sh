#!/bin/bash
set -euo pipefail

# ─── RTSP Viewer - Start Script ───────────────────────────
echo ""
echo "  ⬡  RTSP VIEWER"
echo "  ─────────────────────────────"

# Check mediamtx exists
if [ ! -f "./mediamtx" ]; then
  echo "  ✗ mediamtx not found!"
  echo "  Run setup.sh first."
  exit 1
fi

cleanup() {
  echo ""
  echo "  Stopping..."
  kill "${MTX_PID:-}" "${HTTP_PID:-}" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

# Stop stale local instances to avoid port conflicts
pkill -x mediamtx 2>/dev/null || true
pkill -f "python3 -m http.server 3000" 2>/dev/null || true
sleep 1

# Start mediamtx in background
echo "  ► Starting mediamtx..."
./mediamtx > mediamtx.log 2>&1 &
MTX_PID=$!
sleep 2

if ! kill -0 "$MTX_PID" 2>/dev/null; then
  echo "  ✗ mediamtx failed to start"
  echo "  ── mediamtx.log ──"
  cat mediamtx.log
  exit 1
fi

# Start HTTP server for the viewer
echo "  ► Starting web server on port 3000..."
python3 -m http.server 3000 &
HTTP_PID=$!
sleep 1

echo "  ─────────────────────────────"
echo "  ✓ mediamtx running   (PID $MTX_PID)"
echo "  ✓ Web server running (PID $HTTP_PID)"
echo ""
echo "  Open: http://localhost:3000"
echo ""
echo "  Press Ctrl+C to stop everything"
echo "  ─────────────────────────────"

wait "$MTX_PID" "$HTTP_PID"