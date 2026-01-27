/** File: src/lib/server/agents/analyst_agent.ts */
import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import { MODEL } from '../agents';
import type { NormalizedDoc, ValidationReport } from '$lib/types';
import { ensureApiKey } from '../agents';

const AnalystSynthesisSchema = z.object({
    synthesis_reasoning: z.union([
        z.string(),
        z.array(z.any()).transform(arr => {
            return arr.map(item => {
                if (typeof item === 'string') return item;
                return JSON.stringify(item);
            }).join('\n');
        })
    ]).optional().default("분석 완료").describe("데이터 정합성 및 추출 결과에 대한 종합 분석 소견"),
    synthesis_confidence: z.number().optional().default(0.5).describe("분석 결과에 대한 신뢰도 (0.0 ~ 1.0)"),
    is_decidable: z.boolean().optional().default(true).describe("최종적으로 이 문서를 확정된 주주명부로 볼 수 있는지 여부"),
    major_shareholder_name: z.string().nullable().optional().default(null).describe("판별된 최대주주 성명"),
    major_shareholder_ratio: z.number().nullable().optional().default(null).describe("판별된 최대주주 지분율")
});

const INSTRUCTIONS = `
당신은 금융회사의 **여신심사역(Loan Analyst)**으로서 주주명부를 검토하고 있습니다.
**주요 목적**: **실제 소유주(Beneficial Owner) 확인**을 위해 고객사가 제출한 주주명부의 정합성을 평가하고 심사 의견을 작성해야 합니다.

**분석 대상**: 추출된 주주 데이터(JSON)와 규칙 기반 검증 결과(Validation Report)

**심사 수행 사항**:

1. **정합성 검토**: 
   - 주주명부에 기재된 주식수 합계와 개별 주주 보유주식의 합이 일치하는지 확인
   - 개별 주주의 지분율 합계가 100%인지 확인
   - 주식수와 지분율 간 교차 검증 실시

2. **불일치 원인 분석** (E-RAT-001, E-SUM-001 등 발생 시):
   - "주주명부에 기재된 총 발행주식수는 X주이나, 개별 주주 보유주식의 합계는 Y주로 Z주(Z%)의 차이가 발생함"
   - "개별 주주 지분율의 합계가 X%로, 100%와 Y%p 차이 발생"
   - **실제 소유주 파악 관점**에서 특정 주주의 데이터 오기, 누락 또는 은폐 가능성 검토

3. **심사 소견 작성** (\`synthesis_reasoning\`):
   - 금융권 심사 보고서 형식의 간결하고 전문적인 어투 사용
   - **데이터 근거 중심 설명 (JSON 기반)**: 단순히 "오류가 있다"고 하지 말고, 제공된 [Extracted Data]와 [Validation Report] JSON 데이터를 분석하여 구체적인 이유를 설명하십시오.
     - 예: "Validator의 E-META-002 규칙에 따라 발행일 미상으로 판정됨. 원본 데이터 내에 날짜 형식이 식별되지 않거나 오염되었을 가능성이 큼."
   - **실소유주(Beneficial Owner) 판정 로직 적용**:
     - **1단계 (25% 이상)**: 지분율이 25% 이상인 주주를 우선적으로 나열함.
     - **2단계 (25% 미만)**: 1단계에 해당하는 주주가 한 명도 없는 경우, 가장 지분이 높은 주주 1인을 찾아 **"최대주주 (25% 미만)"**로 독립 기술함.
   - **⚠️ 중요: 레이블링 제한**: "24% 주주", "10% 주주"와 같이 특정 지분율을 서술형 레이블로 사용하지 마십시오. 오직 **"25% 이상"** 또는 **"(25% 미만)"** 두 가지 카테고리 구분만 사용하십시오.
   - **식별된 주주 상세 현황 포함**: 소견 시작 부분이나 관련 맥락에서 식별된 주주들의 구체적인 정보(성명, 주식수, 지분율)를 나열하여 근거를 제시할 것
   - **실제 소유주 확인**에 데이터 문제(식별번호 누락 등)가 미치는 영향 중심으로 기술
   - 객관적 사실 기반으로 작성하고, 추측 시에는 "~가능성 있음", "~추정됨" 등 표현 사용
   - **식별정보 평가 기준**:
     - 개인 주주: **생년월일(YYYY-MM-DD)**만 있으면 충분한 식별 정보로 간주함.
     - 법인 주주: **사업자번호** 또는 **법인등록번호** 중 하나만 있으면 충분함.
   - **보정 표시**: normalization_notes에 "성명 오타 교정" 또는 "성명 의심" 기록이 있는 주주는, 성명 뒤에 **'(확인 필요)'**를 덧붙여 출력할 것.

4. **최종 판정** (\`is_decidable\`):
   - 정합성이 확보되고 **실제 소유주 식별**에 문제가 없는 경우: true
   - 데이터 불일치 또는 중요 식별정보 누락으로 소유주 확인이 불가능한 경우: false

**작성 시 유의사항**:
- "선언된" 대신 "기재된", "명부에 기재된" 등 사용
- "오차가 발생했습니다" 대신 "차이가 발생함", "불일치함" 등 사용
- 경어체(-습니다) 대신 간결한 서술체(-함, -임, -됨) 사용
- 금융권 심사보고서 형식에 맞는 전문적 어투 유지
`;

