CREATE TABLE `auth_audit_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`method` varchar(50) NOT NULL,
	`success` boolean NOT NULL,
	`ip` varchar(64),
	`user_agent` text,
	`failure_reason` text,
	CONSTRAINT `auth_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_credentials` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_credentials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_totp_secrets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`secret` text NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_totp_secrets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_webauthn_credentials` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`credential_id` varchar(500) NOT NULL,
	`public_key` text NOT NULL,
	`counter` bigint NOT NULL DEFAULT 0,
	`device_label` varchar(255),
	`transports` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_used_at` timestamp,
	CONSTRAINT `auth_webauthn_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_webauthn_credentials_credential_id_unique` UNIQUE(`credential_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_attachment_chunks` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`attachment_id` bigint unsigned NOT NULL,
	`chunk_index` int NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_attachment_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_attachment_embeddings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chunk_id` bigint unsigned NOT NULL,
	`embedding` json NOT NULL,
	CONSTRAINT `chat_attachment_embeddings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_attachments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`conversation_id` bigint unsigned NOT NULL,
	`message_id` bigint unsigned,
	`original_name` varchar(255) NOT NULL,
	`stored_name` varchar(255) NOT NULL,
	`path` varchar(500) NOT NULL,
	`mime_type` varchar(150) NOT NULL,
	`size` bigint unsigned NOT NULL,
	`extracted_text` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chunk_embeddings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chunk_id` bigint unsigned,
	`embedding` json NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `chunk_embeddings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `device_trust` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`device_fingerprint` varchar(255),
	`token` varchar(128) NOT NULL,
	`pin_hash` varchar(255),
	`trusted_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `device_trust_id` PRIMARY KEY(`id`),
	CONSTRAINT `device_trust_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `document_analysis` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`file_id` bigint unsigned NOT NULL,
	`summary` text,
	`entities` json,
	`keywords` json,
	`topics` json,
	`language` varchar(50),
	`document_type` varchar(100),
	`confidence` float,
	`status` enum('pending','ingesting','summarizing','extracting','synthesizing','complete','error') DEFAULT 'pending',
	`error` text,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `document_analysis_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_analysis_file_id_unique` UNIQUE(`file_id`)
);
--> statement-breakpoint
CREATE TABLE `file_contents` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`file_id` bigint unsigned,
	`content` text NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `file_contents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forge_iterations` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`task_id` varchar(36) NOT NULL,
	`phase` enum('think','act','evaluate') NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forge_iterations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forge_sessions` (
	`id` varchar(36) NOT NULL,
	`goal` text NOT NULL,
	`stack_profile_id` varchar(64) NOT NULL,
	`custom_stack` text,
	`model_id` varchar(128) NOT NULL,
	`workspace_path` varchar(512) NOT NULL,
	`allocated_port` int NOT NULL,
	`status` enum('planning','running','paused','blocked','done','failed') NOT NULL DEFAULT 'planning',
	`shared_contracts` json NOT NULL,
	`iteration_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forge_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forge_task_nodes` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`parent_id` varchar(36),
	`description` text NOT NULL,
	`acceptance_criteria` text NOT NULL,
	`status` enum('pending','in_progress','done','failed','blocked') NOT NULL DEFAULT 'pending',
	`depends_on` json NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`is_integration_check` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forge_task_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forgex_output` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`stream` enum('stdout','stderr','system') NOT NULL,
	`text` text NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forgex_output_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forgex_sessions` (
	`id` varchar(36) NOT NULL,
	`goal` text NOT NULL,
	`model_id` varchar(128) NOT NULL,
	`workspace_path` varchar(512) NOT NULL,
	`status` enum('starting','running','idle','exited','failed') NOT NULL DEFAULT 'starting',
	`pid` int,
	`exit_code` int,
	`claude_session_id` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forgex_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `generated_videos` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`prompt` text NOT NULL,
	`negative_prompt` text,
	`provider` varchar(100),
	`model_used` varchar(255),
	`resolution` varchar(50),
	`steps` int,
	`cfg` float,
	`sampler` varchar(100),
	`scheduler` varchar(100),
	`seed` bigint,
	`frame_rate` int,
	`length` int,
	`fps` int,
	`duration_seconds` float,
	`format` enum('webp','mp4') DEFAULT 'webp',
	`scene_count` int DEFAULT 1,
	`scenes` json,
	`planning_model` varchar(100),
	`generation_time` int,
	`gpu_usage` float,
	`vram_usage` float,
	`video_url` varchar(500),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `generated_videos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_chunks` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`file_id` bigint unsigned,
	`chunk_index` int NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `knowledge_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`category` varchar(100),
	`memory_key` varchar(255) NOT NULL,
	`memory_value` text NOT NULL,
	`importance` float DEFAULT 1,
	`source` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `memories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_chunk_embeddings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`chunk_id` bigint unsigned NOT NULL,
	`embedding` json NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `memory_chunk_embeddings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_chunks` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`memory_id` bigint unsigned NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `memory_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_tool_calls` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`message_id` bigint unsigned NOT NULL,
	`round` int NOT NULL,
	`instruction` text,
	`tool` varchar(100) NOT NULL,
	`arguments` json,
	`result` longtext,
	`success` boolean NOT NULL DEFAULT true,
	`error` text,
	`thinking` longtext,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `message_tool_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(128) NOT NULL,
	`device_label` varchar(255),
	`method_used` enum('password','totp','pin','passkey') NOT NULL,
	`scope` enum('standard','forge_unlocked') NOT NULL DEFAULT 'standard',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`ip_last_seen` varchar(64),
	`revoked_at` timestamp,
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voice_conversations` (
	`id` varchar(36) NOT NULL,
	`title` varchar(255),
	`model_id` varchar(100) NOT NULL,
	`mode` enum('tts','stt','voice') NOT NULL,
	`provider_id` varchar(100),
	`speech_model_id` varchar(100),
	`voice_id` varchar(100),
	`summary` text,
	`summarized_message_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `voice_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voice_messages` (
	`id` varchar(36) NOT NULL,
	`conversation_id` varchar(36),
	`role` enum('user','assistant','system') NOT NULL,
	`content` longtext,
	`audio` longtext,
	`provider_id` varchar(100),
	`speech_model_id` varchar(100),
	`voice_id` varchar(100),
	`duration` float,
	`tokens_used` int DEFAULT 0,
	`response_time` int,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `voice_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `worker_api_keys` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`label` varchar(255) NOT NULL,
	`key_hash` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	`last_used_at` timestamp,
	CONSTRAINT `worker_api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `summarized_message_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generated_images` ADD `provider` varchar(100);--> statement-breakpoint
ALTER TABLE `generated_images` ADD `base_image_url` varchar(500);--> statement-breakpoint
ALTER TABLE `generated_images` ADD `upscaled_image_url` varchar(500);--> statement-breakpoint
ALTER TABLE `generated_images` ADD `pipeline_type` varchar(50);--> statement-breakpoint
ALTER TABLE `generated_images` ADD `hires_steps` int;--> statement-breakpoint
ALTER TABLE `generated_images` ADD `hires_denoise` float;--> statement-breakpoint
ALTER TABLE `generated_images` ADD `upscale_model` varchar(100);--> statement-breakpoint
ALTER TABLE `messages` ADD `thinking` longtext;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_extended` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `messages` ADD `execution_summary` longtext;--> statement-breakpoint
ALTER TABLE `chunk_embeddings` ADD CONSTRAINT `chunk_embeddings_chunk_id_knowledge_chunks_id_fk` FOREIGN KEY (`chunk_id`) REFERENCES `knowledge_chunks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_analysis` ADD CONSTRAINT `document_analysis_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `file_contents` ADD CONSTRAINT `file_contents_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `knowledge_chunks` ADD CONSTRAINT `knowledge_chunks_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_chunk_embeddings` ADD CONSTRAINT `memory_chunk_embeddings_chunk_id_memory_chunks_id_fk` FOREIGN KEY (`chunk_id`) REFERENCES `memory_chunks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_chunks` ADD CONSTRAINT `memory_chunks_memory_id_memories_id_fk` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `message_tool_calls` ADD CONSTRAINT `message_tool_calls_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `voice_messages` ADD CONSTRAINT `voice_messages_conversation_id_voice_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `voice_conversations`(`id`) ON DELETE no action ON UPDATE no action;