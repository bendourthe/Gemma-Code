export class MissingFieldError extends Error {
  constructor(field: string) {
    super(`missing field: ${field}`);
  }
}

export class WrongTypeError extends Error {
  constructor(field: string) {
    super(`wrong type: ${field}`);
  }
}

export class OutOfRangeError extends Error {
  constructor(field: string) {
    super(`out of range: ${field}`);
  }
}

export interface Input {
  age: unknown;
  email: unknown;
}

export function validate(input: Input): { age: number; email: string } {
  if (input.age === undefined) throw new MissingFieldError("age");
  if (typeof input.age !== "number") throw new WrongTypeError("age");
  if (input.age < 0 || input.age > 150) throw new OutOfRangeError("age");
  if (input.email === undefined) throw new MissingFieldError("email");
  if (typeof input.email !== "string") throw new WrongTypeError("email");
  return { age: input.age, email: input.email };
}
