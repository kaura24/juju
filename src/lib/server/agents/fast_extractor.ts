/**
 * FastExtractor Agent
 * - Gatekeeper + Extractor + Normalizer 통합
 * - 한 번의 호출로 검증, 추출, 정규화를 수행
 * - 속도 최적화 모드 (Fast Track)
 */

/** File: src/lib/server/agents/fast_extractor.ts */
import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import { MODEL } from '../agents';
import { ensureApiKey } from '../agents';

// ============================================
// Helper: Debug Logger
// ============================================
function logDebug(message: string, data?: any) {
    const ts = new Date().toISOString();
    console.log(`[DEBUG][${ts}] ${message}`);
    if (data) {
        // Truncate huge data to avoid console flooding
        const str = JSON.stringify(data, null, 2);
        if (str.length > 2000) {
            console.log(str.substring(0, 2000) + '... (truncated)');
        } else {
            console.log(str);
        }
    }
}

// ============================================
// Schema Definition
// ============================================

const FastExtractionSchema = z.object({
    // 1. Gatekeeper Logic
    is_valid_shareholder_register: z.boolean().describe("문서가 주주명부(또는 유사 문서)인지 여부"),
    rejection_reason: z.string().optional().describe("주주명부가 아닌 경우 거부 사유"),

    // 2. Extractor + Normalizer + Analyst Logic
    shareholders: z.array(z.object({
        name: z.string().describe("주주명 (정규화됨)"),
        entity_type: z.enum(['INDIVIDUAL', 'CORPORATE', 'UNKNOWN']).describe("주주 유형"),
        identifier: z.string().nullable().describe("주민번호/법인번호/사업자번호 (하이픈 포함 추천)"),
        shares: z.number().nullable().describe("보유 주식수"),
        ratio: z.number().nullable().describe("지분율 (%)"),
        amount: z.number().nullable().describe("투자 금액 (원)"),
        share_class: z.string().nullable().describe("주식 종류 (보통주/우선주 등)"),
        remarks: z.string().nullable().describe("비고")
    })).describe("추출된 주주 목록"),

    over_25_percent_holders: z.array(z.object({
        name: z.string(),
        ratio: z.number(),
        shares: z.number().nullable().optional().describe("보유 주식수"),
        identifier: z.string().nullable().describe("주민번호/사업자번호"),
        entity_type: z.enum(['INDIVIDUAL', 'CORPORATE', 'UNKNOWN']).describe("주주 유형")
    })).describe("25% 이상 지분 보유자 목록"),

    // Document Metadata
    document_info: z.object({
        company_name: z.string().nullable().describe("회사명 (주식회사 OO, (주)OO 등)"),
        document_date: z.string().nullable().describe("발행일 (YYYY-MM-DD) - 기준일, 생성일, 'ㅇㅇㅇ일 현재' 등 포함"),
        total_shares_declared: z.number().nullable().describe("문서에 명시된 총 주식수"),
        total_capital_declared: z.number().nullable().describe("문서에 명시된 총 자본금")
    }).describe("문서 메타데이터 (필수 추출 파트)")
});

type FastExtractionResult = z.infer<typeof FastExtractionSchema>;

