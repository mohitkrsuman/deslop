import type { RepositoryAdapter } from "../types.mts";
import { nestjsAdapter } from "./nestjs.mts";
import { nextjsAdapter } from "./nextjs.mts";
import { reactAdapter } from "./react.mts";

// Detection order. React comes after Next.js because every Next.js app also
// declares React; the first adapter that recognises the repository wins.
export const FRAMEWORK_ADAPTERS: readonly RepositoryAdapter[] = [nextjsAdapter, nestjsAdapter, reactAdapter];
