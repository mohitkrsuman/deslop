import { auth } from "@clerk/nextjs/server";

export default async function WorkspacePage() {
  const { orgId, orgRole, orgSlug } = await auth();

  return (
    <section className="px-3 py-3">
      <h1 className="text-xs text-muted">Organization</h1>
      {orgId ? (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
          <dt className="text-muted">Id</dt>
          <dd className="font-mono">{orgId}</dd>
          {orgSlug ? (
            <>
              <dt className="text-muted">Slug</dt>
              <dd className="font-mono">{orgSlug}</dd>
            </>
          ) : null}
          <dt className="text-muted">Role</dt>
          <dd className="font-mono">{orgRole}</dd>
        </dl>
      ) : (
        <p className="mt-2 text-xs">
          This session token has no organization.
        </p>
      )}
    </section>
  );
}
