import { makeLogger } from "../log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/amqp");

/**
 * Options for this input form.
 */
export interface AMQPInputOptions {
  url: string;
  exchange: {
    name: string;
    type: "direct" | "fanout" | "topic";
    durable?: boolean | "true" | "false";
    "auto-delete"?: boolean | "true" | "false";
  };
  "routing-key"?: string;
  queue?: {
    name?: string;
    durable?: boolean | "true" | "false";
    "auto-delete"?: boolean | "true" | "false";
    "message-ttl"?: number | string;
    "dead-letter-exchange"?: string;
    "max-length"?: number | string;
    "max-priority"?: number | string;
  };
}

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  type: "object",
  properties: {
    url: { type: "string", pattern: "^ampqs?://.*$" },
    exchange: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        type: { enum: ["direct", "fanout", "topic"] },
        durable: { anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }] },
        "auto-delete": {
          anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }],
        },
      },
      additionalProperties: false,
      required: ["name", "type"],
    },
    "routing-key": { type: "string" },
    queue: {
      type: "object",
      properties: {
        name: { type: "string" },
        durable: { anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }] },
        "auto-delete": {
          anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }],
        },
        "message-ttl": {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 4294967295 },
            { type: "string", pattern: "^[0-9]+$" },
          ],
        },
        "dead-letter-exchange": { type: "string", minLength: 1 },
        "max-length": {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
        "max-priority": {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 255 },
            { type: "string", pattern: "^[0-9]+$" },
          ],
        },
      },
      additionalProperties: false,
      required: [],
    },
  },
  additionalProperties: false,
  required: ["url", "exchange"],
};
