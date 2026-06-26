-- ============================================================
-- Table: drive_files
-- Merekam riwayat upload file ke 9drive
-- ============================================================
CREATE TABLE IF NOT EXISTS `drive_files` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `file_name` VARCHAR(255) NOT NULL COMMENT 'Nama file',
  `file_size` BIGINT NOT NULL DEFAULT 0 COMMENT 'Ukuran file dalam bytes',
  `file_id` VARCHAR(255) DEFAULT NULL COMMENT 'File ID dari 9drive (uuid), untuk download',
  `folder_id` VARCHAR(255) NOT NULL COMMENT 'Folder ID di 9drive',
  `upload_status` ENUM('success','failed') NOT NULL DEFAULT 'success' COMMENT 'Status upload',
  `response_data` JSON DEFAULT NULL COMMENT 'Response JSON dari API 9drive',
  `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu upload',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Waktu update terakhir',
  INDEX `idx_folder_id` (`folder_id`),
  INDEX `idx_uploaded_at` (`uploaded_at`),
  INDEX `idx_file_id` (`file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jika tabel sudah ada, jalankan ALTER berikut:
-- ALTER TABLE `drive_files` ADD COLUMN `file_id` VARCHAR(255) DEFAULT NULL COMMENT 'File ID dari 9drive (uuid)' AFTER `file_size`, ADD INDEX `idx_file_id` (`file_id`);
