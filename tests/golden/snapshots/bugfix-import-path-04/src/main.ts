// BUG: helpers live at ./helpers/ not ../helpers/
import { format } from "../helpers/format.js";
import { util } from "../helpers/util.js";
import { validate } from "../helpers/validate.js";

export function main(): void {
  console.log(format(util(validate("x"))));
}
