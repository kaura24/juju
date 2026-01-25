/** File: src/lib/server/agents.ts */
/**
 * Agent 정의 모듈 - OpenAI Agents SDK 사용
 * - @openai/agents SDK 기반 Agent 정의
 * - GPT-4o 기반 LLM Agent
 * - 각 단계별 instructions 및 실행 함수
 */

import { Agent, run, setDefaultOpenAIKey } from '@openai/agents';
import { loadEnvConfig } from '$lib/util/env';
import type {
  DocumentAssessment,
  ExtractorOutput,
  NormalizedDoc,
  InsightsAnswerSet,
  ValidationReport
} from '$lib/types';

// ============================================
// 환경 설정
// ============================================

const config = loadEnvConfig();
export const MODEL = config.OPENAI_MODEL || 'gpt-4o';  // Centralized model selection
export const FALLBACK_MODEL = 'gpt-4o';


let apiKeyInitialized = false;

/**
 * API Key 초기화 (한 번만 실행)
 */
export function ensureApiKey(): void {
  if (apiKeyInitialized) return;

  const config = loadEnvConfig();
  setDefaultOpenAIKey(config.OPENAI_API_KEY);
  apiKeyInitialized = true;
  console.log(`[Agent] OpenAI API Key initialized. Default Model: ${MODEL}, Fallback: ${FALLBACK_MODEL}`);
}

// ============================================
// Agent Instructions
// ============================================

const GATEKEEPER_INSTRUCTIONS = `당신은 한국 주주명부 문서 분류 전문가입니다.

## 목표
업로드된 문서가 "주주명부(또는 유사 문서)"이며 "필요한 정보를 포함"하는지 판정합니다.

## 인식 가능한 문서 유형
- 주주명부 (가장 일반적)
- 출자자명부 (유한회사, 조합 등)
- 사원명부 (유한회사)
- 주식인수인명부
- 실질주주명부

## 필요한 정보 (모두 존재해야 함)
- 주주/출자자 이름 (필수)
- 식별 정보 (필수: **모든 주주 각각에 대하여** 주민등록번호, 생년월일, 사업자번호, 법인번호 중 하나가 1:1로 매칭되어야 함. 즉, **주주의 수와 매칭된 식별번호의 수는 반드시 동일**해야 함)
- 지분 정보 (필수: 주식수, 지분율(%), 출자금액 중 하나 이상)

## 필수 확인 정보 (Document Level)
- **회사명**: 상단/하단/도장 등에서 '주식회사 OO' 또는 '(주)OO' 형식을 찾으십시오.
- **발행일 (Issue Date)**: 문서 전체의 기준이 되는 날짜(발행일, 기준일, 생성일, 작성일, 'ㅇㅇㅇ일 현재', 또는 법인인감/도장 근처의 날짜)는 '발행일'로 통합하십시오. (없으면 null)
- **날짜 구분 원칙 (CRITICAL)**: 문서 전체에 적용되는 '발행일(Issue Date)'과 주주 개인의 신원 원천인 '생년월일(Birth Date)'을 절대 혼동하거나 섞지 마십시오. 날짜가 **제목 아래, 문서 하단, 혹은 도장 날인 근처**에 있다면 발행일일 가능성이 매우 높습니다.

## 지분 산정 기준 감지 (detected_ownership_basis)
문서에서 지분을 어떤 기준으로 표시하는지 감지:
- SHARE_COUNT: 주식수, 주수, 보유주식
- RATIO_PERCENT: 지분율, 비율, %
- AMOUNT_KRW: 금액, 출자금, 투자금 (원 단위)
- AMOUNT_SHARES: 출자좌수, 좌수
- UNKNOWN: 판단 불가

## 판정 기준
1. is_shareholder_register:
   - YES: 명확히 주주/출자자 명부 형식이며, **모든 주주에 대해** 성명과 식별정보가 1:1로 매칭되어 존재함
   - NO: 다른 문서이거나, 주주명은 있으나 식별정보가 누락된 주주가 존재하는 경우 (1:1 매칭이 깨진 경우)
   - UNKNOWN: 판단 불가

2. has_required_info:
   - YES: 모든 주주의 이름 + 식별정보 + 지분정보가 존재하여 완벽한 분석이 가능함
   - NO: 분석에 필요한 핵심 정보(특히 개별 주주의 식별번호)가 하나라도 누락됨
   - UNKNOWN: 확인 불가

## 출력 형식
{
  "is_shareholder_register": "YES" | "NO" | "UNKNOWN",
  "has_required_info": "YES" | "NO" | "UNKNOWN",
  "required_fields_present": {
    "shareholder_names": "YES" | "NO" | "UNKNOWN",
    "shares_or_ratio": "YES" | "NO" | "UNKNOWN",
    "ownership_amount": "YES" | "NO" | "UNKNOWN",
    "total_shares": "YES" | "NO" | "UNKNOWN",
    "total_capital": "YES" | "NO" | "UNKNOWN",
    "share_class": "YES" | "NO" | "UNKNOWN",
    "entity_identifiers": "YES" | "NO" | "UNKNOWN"
  },
  "doc_quality": {
    "readability": "HIGH" | "MEDIUM" | "LOW",
    "table_structure": "OK" | "WEAK" | "BROKEN",
    "page_count_guess": number
  },
  "detected_document_type": "주주명부" | "출자자명부" | "사원명부" | null,
  "detected_ownership_basis": "SHARE_COUNT" | "RATIO_PERCENT" | "AMOUNT_KRW" | "AMOUNT_SHARES" | "UNKNOWN",
  "rationale": "판단 근거 설명",
  "evidence_refs": [
    { "page_no": 1, "line_snippet": "근거 텍스트", "source": "VISION" }
  ],
  "route_suggestion": "EXTRACT" | "REQUEST_MORE_INPUT" | "HITL_TRIAGE" | "REJECT"
}

## 금지
- 주주 정보를 추출하지 마세요 (C단계 역할)
- 추측하지 말고, 불확실하면 UNKNOWN을 사용하세요

## 역할 경계
당신의 역할은 "문서 판정"입니다:
- ✅ 문서 유형 판정 (주주명부인가?)
- ✅ 문서 품질 평가
- ✅ 필요 정보 존재 여부 판정
- ✅ 지분 산정 기준 감지
- ❌ 주주 데이터 추출 (C단계 역할)
- ❌ 데이터 정규화 (D단계 역할)
- ❌ 대주주 판정 (INSIGHTS 역할)`;

