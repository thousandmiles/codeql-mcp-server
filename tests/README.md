# CodeQL MCP Server Tests

This directory contains test scripts for validating the call graph indexing functionality, organized by language.

## Directory Structure

```
tests/
├── javascript/
│   ├── README.md             # JavaScript test documentation
│   └── test-rocketchat.sh    # JavaScript/TypeScript tests (Rocket.Chat)
├── python/
│   ├── README.md             # Python test documentation
│   └── test-flask.sh         # Python tests (Flask)
├── README.md                 # This file
└── test-all.sh               # Runs all language tests
```

## Usage

### Run Individual Language Tests

```bash
# Test JavaScript/TypeScript
./tests/javascript/test-rocketchat.sh

# Test Python
./tests/python/test-flask.sh
```

### Run All Tests

````bash
./tests/test-all.sh
```## What the Tests Do

Each test script performs 6 comprehensive tests:

1. **Setup**: Clones the test project if not present (Rocket.Chat or Flask)
2. **Database Creation**: Creates a CodeQL database if needed
3. **Test 1/6 - Build Graph Index**: Extracts and indexes all functions, calls, and classes
4. **Test 2/6 - Get Statistics**: Retrieves database stats and identifies hot spots
5. **Test 3/6 - Find Functions**: Tests fuzzy function name search
6. **Test 4/6 - Find Callers**: Finds all call sites for a specific function
7. **Test 5/6 - Find Call Chain**: Discovers call paths between two functions
8. **Test 6/6 - Class Hierarchy**: Gets inheritance tree and class methods

All 6 graph-based MCP tools are tested!

## Test Projects

Test projects are automatically cloned to `../test-projects/`:

- `rocketchat-test` - Rocket.Chat messaging platform (JavaScript/TypeScript, ~22,931 functions)
- `flask-test` - Flask web framework (Python, ~1,510 functions)

These directories are gitignored and won't be committed.

## Cleanup

The test scripts automatically clean up temporary `.cjs` files after execution.
````
