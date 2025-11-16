#!/bin/bash

set -e

echo "CodeQL MCP Server - Setup"
echo "========================="
echo ""

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=linux;;
    Darwin*)    MACHINE=osx;;
    *)          echo "❌ Unsupported OS: ${OS}"; exit 1;;
esac

CODEQL_VERSION="2.15.3"
INSTALL_DIR="$HOME/codeql"
CODEQL_REPO="$HOME/codeql-home"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install CodeQL CLI
echo "[1/5] Installing CodeQL CLI..."
if [ -f "${INSTALL_DIR}/codeql" ]; then
    echo "✓ Already installed"
else
    cd ~
    wget -q --show-progress "https://github.com/github/codeql-cli-binaries/releases/download/v${CODEQL_VERSION}/codeql-${MACHINE}64.zip"
    unzip -q "codeql-${MACHINE}64.zip"
    rm "codeql-${MACHINE}64.zip"
    echo "✓ Installed to ${INSTALL_DIR}"
fi

# Install CodeQL query libraries
echo ""
echo "[2/5] Installing CodeQL libraries..."
if [ -d "${CODEQL_REPO}" ]; then
    echo "✓ Already installed"
else
    cd ~
    git clone --depth 1 --branch "codeql-cli/v${CODEQL_VERSION}" https://github.com/github/codeql.git "${CODEQL_REPO}"
    echo "✓ Installed to ${CODEQL_REPO}"
fi

# Set up PATH
echo ""
echo "[3/5] Configuring environment..."
SHELL_RC="$HOME/.bashrc"
[ -n "$ZSH_VERSION" ] && SHELL_RC="$HOME/.zshrc"

if ! grep -q "HOME/codeql" "$SHELL_RC" 2>/dev/null; then
    echo "export PATH=\"\$HOME/codeql:\$PATH\"" >> "$SHELL_RC"
    echo "export CODEQL_HOME=\"\$HOME/codeql-home\"" >> "$SHELL_RC"
    echo "✓ Added to $SHELL_RC"
else
    echo "✓ Already configured"
fi
export PATH="$HOME/codeql:$PATH"
export CODEQL_HOME="$HOME/codeql-home"

# Install dependencies
echo ""
echo "[4/5] Installing dependencies..."
cd "$PROJECT_DIR"
npm install --silent

# Build
echo ""
echo "[5/5] Building project..."
npm run build

echo ""
echo "✓ Setup complete!"
echo ""
echo "Then: ./check-env.sh"
