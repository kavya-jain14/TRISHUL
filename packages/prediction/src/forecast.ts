import type {
  EvidenceGateState,
  Confidence,
  GeoCandidate
} from "../../contracts/src/case.ts";

export type ExitMode =
  | "CASH_OUT_LIKELY"
  | "TRANSFER_CONTINUES"
  | "MONITORING"
  | "UNKNOWN";

export type TimeBucket =
  | "LESS_THAN_30M"
  | "THIRTY_TO_SIXTY_M"
  | "ONE_TO_TWO_H"
  | "TWO_TO_SIX_H"
  | "SIX_TO_TWENTY_FOUR_H";

export type GeoPrediction = {
  status: EvidenceGateState;
  confidence: Confidence;
  candidates: GeoCandidate[];
  reasons: string[];
};

export type TimeBucketProbability = {
  bucket: TimeBucket;
  /** Probability represented as a number between 0 and 1 */
  probability: number;
};

export type TimePrediction = {
  status: EvidenceGateState;
  confidence: Confidence;
  buckets: TimeBucketProbability[];
  reasons: string[];
};

export type ForecastResult = {
  caseId: string;
  graphVersion: number;
  modelVersion: string;
  /** Evidence coverage represented as a number between 0 and 1 */
  evidenceCoverage: number;
  exitMode: ExitMode;
  geo: GeoPrediction;
  time: TimePrediction;
};
