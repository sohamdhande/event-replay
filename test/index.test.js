import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createReplay } from "../src/index.js";

function counterReducer(state, event) {
  switch (event.type) {
    case "increment":
      return { count: state.count + event.payload.amount };
    case "decrement":
      return { count: state.count - event.payload.amount };
    case "reset":
      return { count: 0 };
    default:
      throw new Error(`Unknown event type: ${event.type}`);
  }
}

function makeCounter(initialState = { count: 0 }) {
  return createReplay({
    initialState,
    reducer: counterReducer
  });
}

describe("A. Initialization", () => {
  test("valid initialization with plain object initial state", () => {
    const history = makeCounter({ count: 10 });
    assert.deepEqual(history.getState(), { count: 10 });
    assert.deepEqual(history.getEvents(), []);
    assert.equal(history.getPosition(), 0);
    assert.equal(history.getLength(), 0);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
  });

  test("supports null, number, string, boolean, and array initial states", () => {
    const identity = (state, event) => event.payload;

    for (const initialState of [null, 0, 42, -3.5, "", "hello", false, true, [], [1, "a", null]]) {
      const history = createReplay({ initialState, reducer: identity });
      assert.deepEqual(history.getState(), initialState);
    }
  });

  test("rejects missing or non-object options", () => {
    assert.throws(() => createReplay(), TypeError);
    assert.throws(() => createReplay(null), TypeError);
    assert.throws(() => createReplay(42), TypeError);
    assert.throws(() => createReplay("invalid"), TypeError);
    assert.throws(() => createReplay([]), TypeError);
  });

  test("rejects missing or invalid reducer", () => {
    for (const reducer of [undefined, null, 123, "fn", {}, []]) {
      assert.throws(
        () => createReplay({ initialState: { count: 0 }, reducer }),
        { name: "TypeError", message: /reducer/i }
      );
    }
  });

  test("rejects missing or undefined initialState", () => {
    assert.throws(
      () => createReplay({ reducer: counterReducer }),
      { name: "TypeError", message: /initialState/i }
    );
    assert.throws(
      () => createReplay({ initialState: undefined, reducer: counterReducer }),
      { name: "TypeError", message: /undefined/i }
    );
  });

  test("rejects unsupported initialState values", () => {
    const circular = {};
    circular.self = circular;

    class CustomClass {
      constructor() {
        this.value = 1;
      }
    }

    const withToJson = {
      toJSON() {
        return { hijacked: true };
      }
    };

    const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
    const arrayWithProp = [1, 2];
    arrayWithProp.extra = "nope";

    const nonEnumObj = {};
    Object.defineProperty(nonEnumObj, "hidden", { value: 1, enumerable: false });

    const symKeyObj = { [Symbol("k")]: 1 };

    const invalidStates = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      10n,
      () => {},
      Symbol("s"),
      { a: undefined },
      [1, undefined],
      { fn: () => {} },
      [() => {}],
      { sym: Symbol("x") },
      [Symbol("x")],
      { n: Number.NaN },
      { inf: Number.POSITIVE_INFINITY },
      new Map([["a", 1]]),
      new Set([1, 2]),
      new Date(),
      /abc/,
      new Error("err"),
      new Uint8Array([1, 2]),
      new CustomClass(),
      new Number(5), // eslint-disable-line no-new-wrappers
      new String("a"), // eslint-disable-line no-new-wrappers
      new Boolean(true), // eslint-disable-line no-new-wrappers
      circular,
      withToJson,
      sparse,
      arrayWithProp,
      nonEnumObj,
      symKeyObj,
      JSON.parse('{"__proto__":{"polluted":true}}'),
      { constructor: {} },
      { prototype: {} }
    ];

    for (const bad of invalidStates) {
      assert.throws(
        () => createReplay({ initialState: bad, reducer: counterReducer }),
        TypeError
      );
    }
  });
});