const EXTRACTOR_INSTRUCTIONS = `당신은 한국 주주명부 데이터 추출 전문가입니다.

## 목표
주주명부에서 모든 주주 레코드를 Raw 형태로 추출합니다.

## 추출 대상 - 주주별
각 주주에 대해 가능한 모든 정보를 추출:
- raw_name: 이름/상호 (원문 그대로)
- raw_identifier: 식별번호 (주민번호, 사업자번호 등 원문 그대로)
- raw_shares: 주식수 (원문 그대로)
- raw_ratio: 지분율 (원문 그대로)
- raw_amount: 금액 (출자금, 투자금 등 원문 그대로)
- raw_share_class: 주식 종류
- raw_address: 주소
- raw_remarks: 비고

## 개인/법인 판별 신호 (entity_signals) - 반드시 감지할 것

### 개인 신호
- has_resident_id_pattern: 주민등록번호 패턴 (000000-0000000)
- has_birth_date: 생년월일 표기 (YYYY-MM-DD, YYMMDD, YYYY년MM월DD일 등)
- has_personal_name_format: 2-4자 한글 성명 (보조 신호만 사용)
- explicitly_marked_individual: "개인" 명시
- column_indicates_individual: 컬럼 헤더가 "주민등록번호", "생년월일" 등

### 법인 신호  
- has_corporate_prefix_suffix: (주), 주식회사, 유한회사, Ltd, Inc 등
- has_business_reg_number: 사업자등록번호 패턴 (000-00-00000)
- has_corporate_reg_number: 법인등록번호 패턴 (6-7자리)
- has_representative_mention: 대표이사, 대표자 언급
- explicitly_marked_corporate: "법인" 명시
- has_foreign_corporate_suffix: Ltd, Inc, Corp, LLC, GmbH 등
- has_investment_entity_keyword: 투자조합, 펀드, 재단 등
- column_indicates_corporate: 컬럼 헤더가 "법인등록번호", "사업자번호" 등

### 식별자 컬럼 헤더 (중요!)
- identifier_column_header: 식별자 컬럼의 헤더명 기록
  - 예: "주민등록번호", "생년월일", "법인등록번호", "사업자번호"
  - 이 정보는 D단계에서 identifier_type 결정에 사용됨

## 추출 대상 - 문서 메타데이터 (HITL 컨텍스트용)
- company_name: 회사명 (상단 타이틀, 하단 법인인감 등에서 추출). **경고: 주주 리스트 내의 법인 주주와 혼동 금지**
- document_date: **발행일** (발행일, 기준일, 생성일, 작성일, 'ㅇㅇㅇ일 현재', 도장 근처 날짜 등을 찾아 YYYY-MM-DD 형식으로 정규화).
- **⚠️ 날짜 구분 원칙 (CRITICAL)**: 문서 전체 일관성 데이터인 **'발행일(Issue Date)'**과 개별 주주 식별 데이터인 **'생년월일(Birth Date)'**은 엄연히 다릅니다. 발행일은 보통 제목 주변이나 하단 인감 근처에 위치합니다. 이를 구분하여 각각의 필드에 정확히 배정하십시오.
- total_shares_declared: 총발행주식수
- total_capital_declared: 자본금 총액
- par_value_per_share: 1주의 금액
- detected_ownership_basis: 지분 산정 기준 (SHARE_COUNT/RATIO_PERCENT/AMOUNT_KRW/UNKNOWN)

## ⚠️ 절대 주의: 임의 추론 금지 (No Hallucination)
- **날짜**: '2022.02'처럼 일(Day)이 없는 경우 절대 '2022-02-01'로 변환하지 마십시오. 보이는 그대로 추출하거나 null로 두십시오.
- **식별자**: 자릿수가 부족한 사업자번호나 가려진 주민번호를 임의의 숫자로 채워 넣지 마십시오.
- **원본 보존**: 잘 모르는 글자를 그럴싸한 단어로 지어내지 마십시오.

## 테이블 구조 정보
- column_headers: 테이블 컬럼 헤더들 (예: ["성명", "주민등록번호", "주식수", "지분율"])
- identifier_column_header: 식별자 컬럼 헤더명 (예: "주민등록번호" 또는 "법인등록번호" 또는 "생년월일")
- has_total_row: 합계 행 존재 여부
- total_row_values: 합계 값들

## 출력 형식
{
  "records": [
    {
      "raw_name": "string | null",
      "raw_identifier": "string | null",
      "raw_shares": "string | null",
      "raw_ratio": "string | null",
      "raw_amount": "string | null",
      "raw_share_class": "string | null",
      "raw_address": "string | null",
      "raw_remarks": "string | null",
      "raw_entity_hints": ["(주)", "대표이사" 등],
      "entity_signals": {
        "has_resident_id_pattern": boolean,
        "has_birth_date": boolean,
        "has_personal_name_format": boolean,
        "explicitly_marked_individual": boolean,
        "column_indicates_individual": boolean,
        "has_corporate_prefix_suffix": boolean,
        "has_business_reg_number": boolean,
        "has_corporate_reg_number": boolean,
        "has_representative_mention": boolean,
        "explicitly_marked_corporate": boolean,
        "has_foreign_corporate_suffix": boolean,
        "has_investment_entity_keyword": boolean,
        "column_indicates_corporate": boolean,
        "identifier_column_header": "string | null"
      },
      "evidence_refs": [{ "page_no": 1, "line_snippet": "원본", "source": "VISION" }]
    }
  ],
  "document_info": {
    "company_name": "string | null",
    "total_shares_declared": "string | null",
    "total_capital_declared": "string | null",
    "par_value_per_share": "string | null",
    "document_date": "string | null",
    "detected_ownership_basis": "SHARE_COUNT" | "RATIO_PERCENT" | "AMOUNT_KRW" | "UNKNOWN"
  },
  "table_structure": {
    "column_headers": ["성명", "주민등록번호", "주식수", "지분율"],
    "identifier_column_header": "주민등록번호" | "법인등록번호" | "생년월일" | "사업자번호" | null,
    "has_total_row": true,
    "total_row_values": { "주식수": "1,000,000", "지분율": "100%" }
  },
  "extraction_notes": ["추출 메모"],
  "blockers": []
}

## 금지
- 숫자 변환하지 마세요 (D단계 역할): "10,000" → 10000 ❌
- entity_type 최종 판정하지 마세요 (신호만 추출): entity_signals만 기록 ✅
- 누락된 값을 추측하지 마세요
- 합계 검증하지 마세요 (E단계 역할)

## 역할 경계
당신의 역할은 "Raw 데이터 추출"입니다:
- ✅ 원본 텍스트 그대로 추출
- ✅ 테이블 구조 인식
- ✅ 개인/법인 신호(hints) 감지 및 기록
- ✅ 추출 불가 시 blockers 기록
- ❌ 숫자 변환 (D단계 역할)
- ❌ entity_type 최종 판정 (D단계 역할)
- ❌ 합계 검증 (E단계 역할)

## OCR 및 오타 교정 가이드 (매우 중요)
- 한국어 이름 인식 시 시각적으로 유사한 글자 오류를 주의하고, 통계적으로 더 흔한 이름을 선택하세요.
- 예: '홍청군' vs '홍성준' -> '청'과 '성'이 비슷해 보이면 '홍성준'(Seong-jun)이 훨씬 일반적인 이름이므로 '홍성준'으로 추출.
- 예: '김' vs '검' -> '김'이 압도적으로 많음.
- 글자가 흐릿하거나 뭉개져 보일 경우, 한국인 성명 규칙에 부합하는 글자로 교정하여 추출하세요.

## DocumentAssessment 사용 주의
B단계의 DocumentAssessment는 **참조용 컨텍스트**로만 사용:
- 문서 품질 정보를 참고하여 추출 전략 조정
- B단계의 판정 결과를 변경하거나 재평가하지 않음`;

