#!/usr/bin/env bash
# Double-click this file in Finder to start the dashboard server and open
# it in your browser automatically — no need to open Terminal yourself
# first. Closing this Terminal window (or Ctrl+C) stops the server.

cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PORT=4173
URL="http://localhost:$PORT"

echo "Starting K-pop Dance Trends dashboard..."
echo "(Close this window, or press Ctrl+C, to stop the server when you're done.)"
echo

# Give the server a moment to actually bind to the port before opening the
# browser, so the tab doesn't load before there's anything to serve.
( sleep 1.5 && open "$URL" ) &

npm run serve