export async function runAnalystAgent(
    doc: NormalizedDoc,
    validationReport: ValidationReport,
    imageUrls?: string[]
): Promise<z.infer<typeof AnalystSynthesisSchema>> {
    console.log(`\n[AnalystAgent] ========== STARTING ==========`);
    console.log(`[AnalystAgent] doc exists: ${!!doc}`);
    console.log(`[AnalystAgent] doc.shareholders: ${doc?.shareholders?.length ?? 'undefined'}`);
    console.log(`[AnalystAgent] doc.document_properties: ${JSON.stringify(doc?.document_properties).slice(0, 100)}`);
    console.log(`[AnalystAgent] validationReport.status: ${validationReport?.status}`);
    console.log(`[AnalystAgent] validationReport.triggers: ${validationReport?.triggers?.length ?? 'undefined'}`);

    console.log(`[AnalystAgent] Step 1: Creating Agent...`);
    const agent = new Agent({
        name: 'Analyst Agent',
        model: MODEL,
        instructions: INSTRUCTIONS,
    });
    console.log(`[AnalystAgent] Agent created.`);

    console.log(`[AnalystAgent] Step 2: ensureApiKey...`);
    ensureApiKey();
    console.log(`[AnalystAgent] API Key ensured.`);

    console.log(`[AnalystAgent] Step 3: Building input...`);
    const remoteImageContents = (imageUrls || []).map(url => ({
        type: 'input_image' as const,
        imageUrl: url
    }));

    const input = [
        {
            role: 'user' as const,
            content: [
                ...remoteImageContents,
                {
                    type: 'input_text' as const,
                    text: `
[Extracted Data]
${JSON.stringify({
                        properties: doc.document_properties,
                        shareholders: doc.shareholders.map(s => ({
                            name: s.name,
                            shares: s.shares,
                            ratio: s.ratio,
                            id: s.identifier
                        }))
                    }, null, 2)}

[Validation Report]
${JSON.stringify(validationReport, null, 2)}

위 데이터를 바탕으로 종합 분석 소견을 작성하고 최종 결론을 내려줘. 반드시 JSON 형식으로만 응답하세요.
`
                }
            ]
        }
    ];
    console.log(`[AnalystAgent] Input built. Size: ${JSON.stringify(input).length} chars`);

    try {
        console.log(`[AnalystAgent] Step 4: Calling openai/agents run()...`);
        const result = await run(agent, input);
        console.log(`[AnalystAgent] run() completed. Result keys: ${Object.keys(result)}`);

        let jsonStr = result.finalOutput || '';

        if (jsonStr.includes('```')) {
            const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) jsonStr = match[1];
        }

        const parsed = JSON.parse(jsonStr.trim());
        return AnalystSynthesisSchema.parse(parsed);
    } catch (err: any) {
        console.error('\n\n========== [AnalystAgent] ERROR ==========');
        console.error('[AnalystAgent] Error message:', err?.message);
        console.error('[AnalystAgent] Error name:', err?.name);
        console.error('[AnalystAgent] Error stack:', err?.stack);
        console.error('[AnalystAgent] Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        console.error('==========================================\n\n');

        // Fallback for safety
        return {
            synthesis_reasoning: `AI 분석 도중 오류가 발생했습니다: ${err?.message || 'Unknown Error'}. 규칙 기반 검증 결과를 참고하십시오.`,
            synthesis_confidence: 0,
            is_decidable: false,
            major_shareholder_name: null,
            major_shareholder_ratio: null
        };
    }
}
