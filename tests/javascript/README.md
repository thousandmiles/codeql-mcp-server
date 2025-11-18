# JavaScript/TypeScript Tests

Tests for JavaScript and TypeScript call graph indexing using Rocket.Chat.

## Test Script

- **`test-rocketchat.sh`** - Comprehensive test suite for JavaScript/TypeScript

## What It Tests

1. **Graph Index Building** - Extracts functions, calls, and classes from Rocket.Chat
2. **Statistics** - Database metrics and hot spot analysis
3. **Function Search** - Fuzzy matching for function names
4. **Caller Analysis** - Finding all call sites for specific functions
5. **Call Chain Discovery** - Path finding between functions
6. **Function Search** - Additional pattern matching tests

## Usage

```bash
./test-rocketchat.sh
```

## Test Project

Uses Rocket.Chat (open-source team communication platform) as a real-world TypeScript application for testing.
Automatically clones from: https://github.com/RocketChat/Rocket.Chat.git

## Expected Results

- Thousands of functions indexed
- Complex call graphs with message handling, user management, etc.
- Full TypeScript support with modern patterns
- Real-world chat application architecture
