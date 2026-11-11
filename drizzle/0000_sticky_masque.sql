CREATE TABLE `learning_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL
);
