import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExitMode,
  TimeBucket,
  GeoPrediction,
  TimePrediction,
  ForecastResult
} from "./index.ts";

test("ForecastResult contract structure", () => {
  const exitMode: ExitMode = "CASH_OUT_LIKELY";
  const timeBucket: TimeBucket = "THIRTY_TO_SIXTY_M";

  const geoPrediction: GeoPrediction = {
    status: "PREDICT",
    confidence: "HIGH",
    candidates: [
      {
        locationId: "loc-1",
        label: "ATM Branch A",
        latitude: 12.9716,
        longitude: 77.5946,
        historicalWeight: 0.85
      }
    ],
    reasons: ["High historical ATM activity"]
  };

  const timePrediction: TimePrediction = {
    status: "PREDICT",
    confidence: "HIGH",
    buckets: [
      {
        bucket: timeBucket,
        probability: 0.75
      }
    ],
    reasons: ["Peak activity window"]
  };

  const result: ForecastResult = {
    caseId: "case-123",
    graphVersion: 1,
    modelVersion: "v1.0.0",
    evidenceCoverage: 0.9,
    exitMode,
    geo: geoPrediction,
    time: timePrediction
  };

  assert.equal(result.caseId, "case-123");
  assert.equal(result.evidenceCoverage, 0.9);
  assert.equal(result.exitMode, "CASH_OUT_LIKELY");
  assert.equal(result.geo.candidates.length, 1);
  assert.equal(result.time.buckets[0]?.probability, 0.75);
});
