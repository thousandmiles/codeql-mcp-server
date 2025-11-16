#!/bin/bash

# Environment Check Script for CodeQL MCP Server
# Verifies that all prerequisites are installed and configured

echo "🔍 CodeQL MCP Server - Environment Check"
echo "=========================================="
echo ""

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js found: $NODE_VERSION"
    
    # Check if version is >= 18
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [ "$NODE_MAJOR" -ge 18 ]; then
        echo "   Version is sufficient (>= 18)"
    else
        echo "⚠️  Node.js version should be >= 18"
    fi
else
    echo "❌ Node.js not found - install from https://nodejs.org"
    exit 1
fi
echo ""

# Check npm
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ npm found: $NPM_VERSION"
else
    echo "❌ npm not found"
    exit 1
fi
echo ""

# Check CodeQL
echo "Checking CodeQL CLI..."
if command -v codeql &> /dev/null; then
    CODEQL_VERSION=$(codeql version | head -1)
    echo "✅ CodeQL found: $CODEQL_VERSION"
else
    echo "❌ CodeQL CLI not found"
    echo "   Install from: https://github.com/github/codeql-cli-binaries/releases"
    echo "   Or run: ./install.sh"
    exit 1
fi
echo ""

# Check if project is built
echo "Checking project build..."
if [ -f "build/index.js" ]; then
    echo "✅ Project is built"
else
    echo "⚠️  Project not built - run: npm run build"
fi
echo ""

# Check dependencies
echo "Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "✅ Dependencies installed"
else
    echo "⚠️  Dependencies not installed - run: npm install"
fi
echo ""

# Summary
echo "Environment check complete!"

