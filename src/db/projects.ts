import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  customMaterials,
  customTemplates,
  projectSnapshots,
  projects,
} from './schema.ts';

export async function listUserProjects(ownerUid: string) {
  try {
    return await db
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        description: projects.description,
        industry: projects.industry,
        unitSystem: projects.unitSystem,
        revision: projects.revision,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.ownerUid, ownerUid))
      .orderBy(desc(projects.updatedAt));
  } catch (error) {
    console.error('Failed to list projects:', error);
    throw new Error('Unable to load projects at this time.', { cause: error });
  }
}

export async function getUserProject(ownerUid: string, projectId: string) {
  try {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerUid, ownerUid)));
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to get project:', error);
    throw new Error('Unable to load project.', { cause: error });
  }
}

export async function upsertUserProject(input: {
  id: string;
  ownerUid: string;
  name: string;
  code: string;
  description: string;
  industry: string;
  unitSystem: string;
  revision: number;
  sceneData: unknown;
}) {
  try {
    const now = new Date();
    const existing = await db
      .select({ ownerUid: projects.ownerUid })
      .from(projects)
      .where(eq(projects.id, input.id));

    if (existing[0] && existing[0].ownerUid !== input.ownerUid) {
      throw new Error('Forbidden: project belongs to another user.');
    }

    const rows = await db
      .insert(projects)
      .values({
        id: input.id,
        ownerUid: input.ownerUid,
        name: input.name,
        code: input.code,
        description: input.description,
        industry: input.industry,
        unitSystem: input.unitSystem,
        revision: input.revision,
        sceneData: input.sceneData,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: input.name,
          code: input.code,
          description: input.description,
          industry: input.industry,
          unitSystem: input.unitSystem,
          revision: input.revision,
          sceneData: input.sceneData,
          updatedAt: now,
        },
      })
      .returning();

    return rows[0];
  } catch (error: any) {
    if (error?.message?.startsWith('Forbidden')) {
      throw error;
    }
    console.error('Failed to save project:', error);
    throw new Error('Unable to save project.', { cause: error });
  }
}

export async function deleteUserProject(ownerUid: string, projectId: string) {
  try {
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerUid, ownerUid)))
      .returning({ id: projects.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw new Error('Unable to delete project.', { cause: error });
  }
}

export async function listProjectSnapshots(
  ownerUid: string,
  projectId: string
) {
  try {
    return await db
      .select({
        id: projectSnapshots.id,
        projectId: projectSnapshots.projectId,
        versionTag: projectSnapshots.versionTag,
        label: projectSnapshots.label,
        summary: projectSnapshots.summary,
        createdAt: projectSnapshots.createdAt,
      })
      .from(projectSnapshots)
      .where(
        and(
          eq(projectSnapshots.projectId, projectId),
          eq(projectSnapshots.ownerUid, ownerUid)
        )
      )
      .orderBy(desc(projectSnapshots.createdAt));
  } catch (error) {
    console.error('Failed to list snapshots:', error);
    throw new Error('Unable to load revision snapshots.', { cause: error });
  }
}

export async function getProjectSnapshot(
  ownerUid: string,
  projectId: string,
  snapshotId: string
) {
  try {
    const rows = await db
      .select()
      .from(projectSnapshots)
      .where(
        and(
          eq(projectSnapshots.id, snapshotId),
          eq(projectSnapshots.projectId, projectId),
          eq(projectSnapshots.ownerUid, ownerUid)
        )
      );
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to load snapshot:', error);
    throw new Error('Unable to load snapshot.', { cause: error });
  }
}

export async function createProjectSnapshot(input: {
  id: string;
  projectId: string;
  ownerUid: string;
  versionTag: string;
  label: string;
  summary: string;
  sceneData: unknown;
}) {
  try {
    const rows = await db
      .insert(projectSnapshots)
      .values({
        id: input.id,
        projectId: input.projectId,
        ownerUid: input.ownerUid,
        versionTag: input.versionTag,
        label: input.label,
        summary: input.summary,
        sceneData: input.sceneData,
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Failed to create snapshot:', error);
    throw new Error('Unable to create snapshot.', { cause: error });
  }
}

export async function listCustomTemplates(ownerUid: string) {
  try {
    return await db
      .select()
      .from(customTemplates)
      .where(eq(customTemplates.ownerUid, ownerUid))
      .orderBy(desc(customTemplates.createdAt));
  } catch (error) {
    console.error('Failed to load custom templates:', error);
    throw new Error('Unable to load custom templates.', { cause: error });
  }
}

export async function saveCustomTemplate(input: {
  id: string;
  ownerUid: string;
  kind: string;
  name: string;
  category: string;
  config: unknown;
}) {
  try {
    const rows = await db
      .insert(customTemplates)
      .values(input)
      .onConflictDoUpdate({
        target: customTemplates.id,
        set: {
          name: input.name,
          category: input.category,
          config: input.config,
        },
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Failed to save template:', error);
    throw new Error('Unable to save template.', { cause: error });
  }
}

export async function listCustomMaterials(ownerUid: string) {
  try {
    return await db
      .select()
      .from(customMaterials)
      .where(eq(customMaterials.ownerUid, ownerUid))
      .orderBy(desc(customMaterials.createdAt));
  } catch (error) {
    console.error('Failed to load custom materials:', error);
    throw new Error('Unable to load custom materials.', { cause: error });
  }
}

export async function saveCustomMaterial(input: {
  id: string;
  ownerUid: string;
  name: string;
  category: string;
  properties: unknown;
}) {
  try {
    const rows = await db
      .insert(customMaterials)
      .values(input)
      .onConflictDoUpdate({
        target: customMaterials.id,
        set: {
          name: input.name,
          category: input.category,
          properties: input.properties,
        },
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Failed to save material:', error);
    throw new Error('Unable to save material.', { cause: error });
  }
}
