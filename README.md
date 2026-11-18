# @mavericks78/event-replay

[![npm version](https://img.shields.io/npm/v/%40mavericks78%2Fevent-replay)](https://www.npmjs.com/package/@mavericks78/event-replay)
[![CI](https://github.com/sohamdhande/event-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/sohamdhande/event-replay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A small, dependency-free, framework-agnostic JavaScript event-history engine. It records application events and uses a developer-supplied pure reducer to reconstruct application state, navigate backward and forward through history, undo and redo changes, and export or import event timelines as versioned JSON.

> **Scope note:** `@mavericks78/event-replay` is an application state and domain-event history engine. It is **not** a browser session recorder and does not capture DOM mutations, screenshots, mouse movements, clicks, keystrokes, or network traffic.

## Problem Being Solved

When debugging or supporting a stateful application, inspecting only the latest state snapshot rarely explains *how* the application reached that state. Mutating state in place discards the sequence of transitions that led there, making undo/redo, time-travel inspection, and bug reproduction difficult to implement reliably.

`@mavericks78/event-replay` stores an immutable, validated sequence of application events and reconstructs state deterministically with your reducer. Given the same initial state, reducer, and event log, you can step to any point in history or replay an exported event log elsewhere to reproduce the exact state.

## Why Use It?

- **Plain JavaScript (ES Modules):** No TypeScript toolchain or build step required.
- **Zero runtime dependencies:** Uses only standard ECMAScript features.
- **Framework-agnostic:** Works in Node.js and browser bundles without prescribing a UI library or state container.
- **Strict JSON data integrity:** Rejects non-JSON values, circular references, accessor getters, and prototype-pollution keys up front instead of silently dropping or coercing data.
- **Atomic operations:** Failed dispatches, replays, seeks, and imports never corrupt existing history or cursor state.
- **Defensive isolation:** Internal state and event logs are deeply copied so external mutations cannot corrupt stored history.

## Features

- Record validated domain events with `type`, `payload`, `timestamp`, and optional `meta`.
- Reconstruct state at any historical position via deterministic replay.
- Navigate timelines with `undo()`, `redo()`, `seek(position)`, and `replay()`.
- Discard and replace the future timeline automatically when dispatching after seeking backward.
- Export and import portable, versioned JSON documents (`format: "event-replay"`, `version: 1`).
- Key-order-independent JSON equivalence checking for `initialState` on import.
- Prototype-pollution defense (`__proto__`, `constructor`, and `prototype` keys are rejected; getters are never invoked during validation).

## Requirements

- **Node.js 22 or newer** (or any modern ES-module-capable JavaScript runtime).
- **Pure, deterministic reducer** supplied by the caller.
- **Supported JSON data types only** for `initialState`, `event.payload`, `event.meta` values, and reducer return values:
  - **Supported:** `null`, booleans (`true`, `false`), finite numbers (excluding `NaN`, `Infinity`, `-Infinity`; `-0` is normalized to `0`), strings, plain dense arrays, and plain objects (`Object.prototype` or `null` prototype) with enumerable data properties.
  - **Rejected:** `undefined`, `NaN`, `Infinity`, `-Infinity`, `BigInt`, functions, symbols, symbol-keyed properties, non-enumerable properties, accessor properties (getters/setters), circular references, sparse arrays, arrays with extra own properties, `Array` subclasses, `Map`, `Set`, `WeakMap`, `WeakSet`, `Date`, `RegExp`, `Error`, `Promise`, `ArrayBuffer` / TypedArrays, boxed primitives (`new Number`, `new String`, `new Boolean`), custom class instances, objects with `toJSON()` methods, and forbidden keys (`__proto__`, `constructor`, `prototype`).

## Installation

Install from [npm](https://www.npmjs.com/package/@mavericks78/event-replay):

```bash
npm install @mavericks78/event-replay
```

## Quick Start

```js
import { createReplay } from "@mavericks78/event-replay";

const history = createReplay({
  initialState: { count: 0 },
  reducer(state, event) {
    switch (event.type) {
      case "increment":
        return { count: state.count + event.payload.amount };
      case "decrement":
        return { count: state.count - event.payload.amount };
      default:
        throw new Error(`Unknown event type: ${event.type}`);
    }
  }
});

history.dispatch({ type: "increment", payload: { amount: 3 } });
history.dispatch({ type: "increment", payload: { amount: 2 } });

console.log(history.getState()); // { count: 5 }
console.log(history.undo());     // { count: 3 }
console.log(history.redo());     // { count: 5 }
console.log(history.seek(0));    // { count: 0 }
console.log(history.replay());   // { count: 5 }
```

## API Reference

### `createReplay({ initialState, reducer })`

Creates a new event-history instance bound to an initial state and a pure reducer.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `options` | `object` | Yes | Configuration object containing `initialState` and `reducer`. |
| `options.initialState` | Supported JSON value | Yes | State before any events are applied. Deeply validated and copied. |
| `options.reducer` | `(state, event) => nextState` | Yes | Pure, deterministic function computing the next state from defensive copies of the current state and event. |

#### Returns

A replay instance object exposing `dispatch`, `getState`, `getEvents`, `getPosition`, `getLength`, `seek`, `undo`, `redo`, `replay`, `canUndo`, `canRedo`, `export`, and `import`.

#### Errors

- Throws `TypeError` if `options` is not a non-null, non-array object.
- Throws `TypeError` if `reducer` is not a function or is an accessor property.
- Throws `TypeError` if `initialState` is omitted, is an accessor property, or contains unsupported JSON data.

---

### `dispatch(event)`

Validates an event, runs the reducer against defensive copies of the current state and event, validates the resulting state, appends the event to the active timeline, and advances the cursor.

#### Parameters

| Property | Type | Required | Description |
|---|---|---:|---|
| `event` | Plain `object` | Yes | Event descriptor. Only the documented keys below are allowed. |
| `event.type` | `string` | Yes | Non-empty string (must contain non-whitespace characters). |
| `event.payload` | Supported JSON value | No | Event data passed to the reducer. Defaults to `null` when omitted. Explicit `undefined` is rejected. |
| `event.timestamp` | Finite `number` | No | Timestamp in milliseconds. Defaults to `Date.now()` when omitted. |
| `event.meta` | Plain JSON `object` | No | Optional custom event metadata (e.g., actor, correlation ID, source). Preserved when provided. |

#### Returns

A defensive copy of the resulting state.

#### Errors

- Throws `TypeError` if `event` is not a plain object, contains unknown or forbidden properties, contains getters/symbols/non-enumerable properties, has an invalid `type`, `payload`, `timestamp`, or `meta`, or if the reducer returns unsupported JSON data.
- Re-throws any error thrown by the reducer.
- **Atomicity:** If validation fails, the reducer throws, or the reducer returns invalid data, existing state, events, and cursor position remain unchanged.

---

### `getState()`

Returns a defensive copy of the state at the current cursor position.

- **Parameters:** None.
- **Returns:** Defensive copy of the current state.

---

### `getEvents()`

Returns a defensive copy of the events currently stored in the active timeline.

- **Parameters:** None.
- **Returns:** Array of cloned event objects (`{ type, payload, timestamp }` and optional `meta`).

---

### `getPosition()`

Returns the current cursor position as a non-negative integer.

- **Parameters:** None.
- **Returns:** Integer from `0` (initial state) to `getLength()` inclusive.

---

### `getLength()`

Returns the total number of events currently stored in the timeline.

- **Parameters:** None.
- **Returns:** Non-negative integer.

---

### `seek(position)`

Moves the cursor to `position` and reconstructs state by replaying events from `initialState` through event `position`.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `position` | `number` | Yes | Integer between `0` and `getLength()` inclusive. `0` restores `initialState`. |

#### Returns

A defensive copy of the state at `position`.

#### Errors

- Throws `RangeError` if `position` is not an integer or is outside `[0, getLength()]`.
- Throws `TypeError` or re-throws reducer errors if replay fails.
- **Atomicity:** If replay fails, the previously stored state and cursor position are preserved.

---

### `undo()`

Moves the cursor backward by one event, clamping at position `0` (the initial state). Safe to call on an empty history or when already at position `0`.

- **Parameters:** None.
- **Returns:** Defensive copy of the state at the new position.
- **Errors:** Re-throws reducer errors or `TypeError` if replay fails, leaving prior state and cursor intact.

---

### `redo()`

Moves the cursor forward by one event, clamping at `getLength()` (the end of the timeline). Safe to call on an empty history or when already at the end.

- **Parameters:** None.
- **Returns:** Defensive copy of the state at the new position.
- **Errors:** Re-throws reducer errors or `TypeError` if replay fails, leaving prior state and cursor intact.

---

### `replay()`

Reconstructs the final state by replaying every event in the current timeline from `initialState`, moving the cursor to `getLength()`.

- **Parameters:** None.
- **Returns:** Defensive copy of the reconstructed final state.
- **Errors:** Re-throws reducer errors or `TypeError` if replay fails, leaving prior state and cursor intact.

---

### `canUndo()`

Returns `true` if `getPosition() > 0`, otherwise `false`.

- **Parameters:** None.
- **Returns:** `boolean`.

---

### `canRedo()`

Returns `true` if `getPosition() < getLength()`, otherwise `false`.

- **Parameters:** None.
- **Returns:** `boolean`.

---

### `export()`

Serializes the timeline and cursor into a portable, versioned JSON string.

- **Parameters:** None.
- **Returns:** JSON string with structure:

```json
{
  "format": "event-replay",
  "version": 1,
  "initialState": { "count": 0 },
  "events": [
    {
      "type": "increment",
      "payload": { "amount": 3 },
      "timestamp": 1700000000000
    }
  ],
  "position": 1
}
```

---

### `import(serialized)`

Validates and loads an exported timeline document into the current instance while retaining the instance's reducer.

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---:|---|
| `serialized` | `string \| object` | Yes | JSON string produced by `export()` or an equivalent parsed plain object. |

#### Returns

A defensive copy of the state at the imported cursor `position`.

#### Errors

- Throws `TypeError` if `serialized` is empty, malformed JSON, not a plain object, missing required fields (`format`, `version`, `initialState`, `events`, `position`), contains unexpected or forbidden keys, uses an unsupported format/version, contains invalid events (imported events must include `type`, `payload`, and finite numeric `timestamp`), or has an `initialState` that is not deeply equal to this instance's `initialState` (object key ordering may differ).
- Throws `RangeError` if `position` is not an integer between `0` and `events.length` inclusive.
- Re-throws reducer errors or `TypeError` if any event in the imported timeline fails validation during full replay.
- **Atomicity:** A failed import leaves the existing instance's state, events, and cursor completely untouched. No arbitrary code is ever executed from imported data.

## Usage Examples

### Undo and Redo Example

```js
import { createReplay } from "@mavericks78/event-replay";

const editor = createReplay({
  initialState: { text: "" },
  reducer(state, event) {
    switch (event.type) {
      case "append":
        return { text: state.text + event.payload.value };
      case "clear":
        return { text: "" };
      default:
        throw new Error(`Unknown event: ${event.type}`);
    }
  }
});

editor.dispatch({ type: "append", payload: { value: "Hello" }, meta: { user: "alice" } });
editor.dispatch({ type: "append", payload: { value: " world" }, meta: { user: "alice" } });

console.log(editor.getState()); // { text: 'Hello world' }
console.log(editor.canUndo());  // true
console.log(editor.undo());     // { text: 'Hello' }
console.log(editor.canRedo());  // true
console.log(editor.redo());     // { text: 'Hello world' }
```

### Timeline Replacement Behavior

`@mavericks78/event-replay` maintains **one active linear timeline**. It does **not** maintain persistent parallel branches. If you seek backward (or undo) and dispatch a new event, all events after the current cursor are discarded and replaced by the new event:

```js
import { createReplay } from "@mavericks78/event-replay";

const history = createReplay({
  initialState: { steps: [] },
  reducer(state, event) {
    if (event.type === "add") {
      return { steps: [...state.steps, event.payload] };
    }
    throw new Error(`Unknown event: ${event.type}`);
  }
});

history.dispatch({ type: "add", payload: "A" });
history.dispatch({ type: "add", payload: "B" });
history.dispatch({ type: "add", payload: "C" });

history.seek(1);                                 // { steps: ['A'] }
history.dispatch({ type: "add", payload: "X" }); // Discards 'B' and 'C'

console.log(history.getState());  // { steps: ['A', 'X'] }
console.log(history.getLength()); // 2
console.log(history.canRedo());   // false
```

### Export and Import Example

```js
import { createReplay } from "@mavericks78/event-replay";

function reducer(state, event) {
  switch (event.type) {
    case "deposit":
      return { balance: state.balance + event.payload.amount };
    case "withdraw":
      return { balance: state.balance - event.payload.amount };
    default:
      throw new Error(`Unknown event: ${event.type}`);
  }
}

const source = createReplay({ initialState: { balance: 100 }, reducer });
source.dispatch({ type: "deposit", payload: { amount: 50 }, timestamp: 1700000001000 });
source.dispatch({ type: "withdraw", payload: { amount: 20 }, timestamp: 1700000002000 });
source.seek(1);

const json = source.export();

const target = createReplay({ initialState: { balance: 100 }, reducer });
console.log(target.import(json));    // { balance: 150 }
console.log(target.getPosition());   // 1
console.log(target.getLength());     // 2
console.log(target.replay());        // { balance: 130 }
```

### Included Example Script

Run the bundled counter example:

```bash
node examples/counter.js
```

Expected output:

```text
Current: { count: 3 }
After undo: { count: 5 }
After redo: { count: 3 }
At start: { count: 0 }
Full replay: { count: 3 }
```

## Limitations

- **JSON-only data model:** Only supported JSON values may be stored in state, payloads, and `meta`. Non-JSON objects (`Date`, `Map`, `Set`, `RegExp`, class instances, functions, `BigInt`, `undefined`, etc.) are rejected rather than silently transformed.
- **Pure deterministic reducers required:** Reducers must not read wall-clock time, generate random values, perform I/O, or depend on mutable external state. Compute non-deterministic values before calling `dispatch()` and include them in the event payload.
- **Single active linear timeline:** Dispatching after seeking backward discards the previous future timeline; persistent multi-branch history trees are not supported.
- **Manual event dispatching:** `@mavericks78/event-replay` does not observe objects or record DOM/browser interactions automatically. Applications must call `dispatch()` explicitly.
- **No reducer serialization:** `export()` serializes only data (initial state, events, cursor). The importing instance must supply a compatible reducer and an equivalent `initialState`.

## Performance Considerations

- `dispatch()` applies only the single incoming event to the current state: `O(S + E)` where `S` is the size of the state and `E` is the size of the event (for validation and defensive copying).
- `seek(n)`, `undo()`, `redo()`, and `replay()` reconstruct state by replaying events from `initialState` through the target position: `O(n * S)` where `n` is the target cursor position.
- Boundary no-ops (`undo()` at position `0` and `redo()` at `getLength()`) return a defensive copy of the current state without replaying the timeline.
- `import()` replays the full imported timeline once to validate every event atomically before updating the instance.
- For very large histories (tens of thousands of events or very large state trees), keep state snapshots compact or periodically checkpoint/compact your event log at the application layer.

## Running Tests

`@mavericks78/event-replay` uses Node.js's built-in test runner (`node:test`) and strict assertions (`node:assert/strict`) with zero external test dependencies.

```bash
npm run check           # Syntax check source, tests, and example
npm test                # Run full test suite
npm run test:coverage   # Run test suite with Node.js coverage report
node examples/counter.js
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines and development checks before opening a pull request.

## License

MIT. See [LICENSE](./LICENSE).