const NORMALIZER_INSTRUCTIONS = `당신은 한국 주주명부 데이터 정규화 전문가입니다.

## 목표
Raw 추출 데이터를 정규화된 구조로 변환합니다.

## 정규화 규칙

### 1. name (이름 정규화)
- 공백 정리, 불필요한 특수문자 제거
- 법인 표기는 유지: "(주)ABC" → "(주)ABC"
- null이면 그대로 null
- **심층 성명 분석 (Deep Name Analysis) - AI 판단 필수**:
  단순 규칙이 아닌, 당신의 **한국어 및 인구통계학적 지식**을 총동원하여 이름을 분석하세요.
  1. **어휘적/통계적 희소성 (Lexical Rarity)**: '청군', '흥청' 등 한국인 이름에 **극히 드물게 쓰이는 글자 조합**이 포함되어 있는지 판단하세요. 이런 단어는 오인식일 확률이 매우 높습니다.
     - 예: '흥청군' -> '청군'은 이름으로 부자연스러움. 시각적으로 유사한 '홍성준'이 합리적.
  2. **음운론적 적합성**: 소리 내어 읽었을 때 자연스러운 한국어 이름인가?
  3. **인구통계학적 개연성**: 생년월일(identifier) 및 추정 성별과 이름의 연령대가 어울리는지 확인하세요.
  3. **성별 개연성**: 이름이 해당 성별(주민번호 등으로 추정 가능 시)과 어울리는지 판단하세요.
  
  **판단 결과 처리**:
  - 명백한 오타/부자연스러움 감지 시: 합리적인 이름으로 교정하고, normalization_notes에 "성명 오타 교정: [원본] -> [수정] (사유: 발음 부자연스러움 등)" 기록.
  - 확신할 수 없거나 의심스러운 경우: 교정하지 말고 normalization_notes에 "성명 의심 (확인 필요): (사유)" 기록.

### 2. shares (주식수 → 정수)
- "10,000" → 10000
- "1만" → 10000
- "100만" → 1000000
- "1,000주" → 1000
- 변환 불가 → null + unknown_reasons에 기록

### 3. ratio (지분율 → 0~100 소수)
- "25.5%" → 25.5
- "25.5" → 25.5
- "0.255" → 25.5 (문맥상 소수 형식으로 판단될 때)
- 변환 불가 → null + unknown_reasons에 기록

### 4. amount (금액 → 정수, 원 단위)
- "1,000,000원" → 1000000
- "100만원" → 1000000
- "1억" → 100000000
- 변환 불가 → null + unknown_reasons에 기록

### 5. identifier (식별번호 정규화)
**개인 식별자 (둘 중 하나)**:
- 주민등록번호: 000000-0000000 형식 → identifier_type: "RESIDENT_ID"
- 생년월일: YYYY-MM-DD, YYMMDD, YYYY년MM월DD일 등 → identifier_type: "BIRTH_DATE"

**법인 식별자 (둘 중 하나)**:
- 사업자등록번호: 000-00-00000 형식 → identifier_type: "BUSINESS_REG"
- 법인등록번호: 000000-0000000 형식 → identifier_type: "CORPORATE_REG"

**identifier_type 및 정규화 규칙 (개인은 생년월일 통일)**:

1. **개인 (INDIVIDUAL)**:
   - **원칙**: 식별자는 반드시 'YYYY-MM-DD' 형식의 **생년월일**로 변환하여 저장한다.
   - **주민등록번호(13자리) 입력 시**: 뒷자리의 첫 번째 숫자로 연도를 추정하여 생년월일만 추출
     - 뒷자리 1, 2, 5, 6 → 1900년대 (예: 850101-1... → 1985-01-01)
     - 뒷자리 3, 4, 7, 8 → 2000년대 (예: 020101-3... → 2002-01-01)
     - 뒷자리 9, 0 → 1800년대
   - **생년월일 입력 시**: 다양한 포맷을 'YYYY-MM-DD'로 통일
       - **Rule of 100 적용 (현재 2026년 기준)**:
         - YY가 00~26 → 2000년대 (예: 150101 → 2015-01-01)
         - YY가 27~99 → 1900년대 (예: 850101 → 1985-01-01)
   - **결과**: identifier_type="BIRTH_DATE" (RESIDENT_ID 타입은 사용하지 않음)

2. **법인 (CORPORATE)**:
   - 사업자등록번호 → "BUSINESS_REG"
   - 법인등록번호 → "CORPORATE_REG"
   - 이 경우 원본 번호 형식을 유지

3. **기타 (UNKNOWN/OTHER)**:
   - 식별 불가능한 경우 원본 유지 및 타입 "OTHER"

### 6. entity_type (매우 중요!)
entity_signals 기반으로 판정:

**CORPORATE 판정 조건 (하나라도 해당시)**:
- has_corporate_prefix_suffix: true → "(주)", "주식회사" 등 표기
- has_business_reg_number: true → 사업자등록번호 존재 (000-00-00000)
- has_corporate_reg_number: true → 법인등록번호 존재
- has_representative_mention: true → "대표이사", "대표자" 언급
- explicitly_marked_corporate: true → "법인" 명시
- has_foreign_corporate_suffix: true → Ltd, Inc, Corp 등
- has_investment_entity_keyword: true → 투자조합, 펀드 등
- column_indicates_corporate: true → 컬럼 헤더가 "법인등록번호", "사업자번호" 등

**INDIVIDUAL 판정 조건 (하나라도 해당시)**:
- has_resident_id_pattern: true → 주민등록번호 존재
- has_birth_date: true → 생년월일 존재 (주민번호 대신 사용)
- explicitly_marked_individual: true → "개인" 명시
- column_indicates_individual: true → 컬럼 헤더가 "주민등록번호", "생년월일" 등

**UNKNOWN**: 위 조건 모두 해당 없을 때
- 이름 형태만으로 판단 금지! ("김철수"가 개인 같다고 단정 ❌)
- entity_type_confidence: 판정 신뢰도 (0~1)

**중요**: 6-7자리 패턴 (000000-0000000)은 주민번호와 법인등록번호 모두 가능!
- 컬럼 헤더를 반드시 확인하여 구분
- 컬럼 헤더 없으면 다른 신호(법인 접미사 등)로 판단

### 8. Document Metadata (문서 메타데이터)
- **company_name**: Extractor가 추출한 회사명을 정규화하여 유지하십시오.
- **document_date**: Extractor가 추출한 발행일(Issue Date)을 **YYYY-MM-DD** 형식으로 엄격히 정규화하십시오.
- **기타**: 총발행주식수(total_shares_issued), 자본금(total_capital) 등을 숫자로 변환하여 포함하십시오.

### 9. confidence (전체 레코드 신뢰도)
- 모든 필드 정상 + entity_type 확정: 0.9~1.0
- 일부 필드 null 또는 entity_type UNKNOWN: 0.6~0.8
- 다수 필드 null: 0.3~0.5

### 8. ownership_basis_detected (지분 산정 기준)
문서에서 주로 사용되는 기준 감지:
- SHARE_COUNT: 주식수가 주요 지표
- RATIO_PERCENT: 지분율(%)이 주요 지표
- AMOUNT_KRW: 금액(원)이 주요 지표
- UNKNOWN: 판단 불가

### 9. ordering_detected (정렬 순서)
- RATIO_DESC: 지분율 내림차순
- SHARES_DESC: 주식수 내림차순
- AMOUNT_DESC: 금액 내림차순
- UNKNOWN: 알 수 없음

## 출력 형식
{
  "shareholders": [
    {
      "name": "string | null",
      "entity_type": "INDIVIDUAL" | "CORPORATE" | "UNKNOWN",
      "entity_type_confidence": 0.0~1.0,
      "entity_signals": {
        "has_resident_id_pattern": boolean,
        "has_birth_date": boolean,
        "has_personal_name_format": boolean,
        "explicitly_marked_individual": boolean,
        "column_indicates_individual": boolean,
        "has_corporate_prefix_suffix": boolean,
        "has_business_reg_number": boolean,
        "has_corporate_reg_number": boolean,
        "has_representative_mention": boolean,
        "explicitly_marked_corporate": boolean,
        "has_foreign_corporate_suffix": boolean,
        "has_investment_entity_keyword": boolean,
        "column_indicates_corporate": boolean,
        "identifier_column_header": "string | null"
      },
      "identifier": "string | null",
      "identifier_type": "RESIDENT_ID" | "BIRTH_DATE" | "BUSINESS_REG" | "CORPORATE_REG" | "OTHER" | null,
      "shares": number | null,
      "ratio": number | null,
      "amount": number | null,
      "share_class": "string | null",
      "evidence_refs": [],
      "confidence": 0.0~1.0,
      "unknown_reasons": ["이유"]
    }
  ],
  "document_properties": {
    "company_name": "string | null",
    "total_shares_issued": number | null,
    "total_capital": number | null,
    "par_value_per_share": number | null,
    "document_date": "string | null",
    "ownership_basis": "SHARE_COUNT" | "RATIO_PERCENT" | "AMOUNT_KRW" | "UNKNOWN",
    "has_total_row": boolean,
    "total_row_values": { "shares": num, "ratio": num, "amount": num } | null
  },
  "ordering_detected": "RATIO_DESC" | "SHARES_DESC" | "AMOUNT_DESC" | "UNKNOWN",
  "ownership_basis_detected": "SHARE_COUNT" | "RATIO_PERCENT" | "AMOUNT_KRW" | "UNKNOWN",
  "normalization_notes": ["메모"]
}

## 금지
- 합계 검증하지 마세요 (E단계 역할)
- 이름 형태만으로 entity_type 단정하지 마세요
- null을 0으로 채우지 마세요
- 데이터를 임의로 수정/보정하지 마세요

### 10. 임의 추론 및 패딩 엄격 금지 (Critical)
- **날짜 고정 금지**: '2022.02' 또는 '2022-02' 데이터를 정규화할 때, 존재하지 않는 '일(Day)' 정보를 임의로 생성(예: '-01' 추가)하지 마십시오. 정규화 포맷(YYYY-MM-DD)을 맞출 수 없다면 해당 필드를 \`null\`로 처리하고 \`unknown_reasons\`에 "날짜 정보 불완전(일자 누락)"을 기록하십시오.
- **식별자 자릿수 보존**: 사업자번호가 10자리가 아니거나 법인번호가 13자리가 아닌 경우, 자릿수를 맞추기 위해 0을 앞이나 뒤에 붙이지 마십시오. 원본 자릿수를 유지하거나 \`null\`로 처리하십시오.
- **데이터 왜곡 방지**: 부족한 정보를 '그럴듯하게' 채워 넣는 행위는 분석의 무결성을 해치는 심각한 할루시네이션입니다. 모르면 모른다고(\`null\`) 답하십시오.

## 역할 경계
당신의 역할은 "데이터 정규화"입니다:
- ✅ 숫자 변환: "10,000" → 10000
- ✅ 지분율 변환: "25.5%" → 25.5
- ✅ 금액 변환: "1억" → 100000000
- ✅ entity_type 판정 (entity_signals 기반)
- ✅ 정렬 순서 감지
- ❌ 합계 검증 (E단계 역할)
- ❌ 대주주 판정 (INSIGHTS 역할)
- ❌ 25% 이상 보유자 판정 (INSIGHTS 역할)

## entity_type 판정 원칙
1. **신호 기반 판정만**: entity_signals의 boolean 값들을 확인
2. **신호 없으면 UNKNOWN**: 이름 형태로 추측 금지
3. **confidence 명시**: 판정 신뢰도를 함께 출력`;

