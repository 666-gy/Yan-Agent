'use strict';

(require('path'));

const MAX_PROVIDER_OUTPUT_TOKENS = 32_768;

const TOOL_OUTPUT_MAX_LINES = 800;

const TOOL_OUTPUT_MAX_BYTES = 96 * 1024;

const DEFAULT_INPUT_TOKENS_PER_SECOND = 10_000;

const MAX_INPUT_TOKENS_PER_SECOND = 100_000;

const DEFAULT_PROVIDER_TIMEOUT_MS = false;

const DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS = 3 * 60 * 1000;

const MEMORY_TYPES = new Set([
  'preference',
  'environment',
  'project',
  'decision',
  'procedure',
  'failure_solution'
]);

const MEMORY_SCOPES = new Set(['global', 'machine', 'workspace']);

const MEMORY_EVIDENCE_BASES = new Set([
  'explicit_user_statement',
  'verified_tool_result',
  'successful_outcome',
  'project_artifact'
]);

const MEMORY_REVIEW_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['memories', 'skillCandidate', 'harnessCandidates', 'refinementOutcomes'],
  properties: {
    memories: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'key', 'type', 'scope', 'content', 'keywords', 'confidence', 'evidence',
          'basis', 'durable', 'verified', 'sensitive', 'transient'
        ],
        properties: {
          key: { type: 'string' },
          type: { type: 'string', enum: [...MEMORY_TYPES] },
          scope: { type: 'string', enum: [...MEMORY_SCOPES] },
          content: { type: 'string' },
          keywords: { type: 'array', maxItems: 16, items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0.1, maximum: 1 },
          evidence: { type: 'string' },
          basis: { type: 'string', enum: [...MEMORY_EVIDENCE_BASES] },
          durable: { type: 'boolean' },
          verified: { type: 'boolean' },
          sensitive: { type: 'boolean' },
          transient: { type: 'boolean' }
        }
      }
    },
    workState: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['done', 'pending', 'nextStep', 'evidence'],
          properties: {
            done: { type: 'string' },
            pending: { type: 'string' },
            nextStep: { type: 'string' },
            evidence: { type: 'string' }
          }
        }
      ]
    },
    skillCandidate: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'description', 'prompt', 'triggers', 'evidence'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            prompt: { type: 'string' },
            triggers: { type: 'array', maxItems: 12, items: { type: 'string' } },
            evidence: { type: 'string' }
          }
        }
      ]
    },
    harnessCandidates: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id', 'title', 'content', 'path', 'scope', 'evidence'],
        properties: {
          kind: { type: 'string', enum: ['prompt'] },
          id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          path: { type: 'string' },
          scope: { type: 'string', enum: ['global', 'workspace'] },
          evidence: { type: 'string' }
        }
      }
    },
    refinementOutcomes: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['refinementId', 'status', 'evidence'],
        properties: {
          refinementId: { type: 'string' },
          status: { type: 'string', enum: ['verified', 'rejected', 'partial'] },
          evidence: { type: 'string' }
        }
      }
    }
  }
});

module.exports = { MAX_PROVIDER_OUTPUT_TOKENS, TOOL_OUTPUT_MAX_LINES, TOOL_OUTPUT_MAX_BYTES, DEFAULT_INPUT_TOKENS_PER_SECOND, MAX_INPUT_TOKENS_PER_SECOND, DEFAULT_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS, MEMORY_TYPES, MEMORY_SCOPES, MEMORY_EVIDENCE_BASES, MEMORY_REVIEW_SCHEMA };
