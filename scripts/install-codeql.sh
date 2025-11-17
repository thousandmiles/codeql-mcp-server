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

CODEQL_VERSION="2.23.5"
INSTALL_DIR="$HOME/codeql"
CODEQL_REPO="$HOME/codeql-home"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
echo "[4/6] Installing dependencies..."
cd "$PROJECT_ROOT"
npm install --silent

# Build
echo ""
echo "[5/6] Building project..."
npm run build

# Install query pack dependencies
echo ""
echo "[6/6] Installing CodeQL query pack dependencies..."
cd "$PROJECT_ROOT/queries/export/javascript"
codeql pack install --silent 2>/dev/null || codeql pack install
cd "$PROJECT_ROOT/queries/export/python"
codeql pack install --silent 2>/dev/null || codeql pack install
echo "✓ Query packs installed"

echo ""
echo "✓ Setup complete!"
echo ""
echo "Installation Paths:"
echo "  CodeQL CLI:      ${INSTALL_DIR}/codeql"
echo "  CodeQL Home:     ${CODEQL_REPO}"
echo "  CodeQL Version:  ${CODEQL_VERSION}"
echo ""
echo "Next: ./check-env.sh"