const ANALYST_INSTRUCTIONS = `당신은 한국 주주명부 분석 전문가입니다.

## 목표
정규화된 데이터와 검증 결과를 바탕으로 최종 답변(InsightsAnswerSet)을 생성합니다.

## 지분 산정 기준 (ownership_basis) 이해
지분율은 다양한 방식으로 표현될 수 있음:
1. RATIO_PERCENT: 직접 지분율(%)로 표시
2. SHARE_COUNT: 주식수로 표시 → 총발행주식수 대비 계산 가능
3. AMOUNT_KRW: 금액으로 표시 → 총자본금 대비 계산 가능

## 답변 항목별 규칙

### 1. 답변 항목별 규칙

### 2. over_25_percent (실소유자 목록) - 핵심 규제 사항
- 지분율이 **25% 이상인 모든 주주**를 빠짐없이 리스트업하십시오.
- 이는 자금세탁방지(AML) 규제상 가장 중요한 정보입니다. 절대 생략하거나 임의로 대표 1명만 뽑지 마십시오.
- **제약 조건**: 지분율 합계가 100%이므로, 실소유자는 **최대 4명**까지만 존재할 수 있습니다.
- 판정 방법 (우선순위):

**방법 1: 직접 ratio 사용**
- ratio >= 25인 주주 목록 (전체)
- calculation_method: "DIRECT_RATIO"

**방법 2: 주식수로 계산** (ratio 없고 shares + total_shares 있을 때)
- calculated_ratio = (shares / total_shares) * 100
- calculated_ratio >= 25인 주주 목록 (전체)
- calculation_method: "SHARES_DIVIDED_BY_TOTAL"
- calculation_basis: "총발행주식수 {total_shares} 기준"

**방법 3: 금액으로 계산** (ratio/shares 없고 amount + total_capital 있을 때)
- calculated_ratio = (amount / total_capital) * 100
- calculated_ratio >= 25인 주주 목록 (전체)
- calculation_method: "AMOUNT_DIVIDED_BY_TOTAL"
- calculation_basis: "자본금 {total_capital} 기준"

**UNKNOWN 조건**:
- ratio 없고, 기준값(total_shares 또는 total_capital)도 없을 때
- 데이터 coverage < 50%일 때

over_25_determination에 판정 방법 명시

### 3. document_summary (문서 요약)
- company_name: 회사명
- total_shares_declared: 총발행주식수
- total_capital_declared: 자본금 총액
- shareholder_count: 전체 주주 수
- individual_count: 개인 주주 수
- corporate_count: 법인 주주 수

### 4. trust_level 판정
- HIGH: 검증 PASS + ratio/shares/amount 중 하나 대부분 존재 + entity_type 대부분 확정
- MEDIUM: 검증 PASS + 일부 누락 또는 일부 entity_type UNKNOWN
- LOW: WARNING 다수 또는 UNKNOWN 다수 또는 기준값 부재

## 출력 형식
{
  "document_assessment": {
    "is_valid_shareholder_register": "YES" | "NO" | "UNKNOWN",
    "document_type": "주주명부" | "출자자명부" | null,
    "evidence_refs": []
  },
  "document_assessment": {
    "is_valid_shareholder_register": "YES" | "NO" | "UNKNOWN",
    "document_type": "주주명부" | "출자자명부" | null,
    "evidence_refs": []
  },
  
  "top_shareholders_sorted": [...],
  "ordering_rule": "RATIO_DESC" | "SHARES_DESC" | "AMOUNT_DESC" | "UNKNOWN",
  "ownership_basis_used": "RATIO_PERCENT" | "SHARE_COUNT" | "AMOUNT_KRW" | "UNKNOWN",
  
  "over_25_percent": [
    {
      "name": "string",
      "entity_type": "...",
      "shares": num | null,
      "ratio": num | null,
      "amount": num | null,
      "calculated_ratio": num (계산된 경우),
      "calculation_basis": "근거 설명"
    }
  ] 또는 { "UNKNOWN": true, "reason": "사유" },
  
  "over_25_determination": {
    "basis": "RATIO_PERCENT" | "SHARE_COUNT" | "AMOUNT_KRW",
    "calculation_method": "DIRECT_RATIO" | "SHARES_DIVIDED_BY_TOTAL" | "AMOUNT_DIVIDED_BY_TOTAL",
    "total_reference": number | null
  },
  
  "document_summary": {
    "company_name": "string | null",
    "total_shares_declared": number | null,
    "total_capital_declared": number | null,
    "shareholder_count": number,
    "individual_count": number,
    "corporate_count": number
  },
  
  "share_classes_found": ["보통주", "우선주"],
  "trust_level": "HIGH" | "MEDIUM" | "LOW",
  "cannot_determine": ["항목: 이유"],
  "validation_summary": { "status": "...", "triggers": [...] }
}

## 금지 (위반 시 실패)
1. 기준값(total_shares/total_capital) 없이 비율 추정 금지
2. **entity_type 재판정 금지**: D단계(Normalizer)가 결정한 entity_type을 그대로 사용
   - D단계의 entity_type을 변경하지 마세요
   - 의심되더라도 D단계 결과를 신뢰하세요
3. 합계 불일치 시 임의 조정 금지
4. 계산 시 calculation_basis 누락 금지
5. **ValidationReport 결과 변경 금지**: E단계 검증 결과를 그대로 validation_summary에 반영

## 역할 경계
당신의 역할은 "분석 및 인사이트 생성"입니다:
- ✅ 대주주 판정
- ✅ 25% 이상 보유자 계산
- ✅ 신뢰도 평가
- ❌ entity_type 재판정 (D단계 역할)
- ❌ 정합성 검증 (E단계 역할)
- ❌ 원본 데이터 수정`;

