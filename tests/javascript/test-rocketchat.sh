#!/bin/bash
# Test script for Rocket.Chat call graph indexing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
DB_NAME="rocketchat-test"
TEST_PROJECT="$PROJECT_ROOT/test-projects/rocketchat-test"

echo "🧪 Testing JavaScript Call Graph Indexing (Rocket.Chat)"
echo "========================================================"
echo ""

# Check if test project exists
if [ ! -d "$TEST_PROJECT" ]; then
    echo "📥 Cloning Rocket.Chat test project..."
    mkdir -p "$PROJECT_ROOT/test-projects"
    git clone --depth 1 https://github.com/RocketChat/Rocket.Chat.git "$TEST_PROJECT"
fi

# Check if CodeQL database exists
DB_EXISTS=false
if [ -d "$HOME/.codeql-mcp/databases/$DB_NAME" ]; then
    DB_EXISTS=true
    echo "✓ Database already exists"
else
    echo "🔨 Creating CodeQL database for Rocket.Chat..."
    codeql database create "$HOME/.codeql-mcp/databases/$DB_NAME" \
        --source-root="$TEST_PROJECT" \
        --language=javascript \
        --overwrite
    echo "✓ Database created"
    DB_EXISTS=true
fi

# Always ensure database is registered in MCP server's index
echo "📝 Registering database in MCP index..."
INDEX_FILE="$HOME/.codeql-mcp/databases/index.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

if [ ! -f "$INDEX_FILE" ]; then
    echo "[]" > "$INDEX_FILE"
fi

# Register using Python
python3 << PYTHON_EOF
import json
index_file = "$INDEX_FILE"
try:
    with open(index_file, 'r') as f:
        data = json.load(f)
except:
    data = []

# Remove existing entry if present
data = [db for db in data if db.get('name') != '$DB_NAME']

# Add new entry
data.append({
    'name': '$DB_NAME',
    'language': 'javascript',
    'path': '$HOME/.codeql-mcp/databases/$DB_NAME',
    'created': '$TIMESTAMP'
})

with open(index_file, 'w') as f:
    json.dump(data, f, indent=2)
PYTHON_EOF
echo "✓ Database registered"
echo ""

# Build the MCP server
echo "🔧 Building MCP server..."
npm run build > /dev/null 2>&1
echo "✓ Build complete"
echo ""

# Clean existing data
echo "🧹 Cleaning existing graph data..."
PGPASSWORD=codeql123 psql -h localhost -U codeql -d codeql_graph -c \
    "DELETE FROM function_calls WHERE database_name = '$DB_NAME'; 
     DELETE FROM class_methods WHERE database_name = '$DB_NAME';
     DELETE FROM functions WHERE database_name = '$DB_NAME';
     DELETE FROM classes WHERE database_name = '$DB_NAME';
     DELETE FROM variables WHERE database_name = '$DB_NAME';" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ Cleaned"
else
    echo "⚠ Warning: Could not clean existing data (continuing anyway)"
fi
echo ""

# Create test client
cat > "$PROJECT_ROOT/test-client.cjs" << 'EOF'
const { spawn } = require('child_process');

const dbName = process.argv[2] || 'rocketchat-test';

const server = spawn('node', ['build/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, PGPASSWORD: 'codeql123' },
  cwd: __dirname
});

let buffer = '';
let requestId = 0;
const pendingRequests = new Map();

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  
  lines.forEach(line => {
    if (line.trim() && !line.includes('CodeQL MCP server')) {
      try {
        const msg = JSON.parse(line);
        if (msg.result) {
          console.log(msg.result.content[0].text);
          const pending = pendingRequests.get(msg.id);
          if (pending) {
            pending.resolve(msg.result);
            pendingRequests.delete(msg.id);
          }
        } else if (msg.error) {
          console.error('Error:', msg.error);
          const pending = pendingRequests.get(msg.id);
          if (pending) {
            pending.reject(new Error(msg.error.message));
            pendingRequests.delete(msg.id);
          }
        }
      } catch (e) {}
    }
  });
});

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      id: ++requestId,
      method: method,
      params: params
    };
    pendingRequests.set(request.id, { resolve, reject });
    server.stdin.write(JSON.stringify(request) + '\n');
    
    // Timeout after 120 seconds for long operations
    setTimeout(() => {
      if (pendingRequests.has(request.id)) {
        pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }
    }, 120000);
  });
}

async function runTests() {
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('📊 Test 1/6: Building graph index...\n');
  await sendRequest('tools/call', {
    name: 'build_graph_index',
    arguments: { database_name: dbName }
  });
  
  console.log('\n📈 Test 2/6: Getting database statistics...\n');
  await sendRequest('tools/call', {
    name: 'get_graph_stats',
    arguments: { database_name: dbName }
  });
  
  console.log('\n🔍 Test 3/6: Finding functions matching "send"...\n');
  await sendRequest('tools/call', {
    name: 'find_function_graph',
    arguments: { database_name: dbName, function_name: 'send', limit: 10 }
  });
  
  console.log('\n📞 Test 4/6: Finding callers of "insert"...\n');
  await sendRequest('tools/call', {
    name: 'find_callers_graph',
    arguments: { database_name: dbName, function_name: 'insert' }
  });
  
  console.log('\n🎯 Test 5/6: Finding call chain from "create" to "save"...\n');
  await sendRequest('tools/call', {
    name: 'find_call_chain_graph',
    arguments: {
      database_name: dbName,
      from_function: 'create',
      to_function: 'save',
      max_depth: 5
    }
  });
  
  console.log('\n🏛️ Test 6/6: Finding functions with "message" in the name...\n');
  await sendRequest('tools/call', {
    name: 'find_function_graph',
    arguments: {
      database_name: dbName,
      function_name: 'message',
      limit: 15
    }
  });
  
  server.kill();
}

runTests();
EOF

# Run tests
echo "🚀 Running tests..."
echo ""
cd "$PROJECT_ROOT" && node test-client.cjs "$DB_NAME"

# Cleanup temporary files
rm -f "$PROJECT_ROOT/test-client.cjs"
rm -f "$PROJECT_ROOT"/*.cjs

echo ""
echo "✅ Rocket.Chat tests complete!"
