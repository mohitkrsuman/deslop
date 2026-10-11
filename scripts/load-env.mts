import { existsSync } from "node:fs";
import process from "node:process";

// The files `next dev` reads, in its order. The first to define a variable
// wins, and the shell beats all of them, which is how Next resolves it too.
// Import this before anything that reads process.env.
for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