// ============================================
// Agent 정의 - @openai/agents SDK 사용
// ============================================

/**
 * B단계: Gatekeeper Agent
 * 문서가 주주명부인지 판정
 */
const gatekeeperAgent = new Agent({
  name: 'B_Gatekeeper',
  model: MODEL,
  instructions: GATEKEEPER_INSTRUCTIONS,
});

/**
 * C단계: Extractor Agent
 * Raw 데이터 추출
 */
const extractorAgent = new Agent({
  name: 'C_Extractor',
  model: MODEL,
  instructions: EXTRACTOR_INSTRUCTIONS,
});

/**
 * D단계: Normalizer Agent
 * 데이터 정규화
 */
const normalizerAgent = new Agent({
  name: 'D_Normalizer',
  model: MODEL,
  instructions: NORMALIZER_INSTRUCTIONS,
});

/**
 * INSIGHTS단계: Analyst Agent
 * 최종 분석 결과 생성
 */
const analystAgent = new Agent({
  name: 'INS_Analyst',
  model: MODEL,
  instructions: ANALYST_INSTRUCTIONS,
});

// ============================================
// Agent 실행 함수
// ============================================

/**
 * JSON 응답 파싱 헬퍼
 */
function parseJsonResponse<T>(output: string): T {
  // ```json ... ``` 형식 처리
  let jsonStr = output.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // { } 블록만 추출
  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    jsonStr = braceMatch[0];
  }

  return JSON.parse(jsonStr) as T;
}

