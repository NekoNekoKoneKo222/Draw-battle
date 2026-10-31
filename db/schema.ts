import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cards = sqliteTable('drawmon_cards', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  imageKey: text('image_key').notNull(),
  element: text('element').notNull(),
  rarity: text('rarity').notNull(),
  score: integer('score').notNull(),
  hp: integer('hp').notNull(),
  atk: integer('atk').notNull(),
  def: integer('def').notNull(),
  movesJson: text('moves_json').notNull(),
  published: integer('published').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const rooms = sqliteTable('drawmon_rooms', {
  code: text('code').primaryKey(),
  hostId: text('host_id').notNull(),
  guestId: text('guest_id'),
  hostCardId: text('host_card_id').notNull(),
  guestCardId: text('guest_card_id'),
  status: text('status').notNull(),
  stateJson: text('state_json'),
  version: integer('version').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
  createdAt: integer('created_at').notNull(),
});
