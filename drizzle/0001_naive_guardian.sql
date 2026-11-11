CREATE TABLE `learning_state_chunks` (
	`user_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `chunk_id`)
);
