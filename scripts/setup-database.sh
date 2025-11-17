#!/bin/bash

set -e

echo "PostgreSQL Graph Database Setup"
echo "================================"
echo ""

POSTGRES_DB="codeql_graph"
POSTGRES_USER="codeql"
POSTGRES_PASSWORD="codeql123"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if PostgreSQL is installed
echo "[1/5] Checking PostgreSQL installation..."
if ! command -v psql &> /dev/null; then
    echo "PostgreSQL not found. Installing..."
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get update
        sudo apt-get install -y postgresql postgresql-contrib
        sudo systemctl start postgresql
        sudo systemctl enable postgresql
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install postgresql@15
        brew services start postgresql@15
    else
        echo "❌ Unsupported OS. Please install PostgreSQL manually."
        exit 1
    fi
    echo "✓ PostgreSQL installed"
else
    echo "✓ PostgreSQL already installed"
fi

# Ensure PostgreSQL is running
echo ""
echo "[2/5] Starting PostgreSQL service..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    sudo systemctl status postgresql &> /dev/null || sudo systemctl start postgresql
    echo "✓ PostgreSQL service running"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    brew services list | grep "postgresql.*started" &> /dev/null || brew services start postgresql@15
    echo "✓ PostgreSQL service running"
fi

# Create database and user
echo ""
echo "[3/5] Creating database and user..."

# Check if database exists
if sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$POSTGRES_DB"; then
    echo "✓ Database '$POSTGRES_DB' already exists"
else
    sudo -u postgres psql -c "CREATE DATABASE $POSTGRES_DB;" 2>/dev/null || true
    echo "✓ Created database '$POSTGRES_DB'"
fi

# Check if user exists
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$POSTGRES_USER'" | grep -q 1; then
    echo "✓ User '$POSTGRES_USER' already exists"
else
    sudo -u postgres psql -c "CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || true
    echo "✓ Created user '$POSTGRES_USER'"
fi

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;" 2>/dev/null || true
sudo -u postgres psql -d "$POSTGRES_DB" -c "GRANT ALL ON SCHEMA public TO $POSTGRES_USER;" 2>/dev/null || true
echo "✓ Granted privileges"

# Install extensions
echo ""
echo "[4/5] Installing PostgreSQL extensions..."
sudo -u postgres psql -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;" 2>/dev/null || true
echo "✓ Installed pg_trgm extension"

# Initialize schema
echo ""
echo "[5/5] Initializing database schema..."
if [ -f "$SCRIPT_DIR/schema.sql" ]; then
    PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U $POSTGRES_USER -d $POSTGRES_DB -f "$SCRIPT_DIR/schema.sql" > /dev/null 2>&1
    echo "✓ Schema initialized"
else
    echo "⚠️  schema.sql not found, skipping schema initialization"
fi

# Test connection
echo ""
echo "Testing connection..."
if PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✓ Connection successful"
else
    echo "❌ Connection failed"
    exit 1
fi

echo ""
echo "✓ PostgreSQL setup complete!"
echo ""
echo "Connection Details:"
echo "  Database: $POSTGRES_DB"
echo "  User:     $POSTGRES_USER"
echo "  Password: $POSTGRES_PASSWORD"
echo "  Host:     localhost"
echo "  Port:     5432"
echo ""
echo "Connection String:"
echo "  postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost/$POSTGRES_DB"
echo ""
echo "Next: npm install (to add pg dependency)"
