import { processData } from "./utils.js";
import { handle } from "./service.js";

const first = processData({ id: "a", value: 1 });
const second = handle({ id: "b", value: 2 });
console.log(first, second);