const INSTRUCTIONS = `
당신은 한국 주주명부 고속 분석 전문가입니다.
주어진 주주명부 이미지를 보고 **한 번에(Mono-Agent)** 다음 작업을 모두 수행하십시오.

⚠️ **중요: 문서 유효성 판단 (Gatekeeper)**
- 이 문서가 "주주명부" 또는 "주주 리스트"가 맞는지 판단하십시오.
- **필수 확인 정보**: 
  - **회사명**: 상단/하단/도장 등에서 '주식회사 OO' 또는 '(주)OO' 형식을 찾으십시오.
  - **발행일 (Issue Date)**: 발행일, 기준일, 생성일, 작성일 등을 모두 찾아 하나로 통일하십시오. (없으면 null)
- **통과 조건 (유연함)**: 주주명과 지분 정보(주식수 등)가 포함되어 있다면, 식별번호가 일부 가려져 있거나 누락되어도 **유효한 주주명부**로 인정하십시오.
- **거부 조건**: 이력서, 영수증, 등기부등본 등 **아예 주주명부가 아닌 경우에만** 'is_valid_shareholder_register'를 false로 하십시오.
- 식별번호(주민번호 등)가 없거나 가려져 있어도 **절대 거부하지 말고**, 해당 필드를 null로 두거나 복원하여 추출을 계속 진행하십시오. (후행 단계에서 검증합니다)

## 1. 정밀 데이터 추출 (Extraction)
- **모두 주주의 세부 정보**를 빠짐없이 추출하십시오.
- **문서 메타데이터 추출 (Document Context)**:
  - \`company_name\` (대상 회사): 문서 상단 타이틀, 하단 법인인감, 또는 헤더/푸터에서만 찾으십시오.
  - **⚠️ 경고**: 주주 리스트 내에 포함된 '법인 주주(Corporate Shareholder)'의 이름을 대상 회사명으로 오인하지 마십시오. 반드시 문서 전체의 제목이나 인감 근처의 발행 주체를 찾으십시오.
  - \`document_date\` (발행일/기준일): **[가장 중요]** 문서에 명시된 모든 날짜 중 다음 우선순위로 추출하십시오.
    1. **'기준일'**, **'작성일'**, **'발행일'** 키워드 근처의 날짜
    2. **'ㅇㅇㅇ일 현재'** (As of Date) 형식의 날짜
    3. **법인인감(도장)** 날인 근처에 적힌 날짜
    4. 문서 **최하단** 또는 **제목 바로 아래**에 위치한 날짜
  - ⚠️ **주의**: 상기 날짜들은 모두 **\`document_date\`** 하나로 통합하여 YYYY-MM-DD 형식으로 기록하십시오. 없으면 null로 두되, 반드시 찾아내려 노력하십시오.

- **절대 주의: 날짜/식별번호 임의 추론 금지 (No Hallucination)**: 
  - **날짜**: 문서에 '2024.12'처럼 일(Day) 정보가 없는 경우, 임의로 '2024-12-01'처럼 **'-01'을 붙이지 마십시오.** 정보가 부족하면 해당 필드를 null로 두거나, 불완전함을 명시하십시오. (예: '2024-12-??')
  - **식별자**: 주민번호, 사업자번호, 법인번호의 자릿수가 부족하거나 가려진 경우, 임의로 숫자를 채워 넣거나 자릿수를 맞추기 위해 0을 패딩하지 마십시오. 보이는 부분만 추출하거나 null로 처리하십시오.
- **절대 주의**: 문서에 날짜가 '2024.12.31 현재'라고 크게 적혀 있다면 이것은 **발행일**이지 주주의 생심월일이 아닙니다. 두 데이터의 위치와 문맥을 보고 엄격히 분리하십시오.

- **필수 추출 항목**: 
  - 성명 (name)
  - 주식수 (shares) 
  - 지분율 (ratio) - ⚠️ **주의**: "percentage"라고 쓰지 말고 반드시 **"ratio"**라고 쓰십시오.
  - 식별번호 (identifier) - 주민등록번호/사업자등록번호
- **지분 추론 (Inference)**: 
  - 지분율 정보는 주식수(주), 금액(원), 또는 직접 표시된 지분율(%) 등 다양한 지표에서 추론할 수 있습니다.
  - 이들 지표가 공존할 경우, 서로 모순되지 않는지 확인하고 가장 확실한 값을 기준으로 추출하십시오.
- **식별번호 중요 및 정규화 규칙(Identifier Normalization)**: 
  - 대주주 및 25% 이상 보유자의 **식별번호(주민번호 앞자리+뒷자리, 또는 사업자번호)**는 *무조건* 찾아내십시오.
  - 가려져 있거나 흐릿하다면, 보이는 대로라도 최대한 복원하여 적으십시오. (예: 800101-1******)
  
  **[정규화 상세 가이드]**:
  1. **개인 (INDIVIDUAL)**:
     - **주민등록번호(13자리) 발견 시**: 생년월일(YYYY-MM-DD)로 변환하여 'identifier'에 저장합니다.
       - **뒷자리의 첫 번째 숫자(성별코드)**로 연도를 판단:
         - 1, 2, 5, 6 → 1900년대 (예: 850101-1... → 1985-...)
         - 3, 4, 7, 8 → 2000년대 (예: 020101-3... → 2002-...)
         - 9, 0 → 1800년대
       - **뒷자리가 없거나 6자리(YYMMDD)만 있는 경우**: 현재 연도(2026년)를 기준으로 **100세 수명 범위** 내에서 추정하십시오.
         - YY가 00~26 → 2000년대 (예: 150101 → 2015-01-01)
         - YY가 27~99 → 1900년대 (예: 850101 → 1985-01-01)
     - **생년월일만 있는 경우**: YYYY-MM-DD 형식으로 통일하십시오.
     
  2. **법인 (CORPORATE)**:
     - 사업자등록번호(10자리) → 000-00-00000 형식으로 하이픈 추가
     - 법인등록번호(13자리) → 000000-0000000 형식으로 하이픈 추가
  
- **심층 성명 분석 (Deep Name Analysis)**:
  - 단순 오타 교정을 넘어, **어휘적 희소성(Lexical Rarity)**과 **음운론적 적합성**을 따지십시오.
  - 예: '홍청군' -> '청군'은 이름에 거의 안 쓰임. '홍성준'일 확률이 높음.
  - 예: 2020년생 '점순' -> 연령대 불일치 의심.
  - 의심스러운 경우 'remarks' 필드에 "성명 의심: [이유]"라고 적으십시오.

## 2. 분석 및 데이터 검증 (Analysis & Verification)
- **실소유자(Beneficial Owner) 판별 - 핵심 목표**: 
  - 지분율이 **25% 이상**인 모든 주주는 '실소유자'로 간주합니다.
  - 이들은 단순 주주가 아니라 자금세탁방지(AML) 등의 목적상 중요한 검토 대상입니다.
  - **제약 조건**: 지분율 합계가 100%이므로, 실소유자는 **최대 4명**까지만 존재할 수 있습니다. 
  - **[최우선 확인] 발행일/기준일 판별**: 문서에 '기준일', '현재(As of)', 혹은 법인도장 근처에 날짜가 있다면 이를 반드시 \`document_info.document_date\`에 기록하십시오. 이 정보가 없으면 분석의 시점을 알 수 없습니다.
  - **[실소유자 판정 로직]**:
    - **1단계 (25% 이상)**: 지분율이 25% 이상인 모든 주주를 추출하여 'over_25_percent_holders'에 담으십시오.
    - **2단계 (25% 미만)**: 1단계 대상이 전혀 없는 경우에만, 지분율이 가장 높은 주주 1인을 선정하여 해당 배열에 담으십시오. 이때 UI 레이블링 원칙에 따라 "25% 이상" 또는 "(25% 미만)" 카테고리만 사용됨을 인지하십시오.
- **정합성 체크 (Consistency Check)**: 
  - 추출한 각 주주의 지분율 합계가 **정확히 100%**가 되는지 검증하십시오.
  - 주식수나 보유금액 등 다른 지표가 있을 경우, 이를 통해 계산한 지분율과 직접 표시된 지분율이 일치하는지 확인하십시오.
- **주주 유형 분류**:
  - 이름에 '(주)', '법인', 'Inc' 등이 있거나 사업자번호(10자리)가 있으면 'CORPORATE'
  - 주민번호(13자리) 형식이나 생년월일이 있으면 'INDIVIDUAL'
- **날짜 구분 원칙 (CRITICAL)**:
  - **발행일 (Issue Date)**: 문서 전체의 기준이 되는 날짜(발행일, 기준일, 생성일, **'ㅇㅇㅇ일 현재'**, 또는 **법인인감/도장 근처의 날짜**)는 '발행일'로 통일하여 추출하십시오. (없으면 null)
  - **생년월일 (Birth Date)**: 개별 주주의 신원 정보인 생년월일은 주주 데이터의 'identifier'로 추출하십시오.
  - ⚠️ **절대 주의**: 문서의 발행일과 주주의 생년월일은 서로 다른 데이터입니다. 이를 하나의 필드에 섞거나 혼동하지 마십시오. 날짜가 **제목 아래, 문서 하단, 혹은 도장 날인 근처**에 있다면 발행일일 가능성이 매우 높습니다. 반면, 표(Table) 내부의 주주 행에 있다면 생년월일입니다.

## 3. 결과 반환 (Output)
- 반드시 JSON 스키마 형식으로 응답하십시오.
- **over_25_percent_holders (실소유자 목록)** 배열에는 다음 정보를 **모두** 포함해야 합니다:
  - 'name': 주명
  - 'ratio': 지분율 (숫자만, % 제외)
  - 'identifier': 식별번호
  - 'entity_type': 주주 유형
- **주의**: 모든 지분율 필드는 반드시 'ratio'라는 이름을 사용하십시오.

## 4. 할루시네이션 방지 및 품질 원칙 (Anti-Hallucination)
- **절대 추측 금지**: 흐릿해서 안 보이면 추측해서 채우지 말고 차라리 'null'로 두거나 부분적으로만 적으십시오. (예: "800101-1" -> "800101-1******" 가 아니라 "800101-1" 그대로 또는 null)
- **자릿수 보존**: 사업자번호가 9자리만 보인다면, 10자리를 맞추기 위해 임의의 숫자를 넣지 마십시오.
- **날짜 고정 금지**: '2022.02'를 '2022-02-01'로 변환하는 행위는 **심각한 데이터 왜곡**입니다. 일(Day)이 없으면 절대 임의로 생성하지 마십시오.
- **없는 내용 창조 금지**: 문서에 없는 "주민등록번호"나 "주소"를 그럴싸하게 지어내지 마십시오.
- **단위 환산 주의**: "100주"를 "100만원"으로 잘못 해석하지 않도록, 컬럼 헤더(주식수 vs 금액)를 확실히 확인하십시오.

## 5. OCR 오타 교정 가이드 (한국어 특화)
- **통계적 접근**: 시각적으로 유사하지만 빈도가 낮은 글자는, 빈도가 높은 일반적인 글자로 교정하십시오.
  - '홍청군' (X) -> '홍성준' (O) ('청'과 '성' 유사, '운'과 '준' 유사)
  - '김검수' (X) -> '김철수' 또는 '김검수' (이름은 다양하므로 신중하되, '검'이 성씨가 아니면 의심)
  - '박' vs '반': 주식수 단위에서 '주'가 '조'로 보일 수 있음.
- **숫자 오인식**: '0'과 '8', '1'과 '7', '5'와 'S' 혼동 주의. 지분율 합계가 100%가 되도록 교차 검증하십시오.

## 6. 자가 검증 (Self-Verification)
- JSON을 생성하기 전에 다음을 스스로 질문하십시오:
  1. "추출된 주주의 수와 식별번호의 수가 일치하는가?"
  2. "지분율의 합계가 100% 안팎인가?"
  3. "25% 이상 주주가 누락되지 않았는가?"
- 문제가 발견되면 'remarks'나 'normalization_notes'에 해당 사실을 기록하고 출력하십시오.
`;