describe("B. Event validation", () => {
  test("accepts valid event with explicit payload, timestamp, and meta", () => {
    const history = makeCounter();
    history.dispatch({
      type: "increment",
      payload: { amount: 4 },
      timestamp: 1700000000000,
      meta: { actor: "alice", requestId: "req-1" }
    });

    const [stored] = history.getEvents();
    assert.deepEqual(stored, {
      type: "increment",
      payload: { amount: 4 },
      timestamp: 1700000000000,
      meta: { actor: "alice", requestId: "req-1" }
    });
  });

  test("defaults payload to null and generates finite numeric timestamp when omitted", () => {
    const history = makeCounter();
    const before = Date.now();
    history.dispatch({ type: "reset" });
    const after = Date.now();

    const [stored] = history.getEvents();
    assert.equal(stored.type, "reset");
    assert.equal(stored.payload, null);
    assert.equal(typeof stored.timestamp, "number");
    assert.equal(Number.isFinite(stored.timestamp), true);
    assert.equal(stored.timestamp >= before && stored.timestamp <= after, true);
    assert.equal(Object.hasOwn(stored, "meta"), false);
  });

  test("rejects null, undefined, primitive, array, and non-plain-object events", () => {
    const history = makeCounter();
    for (const bad of [null, undefined, "inc", 123, true, [], new Date(), new Map()]) {
      assert.throws(() => history.dispatch(bad), TypeError);
    }
  });

  test("rejects missing, empty, whitespace-only, and non-string event types", () => {
    const history = makeCounter();
    for (const bad of [
      { payload: {} },
      { type: "", payload: {} },
      { type: "   \t\n ", payload: {} },
      { type: 123, payload: {} },
      { type: null, payload: {} },
      { type: undefined, payload: {} }
    ]) {
      assert.throws(
        () => history.dispatch(bad),
        { name: "TypeError", message: /non-empty string/i }
      );
    }
  });

  test("rejects invalid payloads", () => {
    const history = makeCounter();
    const circular = {};
    circular.self = circular;

    for (const payload of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => {},
      Symbol("p"),
      new Map(),
      new Set(),
      new Date(),
      { amount: undefined },
      { amount: Number.NaN },
      circular,
      JSON.parse('{"__proto__":{"polluted":true}}')
    ]) {
      assert.throws(
        () => history.dispatch({ type: "increment", payload }),
        TypeError
      );
    }
  });

  test("rejects invalid timestamps", () => {
    const history = makeCounter();
    for (const timestamp of [
      undefined,
      null,
      "2026-01-01T00:00:00Z",
      "1700000000000",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      true,
      {},
      [],
      100n
    ]) {
      assert.throws(
        () => history.dispatch({ type: "reset", timestamp }),
        { name: "TypeError", message: /timestamp/i }
      );
    }
  });

  test("validates custom event metadata and rejects invalid event structures", () => {
    const history = makeCounter();

    // Non-plain-object meta is rejected
    for (const meta of [null, undefined, "actor", 123, [], new Date(), { bad: Number.NaN }]) {
      assert.throws(
        () => history.dispatch({ type: "reset", meta }),
        TypeError
      );
    }

    // Unknown top-level properties are rejected
    assert.throws(
      () => history.dispatch({ type: "reset", extra: 1 }),
      { name: "TypeError", message: /unsupported property/i }
    );

    // Symbol keys and non-enumerable properties on event are rejected
    assert.throws(
      () => history.dispatch({ type: "reset", [Symbol("s")]: 1 }),
      TypeError
    );

    const nonEnumEvent = { type: "reset" };
    Object.defineProperty(nonEnumEvent, "payload", { value: null, enumerable: false });
    assert.throws(() => history.dispatch(nonEnumEvent), TypeError);
  });
});