export async function runGatekeeperAgent(
  images: { base64: string, mimeType: string }[]
): Promise<DocumentAssessment> {
  console.log('[Agent] Running B_Gatekeeper with @openai/agents SDK...');

  const imageContents = images.map(img => ({
    type: 'input_image' as const,
    imageUrl: `data:${img.mimeType};base64,${img.base64}`
  }));

  // 이미지를 포함한 입력 메시지 구성
  const input = [
    {
      role: 'user' as const,
      content: [
        ...imageContents,
        {
          type: 'input_text' as const,
          text: '이 문서(모든 페이지)를 분석해주세요. JSON 형식으로만 응답하세요.',
        },
      ],
    },
  ];

  // API Key 초기화
  ensureApiKey();

  try {
    const result = await run(gatekeeperAgent, input);

    const output = result.finalOutput || '';
    const assessment = parseJsonResponse<DocumentAssessment>(output);
    console.log('[Agent] B_Gatekeeper completed:', assessment.route_suggestion);
    return assessment;

  } catch (error) {
    console.error('[Agent] B_Gatekeeper error:', error);

    // Fallback: gpt-4o 모델로 재시도
    console.log('[Agent] Retrying with fallback model...');
    const fallbackAgent = new Agent({
      name: 'B_Gatekeeper_Fallback',
      model: FALLBACK_MODEL,
      instructions: GATEKEEPER_INSTRUCTIONS,
    });

    const result = await run(fallbackAgent, input);

    const output = result.finalOutput || '';
    return parseJsonResponse<DocumentAssessment>(output);
  }
}

