-- Podex Database Initialization Script
-- Only creates extensions - schema is managed by Alembic migrations

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable trigram extension for text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