describe("C. Dispatch", () => {
  test("single and multiple dispatches update state, length, and cursor", () => {
    const history = makeCounter();

    assert.deepEqual(history.dispatch({ type: "increment", payload: { amount: 3 } }), { count: 3 });
    assert.equal(history.getLength(), 1);
    assert.equal(history.getPosition(), 1);
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);

    assert.deepEqual(history.dispatch({ type: "increment", payload: { amount: 5 } }), { count: 8 });
    assert.deepEqual(history.dispatch({ type: "decrement", payload: { amount: 2 } }), { count: 6 });
    assert.equal(history.getLength(), 3);
    assert.equal(history.getPosition(), 3);
    assert.deepEqual(history.getState(), { count: 6 });
  });

  test("dispatch after undo discards the undone future", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 5 } });
    history.dispatch({ type: "increment", payload: { amount: 10 } });
    history.undo();

    assert.deepEqual(history.dispatch({ type: "decrement", payload: { amount: 2 } }), { count: 3 });
    assert.equal(history.getLength(), 2);
    assert.equal(history.getPosition(), 2);
    assert.equal(history.canRedo(), false);
    assert.deepEqual(history.getEvents().map((e) => e.type), ["increment", "decrement"]);
  });

  test("dispatch after seeking to 0 or middle replaces the future timeline", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 3 } });
    history.dispatch({ type: "increment", payload: { amount: 4 } });
    history.dispatch({ type: "increment", payload: { amount: 5 } });

    history.seek(1);
    assert.deepEqual(history.dispatch({ type: "decrement", payload: { amount: 2 } }), { count: 1 });
    assert.equal(history.getLength(), 2);
    assert.equal(history.getPosition(), 2);
    assert.equal(history.canRedo(), false);

    history.seek(0);
    assert.deepEqual(history.dispatch({ type: "increment", payload: { amount: 9 } }), { count: 9 });
    assert.equal(history.getLength(), 1);
    assert.equal(history.getPosition(), 1);
    assert.deepEqual(history.getEvents().map((e) => e.payload.amount), [9]);
  });

  test("failed reducer and invalid reducer return value do not alter history", () => {
    const history = createReplay({
      initialState: { count: 0 },
      reducer(state, event) {
        if (event.type === "increment") {
          return { count: state.count + event.payload.amount };
        }
        if (event.type === "mutate-and-throw") {
          state.count = 9999;
          throw new Error("Boom in reducer");
        }
        if (event.type === "return-undefined") {
          return undefined;
        }
        if (event.type === "return-nan") {
          return { count: Number.NaN };
        }
        if (event.type === "return-map") {
          return new Map();
        }
        if (event.type === "return-circular") {
          const obj = {};
          obj.self = obj;
          return obj;
        }
        throw new Error(`Unknown event: ${event.type}`);
      }
    });

    history.dispatch({ type: "increment", payload: { amount: 5 } });
    history.dispatch({ type: "increment", payload: { amount: 3 } });
    history.seek(1);

    assert.throws(() => history.dispatch({ type: "mutate-and-throw" }), /Boom in reducer/);
    assert.throws(() => history.dispatch({ type: "return-undefined" }), TypeError);
    assert.throws(() => history.dispatch({ type: "return-nan" }), TypeError);
    assert.throws(() => history.dispatch({ type: "return-map" }), TypeError);
    assert.throws(() => history.dispatch({ type: "return-circular" }), TypeError);

    // State, cursor, and future events remain completely intact
    assert.deepEqual(history.getState(), { count: 5 });
    assert.equal(history.getPosition(), 1);
    assert.equal(history.getLength(), 2);
    assert.equal(history.canRedo(), true);
  });
});

describe("D. Undo and redo", () => {
  test("undo and redo navigate single and multiple steps and clamp at boundaries", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 1 } });
    history.dispatch({ type: "increment", payload: { amount: 2 } });
    history.dispatch({ type: "increment", payload: { amount: 3 } });

    assert.deepEqual(history.undo(), { count: 3 });
    assert.equal(history.getPosition(), 2);
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), true);

    assert.deepEqual(history.undo(), { count: 1 });
    assert.deepEqual(history.undo(), { count: 0 });
    assert.equal(history.getPosition(), 0);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);

    // Undo at position 0 stays at 0
    assert.deepEqual(history.undo(), { count: 0 });
    assert.equal(history.getPosition(), 0);

    // Redo through timeline
    assert.deepEqual(history.redo(), { count: 1 });
    assert.deepEqual(history.redo(), { count: 3 });
    assert.deepEqual(history.redo(), { count: 6 });
    assert.equal(history.getPosition(), 3);
    assert.equal(history.canRedo(), false);

    // Redo at final position stays at final position
    assert.deepEqual(history.redo(), { count: 6 });
    assert.equal(history.getPosition(), 3);
  });

  test("undo and redo work safely with empty history", () => {
    const history = makeCounter({ count: 7 });
    assert.deepEqual(history.undo(), { count: 7 });
    assert.equal(history.getPosition(), 0);
    assert.deepEqual(history.redo(), { count: 7 });
    assert.equal(history.getPosition(), 0);
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
  });
});

