#!/bin/bash
# Run all test scripts

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$PROJECT_ROOT")"

echo "🧪 Running All Call Graph Tests"
echo "================================"
echo ""

# Make scripts executable
chmod +x "$PROJECT_ROOT/javascript/test-rocketchat.sh"
chmod +x "$PROJECT_ROOT/python/test-flask.sh"

# Run JavaScript tests
echo "▶️  Running JavaScript tests (Rocket.Chat)..."
echo ""
"$PROJECT_ROOT/javascript/test-rocketchat.sh"

echo ""
echo "================================"
echo ""

# Run Python tests
echo "▶️  Running Python tests (Flask)..."
echo ""
"$PROJECT_ROOT/python/test-flask.sh"

echo ""
echo "================================"
echo ""
echo "✅ All tests complete!"
