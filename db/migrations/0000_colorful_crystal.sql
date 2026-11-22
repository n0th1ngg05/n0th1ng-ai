CREATE TABLE `activity_logs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`action` varchar(255) NOT NULL,
	`entity_type` varchar(100),
	`entity_id` bigint,
	`metadata` json,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_models` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`size` varchar(50),
	`quantization` varchar(50),
	`context_length` int,
	`status` enum('active','idle','loading','error') DEFAULT 'idle',
	`memory_usage` bigint DEFAULT 0,
	`vram_usage` bigint DEFAULT 0,
	`token_speed` float DEFAULT 0,
	`last_used` timestamp,
	`is_installed` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `ai_models_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(255),
	`model_id` varchar(100) NOT NULL,
	`user_id` bigint unsigned,
	`folder_id` bigint unsigned,
	`is_pinned` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `file_folders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`parent_id` bigint unsigned,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `file_folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`path` varchar(500) NOT NULL,
	`size` bigint,
	`mime_type` varchar(100),
	`folder_id` bigint unsigned,
	`is_indexed` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`user_id` bigint unsigned,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `generated_images` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`prompt` text NOT NULL,
	`negative_prompt` text,
	`model_used` varchar(255),
	`resolution` varchar(50),
	`steps` int,
	`sampler` varchar(100),
	`seed` bigint,
	`generation_time` int,
	`gpu_usage` float,
	`vram_usage` float,
	`image_url` varchar(500),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `generated_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_entries` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(500) NOT NULL,
	`content` text NOT NULL,
	`source_type` enum('conversation','research','file','manual'),
	`tags` json,
	`relevance_score` float,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `knowledge_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`conversation_id` bigint unsigned,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`tokens_used` int DEFAULT 0,
	`response_time` int,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_collections` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `research_collections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_documents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(500) NOT NULL,
	`content` text,
	`source` varchar(500),
	`collection_id` bigint unsigned,
	`is_bookmarked` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `research_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`status` enum('running','stopped','error') DEFAULT 'stopped',
	`uptime` bigint,
	`version` varchar(50),
	`last_checked` timestamp DEFAULT (now()),
	CONSTRAINT `services_id` PRIMARY KEY(`id`),
	CONSTRAINT `services_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `system_snapshots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`cpu_usage` float NOT NULL,
	`cpu_temp` float,
	`ram_usage` float NOT NULL,
	`ram_total` bigint,
	`gpu_usage` float,
	`gpu_temp` float,
	`vram_usage` float,
	`vram_total` bigint,
	`storage_usage` float,
	`network_rx` bigint,
	`network_tx` bigint,
	`network_rx_speed` float,
	`network_tx_speed` float,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `system_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`avatar_url` varchar(500),
	`role` enum('admin','user') DEFAULT 'admin',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`nodes` json NOT NULL,
	`edges` json NOT NULL,
	`is_template` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `workflows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_folder_id_folders_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_folder_id_file_folders_id_fk` FOREIGN KEY (`folder_id`) REFERENCES `file_folders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `folders` ADD CONSTRAINT `folders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `research_documents` ADD CONSTRAINT `research_documents_collection_id_research_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `research_collections`(`id`) ON DELETE no action ON UPDATE no action;