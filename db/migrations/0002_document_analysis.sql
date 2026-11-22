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
ALTER TABLE `document_analysis` ADD CONSTRAINT `document_analysis_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE cascade ON UPDATE no action;
