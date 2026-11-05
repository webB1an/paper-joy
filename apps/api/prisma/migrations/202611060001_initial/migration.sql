-- CreateTable
CREATE TABLE `Resource` (
    `id` VARCHAR(36) NOT NULL,
    `slug` VARCHAR(180) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `categoryId` VARCHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `data` JSON NOT NULL,
    `sourceHash` VARCHAR(64) NULL,
    `sourcePath` VARCHAR(500) NULL,
    `sourceBytes` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Resource_slug_key`(`slug`),
    UNIQUE INDEX `Resource_sourceHash_key`(`sourceHash`),
    INDEX `Resource_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Taxonomy` (
    `id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `slug` VARCHAR(180) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `coverUrl` VARCHAR(500) NULL,

    UNIQUE INDEX `Taxonomy_kind_slug_key`(`kind`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DriveLink` (
    `id` VARCHAR(36) NOT NULL,
    `resourceId` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(10) NOT NULL,
    `url` VARCHAR(1000) NOT NULL,
    `extractionCode` VARCHAR(32) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `code` VARCHAR(36) NOT NULL,

    UNIQUE INDEX `DriveLink_code_key`(`code`),
    UNIQUE INDEX `DriveLink_resourceId_provider_key`(`resourceId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(36) NOT NULL,
    `openid` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_openid_key`(`openid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Favorite` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `resourceId` VARCHAR(36) NOT NULL,

    UNIQUE INDEX `Favorite_userId_resourceId_key`(`userId`, `resourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Claim` (
    `id` VARCHAR(36) NOT NULL,
    `identity` VARCHAR(160) NOT NULL,
    `resourceId` VARCHAR(36) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `response` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Claim_identity_resourceId_requestId_key`(`identity`, `resourceId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reward` (
    `id` VARCHAR(36) NOT NULL,
    `identity` VARCHAR(160) NOT NULL,
    `resourceId` VARCHAR(36) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Reward_identity_resourceId_requestId_key`(`identity`, `resourceId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` VARCHAR(36) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `resourceId` VARCHAR(36) NULL,
    `identity` VARCHAR(160) NOT NULL,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Event_requestId_key`(`requestId`),
    INDEX `Event_identity_type_createdAt_idx`(`identity`, `type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feedback` (
    `id` VARCHAR(36) NOT NULL,
    `resourceId` VARCHAR(36) NULL,
    `type` VARCHAR(20) NOT NULL,
    `message` TEXT NOT NULL,
    `contact` VARCHAR(200) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportBatch` (
    `id` VARCHAR(36) NOT NULL,
    `resourceId` VARCHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
    `message` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ImportBatch_resourceId_key`(`resourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageAccount` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `provider` VARCHAR(10) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'UNAUTHORIZED',
    `lastError` VARCHAR(300) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `activeResourceId` VARCHAR(36) NULL,
    `id` VARCHAR(36) NOT NULL,
    `resourceId` VARCHAR(36) NOT NULL,
    `baiduAccountId` VARCHAR(36) NOT NULL,
    `quarkAccountId` VARCHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `checkpoints` JSON NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Task_activeResourceId_key`(`activeResourceId`),
    INDEX `Task_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DriveLink` ADD CONSTRAINT `DriveLink_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `Resource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
