#!/usr/bin/env bash
# Usage: ./check-port.sh [port]   (default: 8080)
PORT=${1:-8080}

INFO=$(lsof -i tcp:"$PORT" -sTCP:LISTEN -P -n 2>/dev/null)

if [ -n "$INFO" ]; then
  echo "Port $PORT is IN USE"
  echo ""
  echo "$INFO"
  exit 1
else
  echo "Port $PORT is free"
fi
