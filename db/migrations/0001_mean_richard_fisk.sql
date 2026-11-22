ALTER TABLE `generated_images` ADD `cfg` float;--> statement-breakpoint
ALTER TABLE `generated_images` ADD `denoise` float;--> statement-breakpoint
ALTER TABLE `generated_images` ADD `batch_size` int;--> statement-breakpoint
ALTER TABLE `generated_images` ADD `scheduler` varchar(100);