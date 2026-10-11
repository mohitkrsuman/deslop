import { defineIdentity } from "managed-deepagents";

// Only the Cartograph app calls this service. It signs the user in, then sends
// MDA_INGRESS_SECRET and their user id, so each thread belongs to that user.
export const identity = defineIdentity({
  auth: "backend",
});
