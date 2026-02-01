
import { calculateEffectiveRatios } from '../src/lib/server/logic/ownership';
import type { NormalizedShareholder, DocumentProperties } from '../src/lib/types';

// Mock Data: Single Shareholder with 0% AI hallucination
const shareholders: NormalizedShareholder[] = [
    {
        name: "김성룡",
        shares: 10000,
        ratio: 0, // AI Hallucination
        amount: null,
        identifier: "650128-1******",
        identifier_type: "RESIDENT_ID",
        entity_type: "INDIVIDUAL",
        confidence: 0.9,
        evidence_refs: [],
        unknown_reasons: []
    }
];

const docProps: DocumentProperties = {
    company_name: "테스트 주식회사",
    total_shares_issued: 10000,
    total_capital: 50000000,
    document_date: "2025-01-01",
    document_type: "주주명부",
    page_count: 1,
    ownership_basis: "SHARES",
    has_total_row: true
};

console.log("Running Ownership Logic Test...");
const result = calculateEffectiveRatios(shareholders, docProps);

if (result[0].ratio === 100) {
    console.log("SUCCESS: Ratio corrected to 100%");
} else {
    console.error(`FAILURE: Ratio is ${result[0].ratio}% (Expected 100%)`);
    process.exit(1);
}
