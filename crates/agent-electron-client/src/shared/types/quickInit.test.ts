import { describe, it, expect } from 'vitest';
import { hasRequiredQuickInitFields } from './quickInit';

describe('hasRequiredQuickInitFields', () => {
  it('should return true when serverHost and savedKey are present', () => {
    expect(hasRequiredQuickInitFields({
      serverHost: 'https://agent.nuwax.com',
      savedKey: 'key-123',
    })).toBe(true);
  });

  it('should return true with all fields present', () => {
    expect(hasRequiredQuickInitFields({
      serverHost: 'https://agent.nuwax.com',
      savedKey: 'key-123',
      username: 'user@example.com',
      agentPort: 60001,
      fileServerPort: 60000,
      workspaceDir: '/home/user/workspace',
    })).toBe(true);
  });

  it('should return false when serverHost is missing', () => {
    expect(hasRequiredQuickInitFields({ savedKey: 'key-123' })).toBe(false);
  });

  it('should return false when savedKey is missing', () => {
    expect(hasRequiredQuickInitFields({ serverHost: 'https://agent.nuwax.com' })).toBe(false);
  });

  it('should return false when serverHost is empty string', () => {
    expect(hasRequiredQuickInitFields({ serverHost: '', savedKey: 'key-123' })).toBe(false);
  });

  it('should return false when savedKey is empty string', () => {
    expect(hasRequiredQuickInitFields({ serverHost: 'https://agent.nuwax.com', savedKey: '' })).toBe(false);
  });

  it('should return false for null', () => {
    expect(hasRequiredQuickInitFields(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(hasRequiredQuickInitFields(undefined)).toBe(false);
  });

  it('should return false for non-object types', () => {
    expect(hasRequiredQuickInitFields('string')).toBe(false);
    expect(hasRequiredQuickInitFields(123)).toBe(false);
    expect(hasRequiredQuickInitFields(true)).toBe(false);
  });

  it('should return false when fields are wrong type', () => {
    expect(hasRequiredQuickInitFields({ serverHost: 123, savedKey: 'key' })).toBe(false);
    expect(hasRequiredQuickInitFields({ serverHost: 'host', savedKey: 456 })).toBe(false);
  });
});
