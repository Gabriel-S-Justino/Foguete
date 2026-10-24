-- Esquema inicial (Alembic 0001) para colar no SQL Editor do Neon. Gerado por: alembic upgrade head --sql
-- Seguro: só cria tabelas; não apaga dados.
BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TABLE player_sessions (
    id VARCHAR(36) NOT NULL, 
    player_name VARCHAR(32) NOT NULL, 
    token_hash VARCHAR(64) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_player_sessions_token_hash ON player_sessions (token_hash);

CREATE TABLE campaigns (
    id VARCHAR(64) NOT NULL, 
    session_id VARCHAR(36) NOT NULL, 
    mission_id VARCHAR(32), 
    stage VARCHAR(32) NOT NULL, 
    attempt INTEGER NOT NULL, 
    revision INTEGER NOT NULL, 
    state JSON NOT NULL, 
    catalog_versions JSON NOT NULL, 
    server_approved BOOLEAN, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(session_id) REFERENCES player_sessions (id) ON DELETE CASCADE
);

CREATE INDEX ix_campaigns_session_id ON campaigns (session_id);

CREATE TABLE flight_events (
    id SERIAL NOT NULL, 
    campaign_id VARCHAR(64) NOT NULL, 
    attempt INTEGER NOT NULL, 
    t FLOAT NOT NULL, 
    phase VARCHAR(32) NOT NULL, 
    event_id VARCHAR(80) NOT NULL, 
    label TEXT NOT NULL, 
    severity VARCHAR(16) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
);

CREATE INDEX ix_flight_events_campaign_id ON flight_events (campaign_id);

CREATE TABLE mission_reports (
    id SERIAL NOT NULL, 
    session_id VARCHAR(36) NOT NULL, 
    campaign_id VARCHAR(64) NOT NULL, 
    attempt INTEGER NOT NULL, 
    mission_id VARCHAR(32) NOT NULL, 
    classification VARCHAR(16) NOT NULL, 
    science_score FLOAT NOT NULL, 
    final_score FLOAT NOT NULL, 
    final_cost_usd FLOAT NOT NULL, 
    server_approved BOOLEAN NOT NULL, 
    server_blockers JSON NOT NULL, 
    report JSON NOT NULL, 
    catalog_versions JSON NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE, 
    FOREIGN KEY(session_id) REFERENCES player_sessions (id) ON DELETE CASCADE, 
    CONSTRAINT uq_report_attempt UNIQUE (campaign_id, attempt)
);

CREATE INDEX ix_mission_reports_campaign_id ON mission_reports (campaign_id);

CREATE INDEX ix_mission_reports_session_id ON mission_reports (session_id);

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

COMMIT;