describe("E. Seeking", () => {
  test("seeks to 0, first, middle, and final positions accurately", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 2 } });
    history.dispatch({ type: "increment", payload: { amount: 5 } });
    history.dispatch({ type: "decrement", payload: { amount: 1 } });
    history.dispatch({ type: "increment", payload: { amount: 10 } });

    assert.deepEqual(history.seek(0), { count: 0 });
    assert.equal(history.getPosition(), 0);

    assert.deepEqual(history.seek(1), { count: 2 });
    assert.equal(history.getPosition(), 1);

    assert.deepEqual(history.seek(2), { count: 7 });
    assert.equal(history.getPosition(), 2);

    assert.deepEqual(history.seek(4), { count: 16 });
    assert.equal(history.getPosition(), 4);

    assert.deepEqual(history.seek(3), { count: 6 });
    assert.equal(history.getPosition(), 3);
  });

  test("rejects invalid seek positions with RangeError", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 1 } });

    for (const bad of [-1, 2, 100, 0.5, 1.1, "0", "1", Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}]) {
      assert.throws(() => history.seek(bad), RangeError);
    }

    // Cursor and state remain unchanged
    assert.equal(history.getPosition(), 1);
    assert.deepEqual(history.getState(), { count: 1 });
  });

  test("error during seek does not corrupt stored state or cursor", () => {
    let shouldFail = false;
    const history = createReplay({
      initialState: { count: 0 },
      reducer(state, event) {
        if (shouldFail && event.payload.amount === 2) {
          throw new Error("Seek replay failure");
        }
        return { count: state.count + event.payload.amount };
      }
    });

    history.dispatch({ type: "increment", payload: { amount: 1 } });
    history.dispatch({ type: "increment", payload: { amount: 2 } });
    history.dispatch({ type: "increment", payload: { amount: 3 } });
    history.seek(1);

    shouldFail = true;
    assert.throws(() => history.seek(3), /Seek replay failure/);
    assert.equal(history.getPosition(), 1);
    assert.deepEqual(history.getState(), { count: 1 });
  });
});

describe("F. Replay", () => {
  test("replays empty, single, and multiple-event histories", () => {
    const history = makeCounter({ count: 5 });
    assert.deepEqual(history.replay(), { count: 5 });
    assert.equal(history.getPosition(), 0);

    history.dispatch({ type: "increment", payload: { amount: 3 } });
    assert.deepEqual(history.replay(), { count: 8 });
    assert.equal(history.getPosition(), 1);

    history.dispatch({ type: "decrement", payload: { amount: 2 } });
    history.dispatch({ type: "increment", payload: { amount: 4 } });
    assert.deepEqual(history.replay(), { count: 10 });
    assert.equal(history.getPosition(), 3);
  });

  test("replays accurately after undo, seek, and timeline replacement", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 10 } });
    history.dispatch({ type: "decrement", payload: { amount: 4 } });
    history.dispatch({ type: "increment", payload: { amount: 2 } });

    history.undo();
    assert.deepEqual(history.replay(), { count: 8 });
    assert.equal(history.getPosition(), 3);

    history.seek(0);
    assert.deepEqual(history.replay(), { count: 8 });
    assert.equal(history.getPosition(), 3);

    history.seek(1);
    history.dispatch({ type: "increment", payload: { amount: 100 } });
    history.seek(0);
    assert.deepEqual(history.replay(), { count: 110 });
    assert.equal(history.getPosition(), 2);
  });

  test("error during replay preserves previously stored state and cursor", () => {
    let shouldFail = false;
    const history = createReplay({
      initialState: { count: 0 },
      reducer(state, event) {
        if (shouldFail) {
          throw new Error("Replay exploded");
        }
        return { count: state.count + event.payload.amount };
      }
    });

    history.dispatch({ type: "increment", payload: { amount: 4 } });
    history.dispatch({ type: "increment", payload: { amount: 6 } });
    history.seek(1);

    shouldFail = true;
    assert.throws(() => history.replay(), /Replay exploded/);
    assert.equal(history.getPosition(), 1);
    assert.deepEqual(history.getState(), { count: 4 });
  });
});

