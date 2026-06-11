CREATE TABLE IF NOT EXISTS tbl_sessions (
  id VARCHAR(64) PRIMARY KEY,
  session_name VARCHAR(120) NOT NULL UNIQUE,
  phone_number VARCHAR(32) NULL,
  status ENUM('connecting', 'qr_required', 'connected', 'disconnected') NOT NULL DEFAULT 'connecting',
  last_activity DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbl_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(128) NULL,
  session_id VARCHAR(64) NOT NULL,
  direction ENUM('incoming', 'outgoing') NOT NULL,
  phone VARCHAR(32) NOT NULL,
  message TEXT NULL,
  media_path VARCHAR(500) NULL,
  media_type VARCHAR(50) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'received',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_session_created (session_id, created_at),
  INDEX idx_messages_phone_created (phone, created_at),
  CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES tbl_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tbl_contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(32) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contacts_name (name)
);

CREATE TABLE IF NOT EXISTS tbl_webhooks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  url VARCHAR(500) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  events JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
