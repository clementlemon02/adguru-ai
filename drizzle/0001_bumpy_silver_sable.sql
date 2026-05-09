CREATE TABLE `critiques` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('uploading','analyzing','generating_voice','rendering','completed','failed') NOT NULL DEFAULT 'uploading',
	`originalVideoKey` varchar(512),
	`originalVideoUrl` text,
	`critiqueVideoKey` varchar(512),
	`critiqueVideoUrl` text,
	`reportJson` json,
	`errorMessage` text,
	`processingStep` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `critiques_id` PRIMARY KEY(`id`)
);