describe("G. Data integrity and immutability", () => {
  test("external mutations to initialState, event input, returned state, and returned events do not affect internal state", () => {
    const initialInput = { nested: { count: 1 }, items: ["a"] };
    const history = createReplay({
      initialState: initialInput,
      reducer(state, event) {
        return {
          nested: { count: state.nested.count + event.payload.delta },
          items: [...state.items, event.payload.item]
        };
      }
    });

    // Mutate initial input
    initialInput.nested.count = 999;
    initialInput.items.push("corrupted");
    assert.deepEqual(history.getState(), { nested: { count: 1 }, items: ["a"] });

    // Mutate event input after dispatch
    const eventInput = {
      type: "add",
      payload: { delta: 2, item: "b" },
      meta: { tags: ["v1"] }
    };
    const returnedState = history.dispatch(eventInput);
    eventInput.type = "mutated";
    eventInput.payload.delta = 999;
    eventInput.payload.item = "bad";
    eventInput.meta.tags.push("bad");

    // Mutate returned state from dispatch, getState, seek, undo, redo, replay
    returnedState.nested.count = 888;
    returnedState.items.push("bad");

    const fromGetState = history.getState();
    fromGetState.nested.count = 777;

    const fromGetEvents = history.getEvents();
    fromGetEvents[0].payload.delta = 666;
    fromGetEvents[0].meta.tags.push("mutated");
    fromGetEvents.push({ type: "fake", payload: null, timestamp: 0 });

    assert.deepEqual(history.getState(), { nested: { count: 3 }, items: ["a", "b"] });
    assert.equal(history.getLength(), 1);
    assert.deepEqual(history.getEvents()[0].payload, { delta: 2, item: "b" });
    assert.deepEqual(history.getEvents()[0].meta, { tags: ["v1"] });

    const fromUndo = history.undo();
    fromUndo.nested.count = 555;
    assert.deepEqual(history.getState(), { nested: { count: 1 }, items: ["a"] });

    const fromRedo = history.redo();
    fromRedo.nested.count = 444;
    assert.deepEqual(history.getState(), { nested: { count: 3 }, items: ["a", "b"] });
  });

  test("mutating reducer input arguments or external reducer output references does not corrupt internal data", () => {
    const externalCache = [];
    const history = createReplay({
      initialState: { values: [1] },
      reducer(state, event) {
        // Attempt to mutate reducer inputs
        state.values.push(999);
        event.payload.val = -1;
        if (event.meta) {
          event.meta.note = "tampered";
        }

        const result = { values: [...state.values.slice(0, -1), event.payload.orig] };
        externalCache.push(result);
        return result;
      }
    });

    history.dispatch({
      type: "push",
      payload: { orig: 2, val: 2 },
      meta: { note: "original" }
    });

    // Mutate the object reference retained by the reducer
    externalCache[0].values.push(12345);

    assert.deepEqual(history.getState(), { values: [1, 2] });
    assert.deepEqual(history.getEvents()[0].payload, { orig: 2, val: 2 });
    assert.deepEqual(history.getEvents()[0].meta, { note: "original" });
    assert.deepEqual(history.seek(0), { values: [1] });
    assert.deepEqual(history.replay(), { values: [1, 2] });
  });

  test("allows shared non-circular references (DAGs) and clones them independently", () => {
    const shared = { x: 1 };
    const history = createReplay({
      initialState: { a: shared, b: shared },
      reducer: (state) => state
    });

    const state = history.getState();
    assert.deepEqual(state, { a: { x: 1 }, b: { x: 1 } });
    assert.notEqual(state.a, state.b);
    state.a.x = 99;
    assert.equal(state.b.x, 1);
  });
});