export async function runFastExtractor(
    images: { base64: string, mimeType: string }[]
): Promise<{
    is_valid: boolean;
    shareholders: any[];
    rejection_reason?: string;
    document_info?: any;
    over_25_percent_holders: any[];
}> {

    const agent = new Agent({
        name: 'Fast Extractor',
        model: MODEL,
        instructions: INSTRUCTIONS,
    });

    // Ensure API Key is initialized
    ensureApiKey();

    const imageContents = images.map(img => ({
        type: 'input_image' as const,
        imageUrl: `data:${img.mimeType};base64,${img.base64}`
    }));

    const input = [
        {
            role: 'user' as const,
            content: [
                ...imageContents,
                { type: 'input_text' as const, text: '이 주주명부 문서(모든 페이지)를 분석하여 데이터를 추출해줘. 반드시 JSON 형식으로만 응답하세요.' }
            ]
        }
    ];

    try {
        console.log(`[FastExtractor] Model: ${MODEL}`);
        console.log(`[FastExtractor] Sending request to AI model (Input Payload Size: ${JSON.stringify(input).length} chars)...`);

        const startTime = Date.now();
        const result = await run(agent, input);
        const duration = Date.now() - startTime;
        console.log(`[FastExtractor] AI response received in ${duration}ms`);

        let jsonStr = result.finalOutput || '';
        logDebug('[FastExtractor] Raw AI Output:', jsonStr);

        // Robust JSON extraction from markdown if necessary
        if (jsonStr.includes('```')) {
            const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (match) {
                jsonStr = match[1];
                logDebug('[FastExtractor] Extracted JSON from Markdown block');
            }
        }
        jsonStr = jsonStr.trim();

        // Attempt Parse
        let rawParsed: any;
        try {
            rawParsed = JSON.parse(jsonStr);
            logDebug('[FastExtractor] JSON Parse Success. Keys:', Object.keys(rawParsed));
        } catch (e) {
            console.error('[FastExtractor] JSON Parse Failed:', e);
            console.error('[FastExtractor] JSON String was:', jsonStr);
            throw new Error('Failed to parse AI output as JSON');
        }

        const parseResult = FastExtractionSchema.safeParse(rawParsed);

        if (!parseResult.success) {
            console.error(`[FastExtractor] Zod Validation Failed!`);
            logDebug('[FastExtractor] Zod Errors:', parseResult.error.format());

            // Critical Fallback logic logging...
            if (!rawParsed.is_valid_shareholder_register) {
                console.warn('[FastExtractor] Document marked invalid by AI despite schema fail. Using rejection reason.');
            } else {
                console.warn('[FastExtractor] Schema failed but document marked valid? Proceeding with raw data (Risk).');
            }
        } else {
            logDebug('[FastExtractor] Zod Validation Passed.');
        }

        const parsed = parseResult.success ? parseResult.data : (rawParsed as FastExtractionResult);
        logDebug('[FastExtractor] Final Parsed Object Summary:', {
            is_valid: parsed.is_valid_shareholder_register,
            shareholders_count: parsed.shareholders?.length,
            beneficial_owners_count: parsed.over_25_percent_holders?.length,
            rejection_reason: parsed.rejection_reason
        });

        if (!parsed.is_valid_shareholder_register) {
            console.warn(`[FastExtractor] Document Rejected: ${parsed.rejection_reason}`);
            return {
                is_valid: false,
                shareholders: [],
                rejection_reason: parsed.rejection_reason || 'AI provided no rejection reason',
                over_25_percent_holders: []
            };
        }

        // Convert to compatible format
        return {
            is_valid: true,
            shareholders: parsed.shareholders || [],
            document_info: parsed.document_info,
            over_25_percent_holders: parsed.over_25_percent_holders || []
        };

    } catch (err) {
        console.error('[FastExtractor] CRITICAL ERROR:', err);
        if (err instanceof Error) {
            console.error('[FastExtractor] Stack Trace:', err.stack);
        }
        throw err;
    }
}
