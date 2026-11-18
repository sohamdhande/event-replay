const FORMAT = "event-replay";
const FORMAT_VERSION = 1;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ALLOWED_EVENT_KEYS = new Set(["type", "payload", "timestamp", "meta"]);
const ALLOWED_DOCUMENT_KEYS = new Set([
  "format",
  "version",
  "initialState",
  "events",
  "position"
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeUnsupportedObject(value) {
  if (value instanceof Date) return "Date";
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  if (value instanceof WeakMap) return "WeakMap";
  if (value instanceof WeakSet) return "WeakSet";
  if (value instanceof RegExp) return "RegExp";
  if (value instanceof Error) return "Error";
  if (value instanceof Promise) return "Promise";
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return "binary buffer";
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    return "boxed primitive";
  }
  return "unsupported object";
}

function readOwnDataProperty(object, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);

  if (!descriptor) {
    throw new TypeError(`${label} is missing property "${key}".`);
  }

  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    throw new TypeError(`${label} must not contain accessor property "${key}".`);
  }

  if (!descriptor.enumerable) {
    throw new TypeError(`${label} must not contain non-enumerable property "${key}".`);
  }

  return descriptor.value;
}

function assertNoSymbolKeys(value, label) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} must not contain symbol properties.`);
  }
}

function validateAndCloneJson(value, label, ancestors = new Set()) {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === "boolean" || valueType === "string") {
    return value;
  }

  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must not contain NaN or Infinity.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (valueType === "undefined") {
    throw new TypeError(`${label} must not contain undefined values.`);
  }

  if (valueType === "bigint") {
    throw new TypeError(`${label} must not contain BigInt values.`);
  }

  if (valueType === "function") {
    throw new TypeError(`${label} must not contain functions.`);
  }

  if (valueType === "symbol") {
    throw new TypeError(`${label} must not contain symbols.`);
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain circular references.`);
  }

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${label} must contain only plain arrays.`);
    }

    assertNoSymbolKeys(value, label);

    const length = value.length;
    const copy = new Array(length);

    ancestors.add(value);
    try {
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);

        if (!descriptor) {
          throw new TypeError(`${label} must not contain sparse array holes.`);
        }
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
          throw new TypeError(`${label} must not contain accessor properties.`);
        }
        if (!descriptor.enumerable) {
          throw new TypeError(`${label} must not contain non-enumerable properties.`);
        }

        copy[index] = validateAndCloneJson(descriptor.value, `${label}[${index}]`, ancestors);
      }

      if (Object.getOwnPropertyNames(value).length !== length + 1) {
        throw new TypeError(`${label} must not contain extra properties on arrays.`);
      }
    } finally {
      ancestors.delete(value);
    }

    return copy;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(
      `${label} must contain only JSON-serializable plain objects, arrays, and primitives (received ${describeUnsupportedObject(value)}).`
    );
  }

  assertNoSymbolKeys(value, label);

  const keys = Object.getOwnPropertyNames(value);
  const copy = {};

  ancestors.add(value);
  try {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];

      if (FORBIDDEN_KEYS.has(key)) {
        throw new TypeError(`${label} must not contain forbidden property "${key}".`);
      }

      const rawProp = readOwnDataProperty(value, key, label);
      const clonedProp = validateAndCloneJson(rawProp, `${label}.${key}`, ancestors);

      Object.defineProperty(copy, key, {
        value: clonedProp,
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
  } finally {
    ancestors.delete(value);
  }

  return copy;
}

function cloneTrustedJson(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const length = value.length;
    const copy = new Array(length);
    for (let index = 0; index < length; index += 1) {
      copy[index] = cloneTrustedJson(value[index]);
    }
    return copy;
  }

  const copy = {};
  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    Object.defineProperty(copy, key, {
      value: cloneTrustedJson(value[key]),
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return copy;
}

function deepEqualJson(a, b) {
  if (Object.is(a, b)) {
    return true;
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) {
    return false;
  }

  if (aIsArray) {
    if (a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqualJson(a[index], b[index])) {
        return false;
      }
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }

  for (let index = 0; index < keysA.length; index += 1) {
    const key = keysA[index];
    if (!Object.hasOwn(b, key) || !deepEqualJson(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

function validateEvent(event, { requirePayload = false, requireTimestamp = false } = {}) {
  if (!isPlainObject(event)) {
    throw new TypeError("An event must be a plain object.");
  }

  assertNoSymbolKeys(event, "Event");

  const ownKeys = Object.getOwnPropertyNames(event);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (!ALLOWED_EVENT_KEYS.has(key)) {
      throw new TypeError(
        `Event contains unsupported property "${key}". Allowed properties are type, payload, timestamp, and meta.`
      );
    }
    readOwnDataProperty(event, key, "Event");
  }

  if (!Object.hasOwn(event, "type")) {
    throw new TypeError('An event must have a non-empty string "type".');
  }

  const type = readOwnDataProperty(event, "type", "Event");
  if (typeof type !== "string" || type.trim() === "") {
    throw new TypeError('An event must have a non-empty string "type".');
  }

  let payload;
  if (Object.hasOwn(event, "payload")) {
    payload = validateAndCloneJson(readOwnDataProperty(event, "payload", "Event"), "Event payload");
  } else if (requirePayload) {
    throw new TypeError('Imported event must have a "payload" property.');
  } else {
    payload = null;
  }

  let timestamp;
  if (Object.hasOwn(event, "timestamp")) {
    const rawTimestamp = readOwnDataProperty(event, "timestamp", "Event");
    if (typeof rawTimestamp !== "number" || !Number.isFinite(rawTimestamp)) {
      throw new TypeError('Event "timestamp" must be a finite number in milliseconds.');
    }
    timestamp = Object.is(rawTimestamp, -0) ? 0 : rawTimestamp;
  } else if (requireTimestamp) {
    throw new TypeError('Imported event must have a finite numeric "timestamp".');
  } else {
    timestamp = Date.now();
  }

  const normalizedEvent = {
    type,
    payload,
    timestamp
  };

  if (Object.hasOwn(event, "meta")) {
    const rawMeta = readOwnDataProperty(event, "meta", "Event");
    if (!isPlainObject(rawMeta)) {
      throw new TypeError('Event "meta" must be a plain JSON-serializable object.');
    }
    normalizedEvent.meta = validateAndCloneJson(rawMeta, "Event meta");
  }

  return normalizedEvent;
}

function validatePosition(position, length) {
  if (!Number.isInteger(position) || position < 0 || position > length) {
    throw new RangeError(`Position must be an integer between 0 and ${length}.`);
  }
  return Object.is(position, -0) ? 0 : position;
}

function validateImportedDocument(rawDocument) {
  if (!isPlainObject(rawDocument)) {
    throw new TypeError("Imported event history must be a plain object.");
  }

  assertNoSymbolKeys(rawDocument, "Imported event history");

  const ownKeys = Object.getOwnPropertyNames(rawDocument);
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (!ALLOWED_DOCUMENT_KEYS.has(key)) {
      throw new TypeError(`Imported event history contains unsupported property "${key}".`);
    }
    readOwnDataProperty(rawDocument, key, "Imported event history");
  }

  if (!Object.hasOwn(rawDocument, "format") || !Object.hasOwn(rawDocument, "version")) {
    throw new TypeError("Imported event history is missing required format or version.");
  }

  const format = readOwnDataProperty(rawDocument, "format", "Imported event history");
  const version = readOwnDataProperty(rawDocument, "version", "Imported event history");
  if (format !== FORMAT || version !== FORMAT_VERSION) {
    throw new TypeError("Unsupported event history format or version.");
  }

  if (!Object.hasOwn(rawDocument, "initialState")) {
    throw new TypeError('Imported event history is missing "initialState".');
  }
  if (!Object.hasOwn(rawDocument, "events")) {
    throw new TypeError('Imported event history is missing "events".');
  }
  if (!Object.hasOwn(rawDocument, "position")) {
    throw new TypeError('Imported event history is missing "position".');
  }

  const rawEvents = readOwnDataProperty(rawDocument, "events", "Imported event history");
  if (!Array.isArray(rawEvents) || Object.getPrototypeOf(rawEvents) !== Array.prototype) {
    throw new TypeError("Imported event history must contain a plain events array.");
  }

  assertNoSymbolKeys(rawEvents, "Imported events");
  if (Object.getOwnPropertyNames(rawEvents).length !== rawEvents.length + 1) {
    throw new TypeError("Imported events array must not contain holes or extra properties.");
  }

  const importedEvents = new Array(rawEvents.length);
  for (let index = 0; index < rawEvents.length; index += 1) {
    const rawEvent = readOwnDataProperty(rawEvents, String(index), `Imported events[${index}]`);
    importedEvents[index] = validateEvent(rawEvent, {
      requirePayload: true,
      requireTimestamp: true
    });
  }

  const importedBase = validateAndCloneJson(
    readOwnDataProperty(rawDocument, "initialState", "Imported event history"),
    "Imported initial state"
  );

  const importedPosition = validatePosition(
    readOwnDataProperty(rawDocument, "position", "Imported event history"),
    importedEvents.length
  );

  return {
    importedBase,
    importedEvents,
    importedPosition
  };
}

/**
 * Create a deterministic event history around a pure reducer.
 * The reducer receives (currentState, event) and must return the next state.
 */
export function createReplay(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createReplay requires an options object with initialState and reducer.");
  }

  const reducerDesc = Object.getOwnPropertyDescriptor(options, "reducer");
  if (reducerDesc && (reducerDesc.get !== undefined || reducerDesc.set !== undefined)) {
    throw new TypeError("createReplay options.reducer must not be an accessor property.");
  }

  const reducer = options.reducer;
  if (typeof reducer !== "function") {
    throw new TypeError("createReplay requires a reducer function.");
  }

  if (!("initialState" in options)) {
    throw new TypeError("createReplay requires an initialState.");
  }

  const initialStateDesc = Object.getOwnPropertyDescriptor(options, "initialState");
  if (initialStateDesc && (initialStateDesc.get !== undefined || initialStateDesc.set !== undefined)) {
    throw new TypeError("createReplay options.initialState must not be an accessor property.");
  }

  const baseState = validateAndCloneJson(options.initialState, "Initial state");
  let state = cloneTrustedJson(baseState);
  let events = [];
  let position = 0;

  function reduceFromStart(until = events.length, sourceEvents = events) {
    let nextState = cloneTrustedJson(baseState);

    for (let index = 0; index < until; index += 1) {
      const next = reducer(
        cloneTrustedJson(nextState),
        cloneTrustedJson(sourceEvents[index])
      );
      nextState = validateAndCloneJson(next, `Reducer result at event ${index}`);
    }

    return nextState;
  }

  function seek(nextPosition) {
    const normalizedPosition = validatePosition(nextPosition, events.length);
    const nextState = reduceFromStart(normalizedPosition);
    state = nextState;
    position = normalizedPosition;
    return cloneTrustedJson(state);
  }

  return {
    /** Apply an event, append it to history, and return the resulting state. */
    dispatch(event) {
      const safeEvent = validateEvent(event);
      const next = reducer(cloneTrustedJson(state), cloneTrustedJson(safeEvent));
      const nextState = validateAndCloneJson(next, "Reducer result");

      // Dispatching after seeking backward discards the previous future timeline.
      const nextEvents = events.slice(0, position);
      nextEvents.push(safeEvent);
      events = nextEvents;
      position += 1;
      state = nextState;

      return cloneTrustedJson(state);
    },

    /** Move to the state after the requested number of events. 0 means initial state. */
    seek,

    /** Move backward by one event, stopping at the initial state (position 0). */
    undo() {
      if (position === 0) {
        return cloneTrustedJson(state);
      }
      return seek(position - 1);
    },

    /** Move forward by one event, stopping at the end of the timeline. */
    redo() {
      if (position === events.length) {
        return cloneTrustedJson(state);
      }
      return seek(position + 1);
    },

    /** Recompute the state by replaying the entire current event history. */
    replay() {
      return seek(events.length);
    },

    getState() {
      return cloneTrustedJson(state);
    },

    getEvents() {
      return cloneTrustedJson(events);
    },

    getPosition() {
      return position;
    },

    getLength() {
      return events.length;
    },

    canUndo() {
      return position > 0;
    },

    canRedo() {
      return position < events.length;
    },

    /** Export a portable JSON document containing the timeline and current cursor. */
    export() {
      return JSON.stringify({
        format: FORMAT,
        version: FORMAT_VERSION,
        initialState: baseState,
        events,
        position
      });
    },

    /** Load a document produced by export(). The supplied reducer is retained. */
    import(serialized) {
      let rawDocument;

      if (typeof serialized === "string") {
        if (serialized.trim() === "") {
          throw new TypeError("Could not parse event history: input string is empty.");
        }
        try {
          rawDocument = JSON.parse(serialized);
        } catch (error) {
          throw new TypeError(`Could not parse event history: ${error.message}`);
        }
      } else if (serialized !== null && typeof serialized === "object") {
        rawDocument = serialized;
      } else {
        throw new TypeError("Import data must be a JSON string or a plain object.");
      }

      const { importedBase, importedEvents, importedPosition } = validateImportedDocument(rawDocument);

      // This instance's initial state is fixed. Import accepts equivalent JSON values
      // regardless of object key order.
      if (!deepEqualJson(importedBase, baseState)) {
        throw new TypeError("Imported history has a different initial state.");
      }

      // Replay the entire imported timeline before mutating this instance so that
      // any reducer error keeps the import atomic and leaves existing state intact.
      let runningState = cloneTrustedJson(baseState);
      let targetState = importedPosition === 0 ? cloneTrustedJson(runningState) : null;

      for (let index = 0; index < importedEvents.length; index += 1) {
        const next = reducer(
          cloneTrustedJson(runningState),
          cloneTrustedJson(importedEvents[index])
        );
        runningState = validateAndCloneJson(next, `Reducer result at event ${index}`);
        if (index + 1 === importedPosition) {
          targetState = cloneTrustedJson(runningState);
        }
      }

      events = importedEvents;
      position = importedPosition;
      state = targetState;
      return cloneTrustedJson(state);
    }
  };
}