describe("H. Export and import", () => {
  test("exports versioned JSON and imports from string or object preserving cursor, events, and meta", () => {
    const original = makeCounter();
    original.dispatch({
      type: "increment",
      payload: { amount: 5 },
      timestamp: 1000,
      meta: { source: "ui" }
    });
    original.dispatch({
      type: "decrement",
      payload: { amount: 2 },
      timestamp: 2000
    });
    original.seek(1);

    const exported = original.export();
    const parsed = JSON.parse(exported);
    assert.equal(parsed.format, "event-replay");
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.initialState, { count: 0 });
    assert.equal(parsed.position, 1);
    assert.equal(parsed.events.length, 2);

    const fromString = makeCounter();
    assert.deepEqual(fromString.import(exported), { count: 5 });
    assert.equal(fromString.getPosition(), 1);
    assert.equal(fromString.getLength(), 2);
    assert.deepEqual(fromString.getEvents(), original.getEvents());
    assert.deepEqual(fromString.replay(), { count: 3 });

    const fromObject = makeCounter();
    assert.deepEqual(fromObject.import(parsed), { count: 5 });
    assert.equal(fromObject.getPosition(), 1);
    assert.equal(fromObject.getLength(), 2);
    assert.deepEqual(fromObject.replay(), { count: 3 });
  });

  test("accepts equivalent initialState JSON objects with different key ordering", () => {
    const reducer = (state, event) => ({
      a: state.a + event.payload.delta,
      b: { x: state.b.x, y: state.b.y }
    });

    const exporter = createReplay({
      initialState: { a: 1, b: { x: 10, y: 20 } },
      reducer
    });
    exporter.dispatch({ type: "step", payload: { delta: 5 }, timestamp: 1234 });

    const importer = createReplay({
      initialState: { b: { y: 20, x: 10 }, a: 1 },
      reducer
    });

    assert.deepEqual(importer.import(exporter.export()), { a: 6, b: { x: 10, y: 20 } });
    assert.equal(importer.getLength(), 1);
    assert.equal(importer.getPosition(), 1);
  });

  test("rejects malformed JSON, empty input, missing properties, extra properties, and invalid format/version/initialState/events/cursor", () => {
    const history = makeCounter();
    const validObj = JSON.parse(history.export());

    // Malformed / empty / wrong primitive types
    for (const bad of ["", "   ", "{not json", "null", "[]", "123", null, undefined, 42, true, []]) {
      assert.throws(() => history.import(bad), TypeError);
    }

    // Missing required properties
    for (const key of ["format", "version", "initialState", "events", "position"]) {
      const missing = { ...validObj };
      delete missing[key];
      assert.throws(() => history.import(missing), TypeError);
    }

    // Extra unexpected top-level property
    assert.throws(() => history.import({ ...validObj, extra: true }), TypeError);

    // Invalid format / version
    assert.throws(() => history.import({ ...validObj, format: "other" }), TypeError);
    assert.throws(() => history.import({ ...validObj, version: 2 }), TypeError);
    assert.throws(() => history.import({ ...validObj, version: "1" }), TypeError);

    // Incompatible or invalid initial state
    assert.throws(() => history.import({ ...validObj, initialState: { count: 1 } }), TypeError);
    assert.throws(() => history.import({ ...validObj, initialState: { count: Number.NaN } }), TypeError);

    // Invalid events
    assert.throws(() => history.import({ ...validObj, events: "nope" }), TypeError);
    assert.throws(() => history.import({ ...validObj, events: [, ] }), TypeError); // eslint-disable-line no-sparse-arrays
    assert.throws(() => history.import({ ...validObj, events: [{ type: "increment", payload: { amount: 1 } }] }), TypeError); // missing timestamp
    assert.throws(() => history.import({ ...validObj, events: [{ type: "increment", timestamp: 1 }] }), TypeError); // missing payload
    assert.throws(() => history.import({ ...validObj, events: [{ type: "unknown", payload: null, timestamp: 1 }] }), Error);

    // Invalid cursor
    for (const badPos of [-1, 1, 0.5, "0", Number.NaN, null]) {
      assert.throws(() => history.import({ ...validObj, position: badPos }), RangeError);
    }
  });

  test("import failure is atomic and preserves previous state, events, and cursor", () => {
    const history = makeCounter();
    history.dispatch({ type: "increment", payload: { amount: 10 }, timestamp: 100 });
    history.dispatch({ type: "decrement", payload: { amount: 3 }, timestamp: 200 });
    history.seek(1);

    const snapshotEvents = history.getEvents();
    const snapshotState = history.getState();

    // Validation failure
    assert.throws(() => history.import("{bad json"), TypeError);

    // Reducer failure mid-timeline (even after cursor!)
    const failingDoc = {
      format: "event-replay",
      version: 1,
      initialState: { count: 0 },
      events: [
        { type: "increment", payload: { amount: 1 }, timestamp: 1 },
        { type: "unknown-type", payload: null, timestamp: 2 }
      ],
      position: 1
    };
    assert.throws(() => history.import(failingDoc), /Unknown event type/);

    assert.deepEqual(history.getState(), snapshotState);
    assert.deepEqual(history.getEvents(), snapshotEvents);
    assert.equal(history.getPosition(), 1);
    assert.equal(history.getLength(), 2);
  });
});