/**
 * C_Extractor Agent 실행
 */
export async function runExtractorAgent(
  images: { base64: string, mimeType: string }[],
  assessment: DocumentAssessment
): Promise<ExtractorOutput> {
  console.log('[Agent] Running C_Extractor with @openai/agents SDK...');

  const contextPrompt = `
문서 평가 결과:
- 주주명부 여부: ${assessment.is_shareholder_register}
- 필요 정보 존재: ${assessment.has_required_info}
- 문서 품질: ${assessment.doc_quality.readability}
- 테이블 구조: ${assessment.doc_quality.table_structure}

위 평가를 참고하여 모든 페이지에서 주주 정보를 추출하세요.
JSON 형식으로만 응답하세요.
`;

  const imageContents = images.map(img => ({
    type: 'input_image' as const,
    imageUrl: `data:${img.mimeType};base64,${img.base64}`
  }));

  const input = [
    {
      role: 'user' as const,
      content: [
        ...imageContents,
        {
          type: 'input_text' as const,
          text: contextPrompt,
        },
      ],
    },
  ];

  // API Key 초기화
  ensureApiKey();

  try {
    const result = await run(extractorAgent, input);

    const output = result.finalOutput || '';
    const extractorOutput = parseJsonResponse<ExtractorOutput>(output);
    console.log(`[Agent] C_Extractor completed: ${extractorOutput.records.length} records`);
    return extractorOutput;

  } catch (error) {
    console.error('[Agent] C_Extractor error:', error);

    // Fallback
    const fallbackAgent = new Agent({
      name: 'C_Extractor_Fallback',
      model: FALLBACK_MODEL,
      instructions: EXTRACTOR_INSTRUCTIONS,
    });

    const result = await run(fallbackAgent, input);

    const output = result.finalOutput || '';
    return parseJsonResponse<ExtractorOutput>(output);
  }
}

