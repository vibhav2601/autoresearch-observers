CREATE TABLE `pending_steering_events` (
	`id` text PRIMARY KEY NOT NULL,
	`observed_convo_id` text NOT NULL,
	`observer_run_id` text,
	`target_span_id` text,
	`target_subagent_span_id` text,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`before_prompt` text,
	`after_prompt` text,
	`reason` text,
	`source` text NOT NULL,
	`confidence` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pending_steering_convo` ON `pending_steering_events` (`observed_convo_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_pending_steering_created` ON `pending_steering_events` (`created_at`);