describe("I. Error handling and safety", () => {
  test("never invokes getters during validation across createReplay, dispatch, reducer output, and import", () => {
    let getterCalled = false;

    const withGetter = {};
    Object.defineProperty(withGetter, "secret", {
      enumerable: true,
      get() {
        getterCalled = true;
        return 42;
      }
    });

    assert.throws(() => createReplay({ initialState: withGetter, reducer: counterReducer }), TypeError);
    assert.equal(getterCalled, false);

    const optionsWithGetter = { reducer: counterReducer };
    Object.defineProperty(optionsWithGetter, "initialState", {
      enumerable: true,
      get() {
        getterCalled = true;
        return { count: 0 };
      }
    });
    assert.throws(() => createReplay(optionsWithGetter), TypeError);
    assert.equal(getterCalled, false);

    const history = makeCounter();
    assert.throws(() => history.dispatch({ type: "increment", payload: withGetter }), TypeError);
    assert.equal(getterCalled, false);

    const eventWithGetter = { type: "reset" };
    Object.defineProperty(eventWithGetter, "payload", {
      enumerable: true,
      get() {
        getterCalled = true;
        return null;
      }
    });
    assert.throws(() => history.dispatch(eventWithGetter), TypeError);
    assert.equal(getterCalled, false);

    const docWithGetter = {
      format: "event-replay",
      version: 1,
      initialState: { count: 0 },
      events: [],
      position: 0
    };
    Object.defineProperty(docWithGetter, "format", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "event-replay";
      }
    });
    assert.throws(() => history.import(docWithGetter), TypeError);
    assert.equal(getterCalled, false);

    const badReducerHistory = createReplay({
      initialState: { count: 0 },
      reducer() {
        return withGetter;
      }
    });
    assert.throws(() => badReducerHistory.dispatch({ type: "any" }), TypeError);
    assert.equal(getterCalled, false);
  });

  test("prevents prototype pollution from imported JSON strings and payloads", () => {
    const history = makeCounter();
    const maliciousJson =
      '{"format":"event-replay","version":1,"initialState":{"count":0},"events":[{"type":"increment","payload":{"amount":1,"__proto__":{"polluted":true}},"timestamp":1}],"position":1}';

    assert.throws(() => history.import(maliciousJson), TypeError);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });

  test("rejects array subclasses, array element getters, non-enumerable array elements, and extra exotic objects", () => {
    class SubArray extends Array {}
    const sub = new SubArray(1, 2);

    const arrWithGetter = [1];
    let getterInvoked = false;
    Object.defineProperty(arrWithGetter, 0, {
      enumerable: true,
      get() {
        getterInvoked = true;
        return 1;
      }
    });

    const arrWithNonEnum = [];
    Object.defineProperty(arrWithNonEnum, 0, {
      value: 1,
      enumerable: false
    });

    const reducerGetterOpts = { initialState: { count: 0 } };
    Object.defineProperty(reducerGetterOpts, "reducer", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return counterReducer;
      }
    });

    assert.throws(() => createReplay({ initialState: sub, reducer: counterReducer }), TypeError);
    assert.throws(() => createReplay({ initialState: arrWithGetter, reducer: counterReducer }), TypeError);
    assert.throws(() => createReplay({ initialState: arrWithNonEnum, reducer: counterReducer }), TypeError);
    assert.throws(() => createReplay(reducerGetterOpts), TypeError);
    assert.equal(getterInvoked, false);

    for (const exotic of [
      new WeakMap(),
      new WeakSet(),
      Promise.resolve(1),
      new ArrayBuffer(8)
    ]) {
      assert.throws(() => createReplay({ initialState: exotic, reducer: counterReducer }), TypeError);
    }

    // Sparse / extra-property events array in import
    const history = makeCounter();
    const sparseEvents = [, ]; // eslint-disable-line no-sparse-arrays
    sparseEvents.extra = true; // length 1, own keys length 2
    assert.throws(
      () =>
        history.import({
          format: "event-replay",
          version: 1,
          initialState: { count: 0 },
          events: sparseEvents,
          position: 0
        }),
      TypeError
    );

    assert.throws(
      () =>
        history.import({
          format: "event-replay",
          version: 1,
          initialState: { count: 0 },
          events: new SubArray(),
          position: 0
        }),
      TypeError
    );
  });

  test("handles null-prototype plain objects, negative zero normalization, and deep structural initialState mismatches", () => {
    const nullProtoState = Object.create(null);
    nullProtoState.count = -0;

    const history = createReplay({
      initialState: nullProtoState,
      reducer: counterReducer
    });

    assert.deepEqual(history.getState(), { count: 0 });
    assert.equal(Object.is(history.getState().count, 0), true);

    history.dispatch({ type: "increment", payload: { amount: 1 }, timestamp: -0 });
    assert.equal(Object.is(history.getEvents()[0].timestamp, 0), true);

    history.seek(-0);
    assert.equal(Object.is(history.getPosition(), 0), true);

    // Structural initialState mismatches in import (array vs object, array lengths, nested differences, key counts)
    const arrayHistory = createReplay({
      initialState: [1, { a: 2 }],
      reducer: (state) => state
    });
    const baseExport = JSON.parse(arrayHistory.export());
    assert.deepEqual(arrayHistory.import(baseExport), [1, { a: 2 }]);

    for (const mismatched of [
      { 0: 1, 1: { a: 2 } },
      [1],
      [1, { a: 3 }],
      [1, { a: 2, b: 3 }],
      [1, { b: 2 }],
      null
    ]) {
      assert.throws(
        () => arrayHistory.import({ ...baseExport, initialState: mismatched }),
        { name: "TypeError", message: /different initial state/i }
      );
    }
  });
});

