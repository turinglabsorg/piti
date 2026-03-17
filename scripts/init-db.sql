-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  first_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  profile JSONB DEFAULT '{}',
  llm_provider VARCHAR(50) DEFAULT 'claude' NOT NULL,
  llm_model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514' NOT NULL,
  language VARCHAR(50) DEFAULT 'english' NOT NULL
);

-- Conversation messages
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages(user_id);

-- Long-term memory with vector embeddings
CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories(user_id);

-- Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  purpose VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS token_usage_user_id_idx ON token_usage(user_id);
