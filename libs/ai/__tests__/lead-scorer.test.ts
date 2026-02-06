import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scoreLeads, filterByThreshold, sortByScore } from "../lead-scorer";
import type { MergedLead } from "@/libs/services/lead-merger-types";
import type { ParsedSearchParams } from "@/types/search";

// Mock del provider de IA
vi.mock("../provider", () => ({
  aiCompletion: vi.fn(),
}));

import { aiCompletion } from "../provider";

const mockAiCompletion = vi.mocked(aiCompletion);

// Datos de prueba
const mockParsedQuery: ParsedSearchParams = {
  keywords: ["energy"],
  jobTitles: ["CEO", "Director"],
  location: { city: "Barcelona", country: "Spain" },
  industry: ["energy", "utilities"],
  seniority: ["director", "c-suite"],
};

function createMockLead(overrides: Partial<MergedLead> = {}): MergedLead {
  return {
    id: crypto.randomUUID(),
    linkedinId: "linkedin123",
    googlePlaceId: null,
    fullName: "Juan Garcia",
    firstName: "Juan",
    lastName: "Garcia",
    jobTitle: "CEO",
    headline: "CEO at Energy Corp",
    linkedinUrl: "https://linkedin.com/in/juangarcia",
    profilePictureUrl: null,
    networkDistance: null,
    companyName: "Energy Corp",
    companyWebsite: "https://energycorp.com",
    companyPhone: null,
    companyAddress: "Barcelona, Spain",
    companyRating: 4.5,
    companyIndustry: "Energy",
    city: "Barcelona",
    region: "Catalonia",
    country: "Spain",
    sources: ["linkedin"],
    matchConfidence: "high",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("lead-scorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("scoreLeads", () => {
    it("should return empty result for empty leads array", async () => {
      const result = await scoreLeads([], mockParsedQuery);

      expect(result.success).toBe(true);
      expect(result.scoredLeads).toHaveLength(0);
      expect(result.stats.totalLeads).toBe(0);
      expect(mockAiCompletion).not.toHaveBeenCalled();
    });

    it("should score a single lead correctly", async () => {
      const lead = createMockLead();

      mockAiCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          scores: [
            {
              id: lead.id,
              score: 85,
              explanation: "CEO en empresa de energia en Barcelona",
              confidence: "high",
            },
          ],
        }),
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await scoreLeads([lead], mockParsedQuery);

      expect(result.success).toBe(true);
      expect(result.scoredLeads).toHaveLength(1);
      expect(result.scoredLeads[0]).toEqual({
        id: lead.id,
        score: 85,
        explanation: "CEO en empresa de energia en Barcelona",
        confidence: "high",
      });
      expect(result.stats.totalLeads).toBe(1);
      expect(result.stats.scoredLeads).toBe(1);
      expect(result.stats.avgScore).toBe(85);
      expect(result.stats.leadsAboveThreshold).toBe(1);
    });

    it("should process leads in batches of 10", async () => {
      const leads = Array.from({ length: 25 }, (_, i) =>
        createMockLead({ id: `lead-${i}`, fullName: `Lead ${i}` })
      );

      // Mock 3 batch calls (10 + 10 + 5)
      mockAiCompletion
        .mockResolvedValueOnce({
          content: JSON.stringify({
            scores: leads.slice(0, 10).map((l) => ({
              id: l.id,
              score: 80,
              explanation: "Good match",
              confidence: "high",
            })),
          }),
          model: "claude-sonnet-4",
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            scores: leads.slice(10, 20).map((l) => ({
              id: l.id,
              score: 70,
              explanation: "Medium match",
              confidence: "medium",
            })),
          }),
          model: "claude-sonnet-4",
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            scores: leads.slice(20, 25).map((l) => ({
              id: l.id,
              score: 60,
              explanation: "Fair match",
              confidence: "medium",
            })),
          }),
          model: "claude-sonnet-4",
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      const result = await scoreLeads(leads, mockParsedQuery);

      expect(mockAiCompletion).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
      expect(result.scoredLeads).toHaveLength(25);
      expect(result.stats.batchesProcessed).toBe(3);
    });

    it("should handle AI errors gracefully", async () => {
      const leads = [createMockLead()];

      mockAiCompletion.mockRejectedValueOnce(new Error("API Error"));

      const result = await scoreLeads(leads, mockParsedQuery);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Batch 1: API Error");
      expect(result.scoredLeads).toHaveLength(1);
      expect(result.scoredLeads[0]?.score).toBe(0);
      expect(result.scoredLeads[0]?.confidence).toBe("low");
    });

    it("should handle invalid JSON response", async () => {
      const lead = createMockLead();

      mockAiCompletion.mockResolvedValueOnce({
        content: "This is not valid JSON",
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await scoreLeads([lead], mockParsedQuery);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle missing required fields in response", async () => {
      const lead = createMockLead();

      mockAiCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          scores: [
            {
              id: lead.id,
              score: 85,
              // missing explanation and confidence
            },
          ],
        }),
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await scoreLeads([lead], mockParsedQuery);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should use custom batch size when provided", async () => {
      const leads = Array.from({ length: 10 }, (_, i) =>
        createMockLead({ id: `lead-${i}` })
      );

      // With batch size of 5, expect 2 calls
      mockAiCompletion
        .mockResolvedValueOnce({
          content: JSON.stringify({
            scores: leads.slice(0, 5).map((l) => ({
              id: l.id,
              score: 80,
              explanation: "Match",
              confidence: "high",
            })),
          }),
          model: "claude-sonnet-4",
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            scores: leads.slice(5, 10).map((l) => ({
              id: l.id,
              score: 75,
              explanation: "Match",
              confidence: "medium",
            })),
          }),
          model: "claude-sonnet-4",
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      const result = await scoreLeads(leads, mockParsedQuery, { batchSize: 5 });

      expect(mockAiCompletion).toHaveBeenCalledTimes(2);
      expect(result.stats.batchesProcessed).toBe(2);
    });

    it("should calculate correct average score", async () => {
      const leads = [
        createMockLead({ id: "lead-1" }),
        createMockLead({ id: "lead-2" }),
        createMockLead({ id: "lead-3" }),
      ];

      mockAiCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          scores: [
            { id: "lead-1", score: 90, explanation: "Excellent", confidence: "high" },
            { id: "lead-2", score: 70, explanation: "Good", confidence: "medium" },
            { id: "lead-3", score: 50, explanation: "Fair", confidence: "low" },
          ],
        }),
        model: "claude-sonnet-4",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await scoreLeads(leads, mockParsedQuery);

      // (90 + 70 + 50) / 3 = 70
      expect(result.stats.avgScore).toBe(70);
      expect(result.stats.leadsAboveThreshold).toBe(2); // 90 and 70 are >= 60
    });
  });

  describe("filterByThreshold", () => {
    it("should filter leads below threshold", () => {
      const scoredLeads = [
        { id: "1", score: 80, explanation: "Good", confidence: "high" as const },
        { id: "2", score: 50, explanation: "Poor", confidence: "low" as const },
        { id: "3", score: 70, explanation: "Medium", confidence: "medium" as const },
        { id: "4", score: 30, explanation: "Bad", confidence: "low" as const },
      ];

      const filtered = filterByThreshold(scoredLeads, 60);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((l) => l.id)).toEqual(["1", "3"]);
    });

    it("should use default threshold of 60", () => {
      const scoredLeads = [
        { id: "1", score: 60, explanation: "Border", confidence: "medium" as const },
        { id: "2", score: 59, explanation: "Below", confidence: "low" as const },
      ];

      const filtered = filterByThreshold(scoredLeads);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe("1");
    });
  });

  describe("sortByScore", () => {
    it("should sort leads by score descending", () => {
      const scoredLeads = [
        { id: "1", score: 50, explanation: "Low", confidence: "low" as const },
        { id: "2", score: 90, explanation: "High", confidence: "high" as const },
        { id: "3", score: 70, explanation: "Medium", confidence: "medium" as const },
      ];

      const sorted = sortByScore(scoredLeads);

      expect(sorted.map((l) => l.id)).toEqual(["2", "3", "1"]);
      expect(sorted[0]?.score).toBe(90);
      expect(sorted[1]?.score).toBe(70);
      expect(sorted[2]?.score).toBe(50);
    });

    it("should not mutate original array", () => {
      const scoredLeads = [
        { id: "1", score: 50, explanation: "Low", confidence: "low" as const },
        { id: "2", score: 90, explanation: "High", confidence: "high" as const },
      ];

      const sorted = sortByScore(scoredLeads);

      expect(scoredLeads[0]?.id).toBe("1"); // Original unchanged
      expect(sorted[0]?.id).toBe("2"); // Sorted is different
    });
  });
});
