import { createReplay } from "../src/index.js";

const counter = createReplay({
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

counter.dispatch({ type: "increment", payload: { amount: 5 } });
counter.dispatch({ type: "decrement", payload: { amount: 2 } });

console.log("Current:", counter.getState()); // { count: 3 }
console.log("After undo:", counter.undo()); // { count: 5 }
console.log("After redo:", counter.redo()); // { count: 3 }
console.log("At start:", counter.seek(0)); // { count: 0 }
console.log("Full replay:", counter.replay()); // { count: 3 }
