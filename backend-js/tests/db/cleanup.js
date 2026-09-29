// Integration fixtures contain immutable published versions. Disable only the
// Outpost lifecycle triggers while deleting those test-owned organizations;
// PostgreSQL foreign-key cascades and all other triggers remain active.
export async function removeTestOrganizations(prisma, organizationIds, userIds) {
  await prisma.$transaction(async (tx) => {
    for (const table of ['roadmap_versions', 'phases', 'weeks', 'topics']) {
      await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }
    await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    for (const table of ['roadmap_versions', 'phases', 'weeks', 'topics']) {
      await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  });
}
