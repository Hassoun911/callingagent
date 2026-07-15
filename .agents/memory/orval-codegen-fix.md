---
name: Orval Codegen Fix
description: How to fix the orval 8.9.1 codegen failure caused by @scalar/json-magic readFiles() failing under jiti
---

## The Rule

In `lib/api-spec/orval.config.mjs`, always pre-parse the OpenAPI YAML using the `yaml` package and pass the parsed object as `target` — never pass a file path string.

**Why:** orval 8.9.1 uses `@scalar/json-magic` to load the spec. Its `readFiles()` plugin uses `await import('node:fs/promises')` which fails silently under orval's `jiti` execution context (dynamic ESM import is intercepted). The `resolveInput()` function throws "Failed to resolve input: Please provide a valid string value or pass a loader to process the input" because `result.ok` is false. When `target` is already an object (not a string), `resolveInput()` returns it directly, bypassing all file-reading logic.

**How to apply:** Any time you edit `lib/api-spec/orval.config.mjs`, keep the pre-parse pattern:
```js
import { readFileSync } from "fs";
import YAML from "yaml";
const spec = { ...YAML.parse(readFileSync(specPath, "utf-8")), info: { title: "Api" } };
// Then use: input: { target: spec }
```
`yaml` must be a devDependency of `@workspace/api-spec`. Also: any unquoted description string containing `: ` in the OpenAPI YAML will cause a BLOCK_AS_IMPLICIT_KEY parse error — always quote such descriptions.