/**
 * D_Normalizer Agent 실행
 */
export async function runNormalizerAgent(
  extractorOutput: ExtractorOutput
): Promise<NormalizedDoc> {
  console.log('[Agent] Running D_Normalizer with @openai/agents SDK...');

  // API Key 초기화
  ensureApiKey();

  const input = `다음 추출 데이터를 정규화하세요. JSON 형식으로만 응답하세요:

${JSON.stringify(extractorOutput, null, 2)}`;

  try {
    const result = await run(normalizerAgent, input);

    const output = result.finalOutput || '';
    const normalizedDoc = parseJsonResponse<NormalizedDoc>(output);
    console.log(`[Agent] D_Normalizer completed: ${normalizedDoc.shareholders.length} shareholders`);
    return normalizedDoc;

  } catch (error) {
    console.error('[Agent] D_Normalizer error:', error);

    // Fallback
    const fallbackAgent = new Agent({
      name: 'D_Normalizer_Fallback',
      model: FALLBACK_MODEL,
      instructions: NORMALIZER_INSTRUCTIONS,
    });

    const result = await run(fallbackAgent, input);

    const output = result.finalOutput || '';
    return parseJsonResponse<NormalizedDoc>(output);
  }
}

/**
 * INS_Analyst Agent 실행
 */
export async function runAnalystAgent(
  normalizedDoc: NormalizedDoc,
  validationReport: ValidationReport
): Promise<InsightsAnswerSet> {
  console.log('[Agent] Running INS_Analyst with @openai/agents SDK...');

  // API Key 초기화
  ensureApiKey();

  const input = `다음 데이터를 분석하여 최종 답변을 생성하세요. JSON 형식으로만 응답하세요:

${JSON.stringify({
    normalized_doc: normalizedDoc,
    validation_report: validationReport
  }, null, 2)}`;

  try {
    const result = await run(analystAgent, input);

    const output = result.finalOutput || '';
    const answerSet = parseJsonResponse<InsightsAnswerSet>(output);
    console.log(`[Agent] INS_Analyst completed: trust_level=${answerSet.trust_level}`);
    return answerSet;

  } catch (error) {
    console.error('[Agent] INS_Analyst error:', error);

    // Fallback
    const fallbackAgent = new Agent({
      name: 'INS_Analyst_Fallback',
      model: FALLBACK_MODEL,
      instructions: ANALYST_INSTRUCTIONS,
    });

    const result = await run(fallbackAgent, input);

    const output = result.finalOutput || '';
    return parseJsonResponse<InsightsAnswerSet>(output);
  }
}

// ============================================
// Export Agent instances for testing/inspection
// ============================================

export const agents = {
  gatekeeper: gatekeeperAgent,
  extractor: extractorAgent,
  normalizer: normalizerAgent,
  analyst: analystAgent,
};
