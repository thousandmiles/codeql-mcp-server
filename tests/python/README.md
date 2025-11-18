# Python Tests

Tests for Python call graph indexing using Flask framework.

## Test Script

- **`test-flask.sh`** - Comprehensive test suite for Python

## What It Tests

1. **Graph Index Building** - Extracts functions, calls, and classes from Flask
2. **Statistics** - Database metrics and hot spot analysis
3. **Function Search** - Fuzzy matching for function names
4. **Caller Analysis** - Finding all call sites for specific functions
5. **Call Chain Discovery** - Path finding between functions
6. **Class Hierarchy** - Inheritance and method analysis

## Usage

```bash
./test-flask.sh
```

## Test Project

Uses Flask web framework as a real-world Python codebase for testing.
Automatically clones from: https://github.com/pallets/flask.git

## Expected Results

- Hundreds of functions indexed
- Thousands of function calls
- Class hierarchy with Flask application classes
- Full call graph with Python-specific patterns
