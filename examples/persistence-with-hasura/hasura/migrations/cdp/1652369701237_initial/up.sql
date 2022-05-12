-- Store CDP events keyed to sequence numbers. Omit the trace, and
-- store trace items in a separate table. Store the timestamp
-- alongside the event.
CREATE TABLE "event" (
  "id" BIGSERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "data" JSONB,
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX "event_name" ON "event" ("name");

CREATE INDEX "event_timestamp" ON "event" ("timestamp");

-- Event traces can be stored independently.
CREATE TABLE "trace" (
  "id" BIGSERIAL PRIMARY KEY,
  "pipeline" VARCHAR(255) NOT NULL,
  "signature" VARCHAR(40) NOT NULL,
  "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
  "event_id" BIGINT NOT NULL REFERENCES "event" ("id")
);

CREATE INDEX "trace_pipeline" ON "trace" ("pipeline");

CREATE INDEX "trace_signature" ON "trace" ("signature");

CREATE INDEX "trace_timestamp" ON "trace" ("timestamp");

CREATE INDEX "trace_event_id" ON "trace" ("event_id");