describe("J. Stress and invariant tests", () => {
  test("handles 2,500 events with deterministic seeks, undo/redo invariants, export/import, and replay consistency", () => {
    const TOTAL = 2500;
    const history = createReplay({
      initialState: { sum: 0, lastIndex: -1 },
      reducer(state, event) {
        return {
          sum: state.sum + event.payload.delta,
          lastIndex: event.payload.index
        };
      }
    });

    const expectedSums = [0];
    let runningSum = 0;

    for (let i = 0; i < TOTAL; i += 1) {
      const delta = (i % 7) - 3; // deterministic deltas in [-3, 3]
      runningSum += delta;
      expectedSums.push(runningSum);
      history.dispatch({
        type: "step",
        payload: { index: i, delta },
        timestamp: 1700000000000 + i
      });
    }

    assert.equal(history.getLength(), TOTAL);
    assert.equal(history.getPosition(), TOTAL);
    assert.deepEqual(history.getState(), { sum: runningSum, lastIndex: TOTAL - 1 });

    // Verify ordering
    const allEvents = history.getEvents();
    assert.equal(allEvents.length, TOTAL);
    for (let i = 0; i < TOTAL; i += 1) {
      assert.equal(allEvents[i].payload.index, i);
      assert.equal(allEvents[i].timestamp, 1700000000000 + i);
    }

    // Deterministic LCG PRNG for 40 random seeks
    let seed = 123456789;
    function nextRandInt(maxInclusive) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed % (maxInclusive + 1);
    }

    for (let trial = 0; trial < 40; trial += 1) {
      const pos = nextRandInt(TOTAL);
      const state = history.seek(pos);
      assert.equal(history.getPosition(), pos);
      assert.equal(state.sum, expectedSums[pos]);
      assert.equal(state.lastIndex, pos === 0 ? -1 : pos - 1);
      assert.equal(history.canUndo(), pos > 0);
      assert.equal(history.canRedo(), pos < TOTAL);
    }

    // Undo / redo invariants from a known position
    history.seek(1234);
    assert.deepEqual(history.undo(), { sum: expectedSums[1233], lastIndex: 1232 });
    assert.equal(history.getPosition(), 1233);
    assert.deepEqual(history.redo(), { sum: expectedSums[1234], lastIndex: 1233 });
    assert.equal(history.getPosition(), 1234);

    // Export/import consistency at mid-timeline position
    const exported = history.export();
    const restored = createReplay({
      initialState: { sum: 0, lastIndex: -1 },
      reducer(state, event) {
        return {
          sum: state.sum + event.payload.delta,
          lastIndex: event.payload.index
        };
      }
    });

    assert.deepEqual(restored.import(exported), { sum: expectedSums[1234], lastIndex: 1233 });
    assert.equal(restored.getPosition(), 1234);
    assert.equal(restored.getLength(), TOTAL);

    // Replay consistency
    assert.deepEqual(restored.replay(), { sum: runningSum, lastIndex: TOTAL - 1 });
    assert.equal(restored.getPosition(), TOTAL);
  });
});

describe("K. Audit regression tests", () => {
  test("regression: NaN and Infinity do not silently convert to null", () => {
    assert.throws(() => makeCounter({ count: Number.NaN }), TypeError);
    assert.throws(() => makeCounter({ count: Number.POSITIVE_INFINITY }), TypeError);
  });

  test("regression: Map, Set, and Date do not silently serialize to {} or ISO strings", () => {
    assert.throws(() => makeCounter(new Map()), TypeError);
    assert.throws(() => makeCounter(new Set()), TypeError);
    assert.throws(() => makeCounter(new Date()), TypeError);
  });

  test("regression: non-numeric timestamps are rejected instead of accepted as arbitrary JSON", () => {
    const history = makeCounter();
    assert.throws(
      () => history.dispatch({ type: "reset", timestamp: "not-a-timestamp" }),
      TypeError
    );
  });

  test("regression: custom event meta is preserved instead of silently stripped", () => {
    const history = makeCounter();
    history.dispatch({
      type: "increment",
      payload: { amount: 1 },
      timestamp: 1000,
      meta: { correlationId: "abc-123" }
    });
    assert.deepEqual(history.getEvents()[0].meta, { correlationId: "abc-123" });
  });

  test("regression: import accepts equivalent initialState objects regardless of key order", () => {
    const reducer = (s) => s;
    const a = createReplay({ initialState: { x: 1, y: 2 }, reducer });
    const b = createReplay({ initialState: { y: 2, x: 1 }, reducer });
    assert.deepEqual(b.import(a.export()), { y: 2, x: 1 });
  });

  test("regression: createReplay(null) throws a descriptive TypeError", () => {
    assert.throws(
      () => createReplay(null),
      { name: "TypeError", message: /options object/i }
    );
  });
});
