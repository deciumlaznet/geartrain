// Prints a scrypt hash for a password, for the GEARTRAIN_USERS secret.
// Usage: pnpm --filter @geartrain/web hash-password   (then type the password)
import { createInterface } from "node:readline";
import { hashPassword } from "../auth.ts";

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
process.stderr.write("Password (12+ characters): ");
rl.once("line", (password) => {
  rl.close();
  try {
    console.log(hashPassword(password.trim()));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
});
