import type { RepositoryAdapter } from "../types.mts";
import { expressAdapter } from "./express.mts";
import { nestjsAdapter } from "./nestjs.mts";
import { nextjsAdapter } from "./nextjs.mts";
import { reactAdapter } from "./react.mts";

// Framework adapters come before React because frameworks may also declare
// React; Next.js also stays ahead of React for the same reason.
export const FRAMEWORK_ADAPTERS: readonly RepositoryAdapter[] = [nextjsAdapter, nestjsAdapter, expressAdapter, reactAdapter];
