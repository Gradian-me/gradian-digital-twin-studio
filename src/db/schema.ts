import { relations } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  code: text('code').notNull().default('DT-001'),
  description: text('description').notNull().default(''),
  industry: text('industry').notNull().default('Biopharmaceutical'),
  unitSystem: text('unit_system').notNull().default('metric'),
  revision: integer('revision').notNull().default(1),
  sceneData: jsonb('scene_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projectSnapshots = pgTable('project_snapshots', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  ownerUid: text('owner_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  versionTag: text('version_tag').notNull(),
  label: text('label').notNull(),
  summary: text('summary').notNull().default(''),
  sceneData: jsonb('scene_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customTemplates = pgTable('custom_templates', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  kind: text('kind').notNull(), // 'space_type' | 'object' | 'project'
  name: text('name').notNull(),
  category: text('category').notNull(),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customMaterials = pgTable('custom_materials', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  properties: jsonb('properties').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  snapshots: many(projectSnapshots),
  customTemplates: many(customTemplates),
  customMaterials: many(customMaterials),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerUid],
    references: [users.uid],
  }),
  snapshots: many(projectSnapshots),
}));

export const projectSnapshotsRelations = relations(
  projectSnapshots,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectSnapshots.projectId],
      references: [projects.id],
    }),
    owner: one(users, {
      fields: [projectSnapshots.ownerUid],
      references: [users.uid],
    }),
  })
);
