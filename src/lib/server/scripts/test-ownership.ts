
import { calculateEffectiveRatios } from '../logic/ownership';
import type { NormalizedShareholder, DocumentProperties } from '$lib/types';

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
        entity_type_confidence: 0.9,
        entity_signals: { raw_signals: [] },
        share_class: null,
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
    ownership_basis: "SHARE_COUNT",
    has_total_row: true,
    par_value_per_share: null,
    company_business_reg_number: null,
    company_corporate_reg_number: null,
    total_row_values: null,
    authorized_shares: null
};

console.log("Running Ownership Logic Test...");
const result = calculateEffectiveRatios(shareholders, docProps);

if (result[0].ratio === 100) {
    console.log("SUCCESS: Ratio corrected to 100%");
} else {
    console.error(`FAILURE: Ratio is ${result[0].ratio}% (Expected 100%)`);
    process.exit(1);
}
