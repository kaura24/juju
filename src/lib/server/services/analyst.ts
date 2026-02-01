/** File: src/lib/server/services/analyst.ts */
import type {
    NormalizedDoc,
    InsightsAnswerSet,
    NormalizedShareholder,
    MajorShareholderAnswer,
    UnknownAnswer,
    DocumentProperties,
    Decidability,
    ValidationReport,
    RuleTrigger
} from '$lib/types';
import { calculateEffectiveRatios } from '../logic/ownership';
import { logExecutionCheckpoint } from '../agentLogger';

/**
 * AnalystService
 * Integrates deterministic calculation logic with AI-driven synthesis reasoning.
 * Now synthesizes results from all agents (Extractor, Normalizer, Validator).
 */

export class AnalystService {

    /**
     * Generate the final insights report from the extracted data.
     */
    public async generateReport(
        runId: string,
        doc: NormalizedDoc,
        validationReport?: ValidationReport,
        imageUrls?: string[]
    ): Promise<InsightsAnswerSet> {
        logExecutionCheckpoint(runId, 'AnalystService', 'Starting generateReport');
        console.log(`[AnalystService] === Starting generateReport ===`);
        console.log(`[AnalystService] doc exists: ${!!doc}`);
        console.log(`[AnalystService] doc.shareholders: ${doc?.shareholders?.length ?? 'undefined'}`);
        console.log(`[AnalystService] doc.document_properties: ${!!doc?.document_properties}`);
        console.log(`[AnalystService] validationReport exists: ${!!validationReport}`);

        try {
            // Prepare data for Analyst Agent
            const { runAnalystAgent } = await import('../agents/analyst_agent');

            // ValidationReport is mandatory for the agent, if not provided we create a dummy but it should be there in Multi-Agent flow
            const vReport = validationReport || {
                status: 'PASS',
                triggers: [],
                summary_metrics: { total_records: doc.shareholders.length } as any
            };

            console.log(`[AnalystService] Calling runAnalystAgent...`);
            logExecutionCheckpoint(runId, 'AnalystService', 'Calling runAnalystAgent');
            const synthesis = await runAnalystAgent(runId, doc, vReport, imageUrls);
            logExecutionCheckpoint(runId, 'AnalystService', 'runAnalystAgent returned');
            console.log(`[AnalystService] runAnalystAgent completed. synthesis: ${JSON.stringify(synthesis).slice(0, 200)}`);

            const { shareholders, document_properties } = doc;
            console.log(`[AnalystService] doc.shareholders.length: ${shareholders.length}`);

            // 1. Calculate Effective Ratios (Deterministic)
            // Returns list with populated 'ratio' or null if indeterminable
            console.log(`[AnalystService] Calculating effective ratios...`);
            const effectiveShareholders = calculateEffectiveRatios(shareholders, document_properties);
            console.log(`[AnalystService] Effective ratios calculated. Count: ${effectiveShareholders.length}`);

            // 2. Check Data Sufficiency (Integrated Judgment)
            // AI's decidability is now the primary factor for "Normal/Abnormal"
            const ratioCoverage = effectiveShareholders.filter(s => s.ratio !== null).length;
            const totalCount = effectiveShareholders.length;

            // Final decidability is a synthesis of deterministic coverage and AI's logical judgment
            const isFullyDecidable = synthesis.is_decidable && totalCount > 0 && ratioCoverage === totalCount;

            // 3. Determine Ordering Rule
            const orderingRule = doc.ordering_detected || 'UNKNOWN';

            // 5. Over 25% Holders (내림차순 정렬)
            let over25: NormalizedShareholder[] | UnknownAnswer;
            if (isFullyDecidable) {
                const list = effectiveShareholders
                    .filter(s => (s.ratio || 0) >= 25)
                    .sort((a, b) => (b.ratio || 0) - (a.ratio || 0)); // 내림차순 정렬

                // [Fallback Logic] 만약 25% 이상이 없으면, 전체 중 가장 지분율이 높은 1인을 선정
                if (list.length === 0 && effectiveShareholders.length > 0) {
                    const sortedAll = [...effectiveShareholders].sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
                    const top1 = sortedAll[0];
                    if (top1 && (top1.ratio || 0) > 0) {
                        list.push(top1);
                        console.log(`[AnalystService] No 25%+ holder found. Using Top 1 fallback: ${top1.name} (${top1.ratio}%)`);
                    }
                }
                over25 = list;
            } else {
                over25 = {
                    UNKNOWN: true,
                    reason: synthesis.synthesis_reasoning
                };
            }

            // 6. Cannot Determine List
            const cannotDetermine: string[] = [];
            if (!isFullyDecidable) {
                cannotDetermine.push(synthesis.is_decidable ? '일부 주주 지분율 산출 불가' : '종합 분석에서 문서 부적합 판정');
            }

            // 7. Validation Summary
            const decidability: Decidability = {
                is_decidable: isFullyDecidable,
                reason: synthesis.synthesis_reasoning
            };

            const triggerSummary = (vReport.triggers && vReport.triggers.length > 0)
                ? `\n\n[정합성 검증 요약]\n- ${vReport.triggers.map(t => `${t.rule_id}: ${t.message}`).join('\n- ')}`
                : '';

            return {
                document_assessment: {
                    is_valid_shareholder_register: 'YES', // Assumed valid if we are here
                    evidence_refs: []
                },

                over_25_percent: over25,

                ordering_rule: orderingRule as "RATIO_DESC" | "SHARES_DESC" | "AMOUNT_DESC" | "UNKNOWN",

                totals: {
                    total_shares_declared: document_properties.total_shares_issued,
                    total_amount_declared: document_properties.total_capital
                },

                document_date: document_properties.document_date,
                document_date_staleness: (() => {
                    if (!document_properties.document_date) return undefined;
                    const docDate = new Date(document_properties.document_date);
                    const today = new Date('2026-01-25');
                    const diffTime = today.getTime() - docDate.getTime();
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    return {
                        is_stale: diffDays > 365,
                        days_diff: diffDays,
                        threshold_days: 365
                    };
                })(),
                company_name: document_properties.company_name,

                share_classes_found: [...new Set(effectiveShareholders.map(s => s.share_class).filter(Boolean) as string[])],

                // Calculate trust level based on ratio coverage
                trust_level: this.calculateTrustLevel(ratioCoverage, totalCount),

                cannot_determine: cannotDetermine,

                synthesis_reasoning: `${synthesis.synthesis_reasoning || ''}${triggerSummary}`.trim(),
                synthesis_confidence: synthesis.synthesis_confidence,

                validation_summary: {
                    ...vReport,
                    decidability
                }
            };
        } catch (err: any) {
            console.error(`[AnalystService] ERROR in generateReport:`, err);
            console.error(`[AnalystService] Error stack:`, err?.stack);
            logExecutionCheckpoint(runId, 'AnalystService', `ERROR: ${err.message}`);
            throw err;
        }
    }
    /**
     * S1: declared > 0
     * S2: no declared AND all shares present -> sum(shares)
     */
    private getReferencedTotalShares(shareholders: NormalizedShareholder[], props: DocumentProperties): number | null {
        if (props.total_shares_issued && props.total_shares_issued > 0) {
            return props.total_shares_issued;
        }

        const allHaveShares = shareholders.every(s => s.shares !== null);
        if (allHaveShares && shareholders.length > 0) {
            return shareholders.reduce((acc, s) => acc + (s.shares || 0), 0);
        }

        return null;
    }

    /**
     * A1: declared > 0
     * A2: no declared AND all amounts present -> sum(amount)
     */
    private getReferencedTotalAmount(shareholders: NormalizedShareholder[], props: DocumentProperties): number | null {
        if (props.total_capital && props.total_capital > 0) {
            return props.total_capital;
        }

        const allHaveAmounts = shareholders.every(s => s.amount !== null);
        if (allHaveAmounts && shareholders.length > 0) {
            return shareholders.reduce((acc, s) => acc + (s.amount || 0), 0);
        }

        return null;
    }

    /**
     * Calculate trust level based on ratio coverage
     */
    private calculateTrustLevel(ratioCoverage: number, totalCount: number): "HIGH" | "MEDIUM" | "LOW" {
        if (totalCount === 0) return "LOW";

        const coveragePercent = (ratioCoverage / totalCount) * 100;

        if (coveragePercent === 100) {
            return "HIGH";
        } else if (coveragePercent >= 70) {
            return "MEDIUM";
        } else {
            return "LOW";
        }
    }
}
