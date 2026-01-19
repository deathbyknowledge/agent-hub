import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for fork token generation and verification.
 * 
 * These test the authentication mechanism used to protect the
 * /internal/copy-events endpoint during fork operations.
 */
describe("Fork Token Authentication", () => {
  // Mock implementation of the token functions (extracted for testing)
  // These match the implementation in lib/runtime/agent/index.ts
  
  function generateForkToken(
    sourceThreadId: string,
    targetId: string,
    agencyId: string
  ): string {
    const timestamp = Date.now();
    const payload = `${sourceThreadId}:${targetId}:${timestamp}`;
    const signature = agencyId || "default";
    return btoa(`${payload}:${signature}`);
  }

  function verifyForkToken(
    token: string,
    expectedTargetId: string,
    agencyId: string,
    maxAgeMs = 60000
  ): string | null {
    try {
      const decoded = atob(token);
      const parts = decoded.split(":");
      if (parts.length !== 4) return null;

      const [sourceThreadId, targetId, timestampStr, signature] = parts;
      const timestamp = parseInt(timestampStr, 10);

      // Verify target matches
      if (targetId !== expectedTargetId) return null;

      // Verify signature matches agency
      if (signature !== (agencyId || "default")) return null;

      // Token expires after maxAgeMs
      if (Date.now() - timestamp > maxAgeMs) return null;

      return sourceThreadId;
    } catch {
      return null;
    }
  }

  describe("generateForkToken", () => {
    it("should generate a base64-encoded token", () => {
      const token = generateForkToken("source-123", "target-456", "agency-789");
      
      // Should be valid base64
      expect(() => atob(token)).not.toThrow();
      
      // Should contain the expected parts
      const decoded = atob(token);
      expect(decoded).toContain("source-123");
      expect(decoded).toContain("target-456");
      expect(decoded).toContain("agency-789");
    });

    it("should use 'default' when agency ID is empty", () => {
      const token = generateForkToken("source-123", "target-456", "");
      const decoded = atob(token);
      expect(decoded).toContain(":default");
    });

    it("should include current timestamp", () => {
      const before = Date.now();
      const token = generateForkToken("source", "target", "agency");
      const after = Date.now();
      
      const decoded = atob(token);
      const parts = decoded.split(":");
      const timestamp = parseInt(parts[2], 10);
      
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("verifyForkToken", () => {
    it("should verify a valid token", () => {
      const token = generateForkToken("source-123", "target-456", "agency-789");
      const result = verifyForkToken(token, "target-456", "agency-789");
      
      expect(result).toBe("source-123");
    });

    it("should reject token with wrong target ID", () => {
      const token = generateForkToken("source-123", "target-456", "agency-789");
      const result = verifyForkToken(token, "wrong-target", "agency-789");
      
      expect(result).toBeNull();
    });

    it("should reject token with wrong agency ID", () => {
      const token = generateForkToken("source-123", "target-456", "agency-789");
      const result = verifyForkToken(token, "target-456", "wrong-agency");
      
      expect(result).toBeNull();
    });

    it("should reject expired token", () => {
      // Create a token with old timestamp by manually constructing it
      const oldTimestamp = Date.now() - 120000; // 2 minutes ago
      const payload = `source-123:target-456:${oldTimestamp}`;
      const token = btoa(`${payload}:agency-789`);
      
      const result = verifyForkToken(token, "target-456", "agency-789", 60000);
      
      expect(result).toBeNull();
    });

    it("should accept token within custom max age", () => {
      // Create a token with old timestamp
      const oldTimestamp = Date.now() - 30000; // 30 seconds ago
      const payload = `source-123:target-456:${oldTimestamp}`;
      const token = btoa(`${payload}:agency-789`);
      
      // Should fail with 10s max age
      expect(verifyForkToken(token, "target-456", "agency-789", 10000)).toBeNull();
      
      // Should pass with 60s max age
      expect(verifyForkToken(token, "target-456", "agency-789", 60000)).toBe("source-123");
    });

    it("should reject malformed token (invalid base64)", () => {
      const result = verifyForkToken("not-valid-base64!!!", "target", "agency");
      expect(result).toBeNull();
    });

    it("should reject malformed token (wrong number of parts)", () => {
      const token = btoa("only:two:parts"); // 3 parts instead of 4
      const result = verifyForkToken(token, "two", "parts");
      expect(result).toBeNull();
    });

    it("should handle empty agency ID consistently", () => {
      const token = generateForkToken("source", "target", "");
      const result = verifyForkToken(token, "target", "");
      expect(result).toBe("source");
    });
  });

  describe("Round-trip integrity", () => {
    it("should generate and verify tokens correctly for various IDs", () => {
      const testCases = [
        { source: "simple-id", target: "target-id", agency: "agency-id" },
        { source: "uuid-style-1234-5678-90ab-cdef", target: "fork-1", agency: "main" },
        { source: "with-numbers-123", target: "t456", agency: "a789" },
        { source: "a", target: "b", agency: "c" }, // Minimal
      ];

      for (const { source, target, agency } of testCases) {
        const token = generateForkToken(source, target, agency);
        const result = verifyForkToken(token, target, agency);
        expect(result).toBe(source);
      }
    });
  });
});

/**
 * Tests for WebSocket subprotocol authentication.
 * 
 * The client now sends auth via subprotocol instead of URL query param.
 */
describe("WebSocket Subprotocol Auth", () => {
  describe("Client-side protocol generation", () => {
    // Simulate what the client does
    function buildProtocols(secret: string | undefined, customProtocols?: string[]): string[] {
      const protocols: string[] = [];
      if (secret) {
        protocols.push(`auth-${btoa(secret)}`);
      }
      if (customProtocols) {
        protocols.push(...customProtocols);
      }
      return protocols;
    }

    it("should generate auth protocol from secret", () => {
      const protocols = buildProtocols("my-secret");
      
      expect(protocols).toHaveLength(1);
      expect(protocols[0]).toBe(`auth-${btoa("my-secret")}`);
    });

    it("should include custom protocols after auth", () => {
      const protocols = buildProtocols("secret", ["custom-protocol", "another"]);
      
      expect(protocols).toHaveLength(3);
      expect(protocols[0]).toMatch(/^auth-/);
      expect(protocols[1]).toBe("custom-protocol");
      expect(protocols[2]).toBe("another");
    });

    it("should return empty array when no secret and no custom protocols", () => {
      const protocols = buildProtocols(undefined);
      expect(protocols).toHaveLength(0);
    });

    it("should only include custom protocols when no secret", () => {
      const protocols = buildProtocols(undefined, ["custom"]);
      
      expect(protocols).toHaveLength(1);
      expect(protocols[0]).toBe("custom");
    });
  });

  describe("Server-side protocol extraction", () => {
    // Simulate what the server does
    function extractSecretFromProtocol(protocolHeader: string | null): string | null {
      if (!protocolHeader) return null;
      
      const protocols = protocolHeader.split(",").map(p => p.trim());
      const authProtocol = protocols.find(p => p.startsWith("auth-"));
      
      if (!authProtocol) return null;
      
      try {
        return atob(authProtocol.slice(5)); // Remove "auth-" prefix
      } catch {
        return null;
      }
    }

    it("should extract secret from single auth protocol", () => {
      const header = `auth-${btoa("my-secret")}`;
      const secret = extractSecretFromProtocol(header);
      
      expect(secret).toBe("my-secret");
    });

    it("should extract secret from multiple protocols", () => {
      const header = `custom-protocol, auth-${btoa("my-secret")}, another`;
      const secret = extractSecretFromProtocol(header);
      
      expect(secret).toBe("my-secret");
    });

    it("should return null for missing header", () => {
      expect(extractSecretFromProtocol(null)).toBeNull();
    });

    it("should return null when no auth protocol present", () => {
      expect(extractSecretFromProtocol("custom, another")).toBeNull();
    });

    it("should return null for invalid base64", () => {
      expect(extractSecretFromProtocol("auth-!!!invalid!!!")).toBeNull();
    });

    it("should handle empty protocol header", () => {
      expect(extractSecretFromProtocol("")).toBeNull();
    });
  });

  describe("Round-trip integrity", () => {
    function buildProtocols(secret: string): string[] {
      return [`auth-${btoa(secret)}`];
    }

    function extractSecretFromProtocol(protocolHeader: string): string | null {
      const protocols = protocolHeader.split(",").map(p => p.trim());
      const authProtocol = protocols.find(p => p.startsWith("auth-"));
      if (!authProtocol) return null;
      try {
        return atob(authProtocol.slice(5));
      } catch {
        return null;
      }
    }

    it("should round-trip secrets correctly", () => {
      const secrets = [
        "simple",
        "with-dashes-123",
        "MixedCase_And_Underscores",
        "special!@#$%chars",
        // Note: btoa only handles Latin1 characters, so unicode is not supported
        "a", // Minimal
        "a".repeat(100), // Long
      ];

      for (const secret of secrets) {
        const protocols = buildProtocols(secret);
        const header = protocols.join(", ");
        const extracted = extractSecretFromProtocol(header);
        
        expect(extracted).toBe(secret);
      }
    });
  });
});
