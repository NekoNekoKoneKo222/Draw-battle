CREATE TABLE `drawmon_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`image_key` text NOT NULL,
	`element` text NOT NULL,
	`rarity` text NOT NULL,
	`score` integer NOT NULL,
	`hp` integer NOT NULL,
	`atk` integer NOT NULL,
	`def` integer NOT NULL,
	`moves_json` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drawmon_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`guest_id` text,
	`host_card_id` text NOT NULL,
	`guest_card_id` text,
	`status` text NOT NULL,
	`state_json` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
