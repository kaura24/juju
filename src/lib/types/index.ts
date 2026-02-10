/** File: src/lib/types/index.ts */
/**
 * 주주명부 분석 시스템 타입 정의
 * - 주주명부 구성 노드 및 속성 정의
 * - 개인/법인 판별 신호 정의
 * - 지분 산정 방식 다양화
 */

// ============================================
// 공통 타입
// ============================================

/** 근거 참조 */
export interface EvidenceRef {
  page_no: number;
  line_snippet: string;
  bbox?: { x: number; y: number; w: number; h: number };
  source: 'VLM' | 'OCR' | 'PDF_TEXT';
}

/** 룰 트리거 */
export interface RuleTrigger {
  rule_id: string;
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  message: string;
  evidence_refs?: EvidenceRef[];
  suggestion?: string;
  metrics?: Record<string, unknown>;
}

// ============================================
// 주주명부 구성 노드 및 속성 정의
// ============================================

/**
 * 개인/법인 판별 신호 (Entity Type Signals)
 * - 문서에서 발견된 단서들
 */
export interface EntityTypeSignals {
  // === 개인(INDIVIDUAL) 신호 ===
  /** 주민등록번호 패턴 (000000-0000000) - 개인 식별자 옵션 1 */
  has_resident_id_pattern: boolean;
  /** 생년월일 표기 - 개인 식별자 옵션 2 (주민번호 대신 사용) */
  has_birth_date: boolean;
  /** 개인 이름 형식 (2-4자 한글 성명) - 보조 신호 */
  has_personal_name_format: boolean;
  /** "개인" 명시 표기 */
  explicitly_marked_individual: boolean;
  /** 컬럼 헤더가 개인 식별자를 나타냄 ("주민등록번호", "생년월일" 등) */
  column_indicates_individual: boolean;

  // === 법인(CORPORATE) 신호 ===
  /** "(주)", "주식회사", "유한회사" 등 법인 표기 */
  has_corporate_prefix_suffix: boolean;
  /** 사업자등록번호 패턴 (000-00-00000) - 법인 식별자 옵션 1 */
  has_business_reg_number: boolean;
  /** 법인등록번호 패턴 (000000-0000000) - 법인 식별자 옵션 2 */
  has_corporate_reg_number: boolean;
  /** "대표이사", "대표자" 언급 */
  has_representative_mention: boolean;
  /** "법인" 명시 표기 */
  explicitly_marked_corporate: boolean;
  /** 외국 법인 표기 (Ltd, Inc, Corp, LLC, GmbH 등) */
  has_foreign_corporate_suffix: boolean;
  /** 투자조합, 펀드, 재단, 조합 등 */
  has_investment_entity_keyword: boolean;
  /** 컬럼 헤더가 법인 식별자를 나타냄 ("법인등록번호", "사업자번호" 등) */
  column_indicates_corporate: boolean;

  // === 원본 텍스트 ===
  raw_signals: string[];

  // === 컬럼 헤더 정보 ===
  identifier_column_header?: string;  // 식별자 컬럼의 헤더명
}

/**
 * 지분 산정 방식 (Ownership Calculation Basis)
 */
export type OwnershipBasis =
  | 'SHARE_COUNT'      // 주식수 기준
  | 'RATIO_PERCENT'    // 지분율(%) 기준
  | 'AMOUNT_KRW'       // 금액(원) 기준
  | 'AMOUNT_SHARES'    // 출자좌수 기준 (조합 등)
  | 'PAR_VALUE'        // 액면가 기준
  | 'CAPITAL_AMOUNT'   // 자본금 기준
  | 'UNKNOWN';

/**
 * 식별자 유형 (Identifier Type)
 * - 개인: 주민등록번호 또는 생년월일
 * - 법인: 법인등록번호 또는 사업자등록번호
 */
export type IdentifierType =
  | 'RESIDENT_ID'      // 주민등록번호 (개인) - 000000-0000000
  | 'BIRTH_DATE'       // 생년월일 (개인) - YYYY-MM-DD, YYMMDD 등
  | 'CORPORATE_REG'    // 법인등록번호 (법인) - 000000-0000000
  | 'BUSINESS_REG'     // 사업자등록번호 (법인) - 000-00-00000
  | 'FOREIGN_ID'       // 외국인/외국법인 식별번호
  | 'OTHER'            // 기타
  | 'UNKNOWN';         // 유형 불명

/**
 * 주주 속성 (Shareholder Properties)
 * - 주주명부에서 추출 가능한 모든 속성
 */
export interface ShareholderProperties {
  // === 식별 정보 ===
  /** 성명/상호 (원본) */
  name_raw: string | null;
  /** 정규화된 이름 */
  name_normalized: string | null;

  // === 개인 식별 정보 ===
  /** 주민등록번호 (마스킹 가능: 000000-*******) - 개인 식별자 옵션 1 */
  resident_id: string | null;
  /** 생년월일 - 개인 식별자 옵션 2 (주민번호 대신 사용 가능) */
  birth_date: string | null;
  /** 성별 */
  gender: 'M' | 'F' | 'UNKNOWN' | null;

  // === 법인 식별 정보 ===
  /** 사업자등록번호 - 법인 식별자 옵션 1 (000-00-00000) */
  business_reg_number: string | null;
  /** 법인등록번호 - 법인 식별자 옵션 2 (000000-0000000) */
  corporate_reg_number: string | null;
  /** 대표자명 */
  representative_name: string | null;
  /** 법인 유형 */
  corporate_type: string | null;  // 주식회사, 유한회사, 합자회사 등

  // === 연락처 정보 ===
  /** 주소 */
  address: string | null;
  /** 전화번호 */
  phone: string | null;
  /** 이메일 */
  email: string | null;

  // === 지분 정보 (다양한 기준) ===
  /** 주식수 */
  share_count: number | null;
  /** 지분율 (0~100) */
  ratio_percent: number | null;
  /** 출자금액/투자금액 (원) */
  investment_amount: number | null;
  /** 액면금액 */
  par_value_total: number | null;
  /** 출자좌수 (조합 등) */
  unit_count: number | null;

  // === 주식 상세 ===
  /** 주식 종류 */
  share_class: string | null;  // 보통주, 우선주, 종류주식 등
  /** 1주 금액/액면가 */
  par_value_per_share: number | null;
  /** 취득일자 */
  acquisition_date: string | null;
  /** 취득 방법 */
  acquisition_method: string | null;  // 설립시, 유상증자, 양수 등

  // === 기타 속성 ===
  /** 순번/번호 */
  sequence_no: number | null;
  /** 비고/메모 */
  remarks: string | null;
  /** 의결권 유무 */
  has_voting_rights: boolean | null;
  /** 특수관계인 여부 */
  is_related_party: boolean | null;
  /** 최대주주 여부 표시 */
  is_marked_as_major: boolean | null;
}

/**
 * 문서 레벨 속성 (Document Properties)
 */
export interface DocumentProperties {
  // === 회사 정보 ===
  /** 회사명 */
  company_name: string | null;
  /** 사업자등록번호 */
  company_business_reg_number: string | null;
  /** 법인등록번호 */
  company_corporate_reg_number: string | null;

  // === 주식/자본 정보 ===
  /** 총발행주식수 */
  total_shares_issued: number | null;
  /** 자본금 총액 */
  total_capital: number | null;
  /** 1주의 금액/액면가 */
  par_value_per_share: number | null;
  /** 수권주식수 */
  authorized_shares: number | null;

  // === 문서 정보 ===
  /** 작성일/기준일 */
  document_date: string | null;
  /** 문서 종류 */
  document_type: string | null;  // 주주명부, 출자자명부, 사원명부 등
  /** 페이지 수 */
  page_count: number | null;

  // === 지분 산정 기준 ===
  /** 지분율 산정 기준 */
  ownership_basis: OwnershipBasis;
  /** 합계 행 존재 여부 */
  has_total_row: boolean;
  /** 합계 값 */
  total_row_values: {
    shares?: number;
    ratio?: number;
    amount?: number;
  } | null;
}

// ============================================
// B단계: Document Assessment
// ============================================

export interface RequiredFieldsPresent {
  shareholder_names: 'YES' | 'NO' | 'UNKNOWN';
  shares_or_ratio: 'YES' | 'NO' | 'UNKNOWN';
  ownership_amount: 'YES' | 'NO' | 'UNKNOWN';  // 금액 기준 지분
  total_shares: 'YES' | 'NO' | 'UNKNOWN';
  total_capital: 'YES' | 'NO' | 'UNKNOWN';
  share_class: 'YES' | 'NO' | 'UNKNOWN';
  entity_identifiers: 'YES' | 'NO' | 'UNKNOWN';  // 주민번호/사업자번호 등
}

export interface DocQuality {
  readability: 'HIGH' | 'MEDIUM' | 'LOW';
  table_structure: 'OK' | 'WEAK' | 'BROKEN';
  page_count_guess: number;
}

export interface DocumentAssessment {
  is_shareholder_register: 'YES' | 'NO' | 'UNKNOWN';
  has_required_info: 'YES' | 'NO' | 'UNKNOWN';
  required_fields_present: RequiredFieldsPresent;
  doc_quality: DocQuality;
  detected_document_type: string | null;  // 주주명부, 출자자명부, 사원명부 등
  detected_ownership_basis: OwnershipBasis;  // 지분 산정 기준 감지
  document_info?: {
    company_name: string | null;
    document_date: string | null;
  };
  rationale: string;
  evidence_refs: EvidenceRef[];
  route_suggestion: 'EXTRACT' | 'REQUEST_MORE_INPUT' | 'HITL_TRIAGE' | 'REJECT';
}

// ============================================
// C단계: Extractor Output
// ============================================

export interface RawShareholderRecord {
  // 원본 텍스트들
  raw_name: string | null;
  raw_identifier: string | null;  // 주민번호/사업자번호 등
  raw_shares: string | null;
  raw_ratio: string | null;
  raw_amount: string | null;  // 금액
  raw_share_class: string | null;
  raw_address: string | null;
  raw_remarks: string | null;

  // 감지된 신호
  raw_entity_hints: string[];
  entity_signals: Partial<EntityTypeSignals>;

  // 근거
  evidence_refs: EvidenceRef[];
}

export interface ExtractorOutput {
  records: RawShareholderRecord[];

  // 문서 레벨 정보
  document_info: {
    company_name: string | null;
    total_shares_declared: string | null;
    total_capital_declared: string | null;
    par_value_per_share: string | null;
    document_date: string | null;
    detected_ownership_basis: OwnershipBasis;
  };

  // 테이블 구조 정보
  table_structure: {
    column_headers: string[];
    /** 식별자 컬럼 헤더명 - entity_type 및 identifier_type 판정에 중요 */
    identifier_column_header: string | null;  // "주민등록번호", "생년월일", "법인등록번호", "사업자번호" 등
    has_total_row: boolean;
    total_row_values: Record<string, string> | null;
  };

  extraction_notes: string[];
  blockers: string[];
}

// ============================================
// D단계: Normalized Document
// ============================================

export type EntityType = 'INDIVIDUAL' | 'CORPORATE' | 'UNKNOWN';
export type OrderingRule = 'RATIO_DESC' | 'SHARES_DESC' | 'AMOUNT_DESC' | 'UNKNOWN';

export interface NormalizedShareholder {
  // 기본 정보
  name: string | null;
  entity_type: EntityType;
  entity_type_confidence: number;  // 판정 신뢰도
  entity_signals: Partial<EntityTypeSignals>;

  // 식별 정보
  identifier: string | null;  // 주민번호/생년월일/법인등록번호/사업자번호
  identifier_type: IdentifierType | null;  // RESIDENT_ID, BIRTH_DATE, CORPORATE_REG, BUSINESS_REG 등

  // 지분 정보 (다양한 기준)
  shares: number | null;
  ratio: number | null;
  amount: number | null;  // 금액

  // 주식 상세
  share_class: string | null;

  // 메타
  evidence_refs: EvidenceRef[];
  confidence: number;
  unknown_reasons: string[];
}

export interface NormalizedDoc {
  shareholders: NormalizedShareholder[];

  // 문서 속성
  document_properties: DocumentProperties;

  // 감지된 패턴
  ordering_detected: OrderingRule;
  ownership_basis_detected: OwnershipBasis;

  normalization_notes: string[];
}

// ============================================
// E단계: Validation Report
// ============================================

export interface SummaryMetrics {
  total_records: number;
  null_shares_count: number;
  null_ratio_count: number;
  null_amount_count: number;
  sum_shares: number | null;
  sum_ratio: number | null;
  sum_amount: number | null;
  has_reference_total: boolean;
  individual_count: number;
  corporate_count: number;
  unknown_entity_count: number;
}

export interface ValidationReport {
  status: 'PASS' | 'NEED_HITL' | 'REJECT';
  triggers: RuleTrigger[];
  summary_metrics: SummaryMetrics;
  /** Data quality score (0-100). Higher is better. */
  data_quality_score?: number;
  /** List of rule IDs that triggered BLOCKER severity. */
  structural_failures?: string[];
}

// ============================================
// INSIGHTS단계: Answer Set
// ============================================

export interface Decidability {
  is_decidable: boolean;
  reason: string;
}

export interface UnknownAnswer {
  UNKNOWN: true;
  reason: string;
}

export interface MajorShareholderAnswer {
  name: string;
  ratio: number; // ratio_effective
}

export interface InsightsAnswerSet {
  document_assessment: {
    is_valid_shareholder_register: "YES" | "NO" | "UNKNOWN";
    evidence_refs: EvidenceRef[];
  };

  // 25% 이상: coverage==1.0일 때만 확정 목록
  over_25_percent: NormalizedShareholder[] | UnknownAnswer;

  ordering_rule: "RATIO_DESC" | "SHARES_DESC" | "AMOUNT_DESC" | "UNKNOWN";

  totals: {
    total_shares_declared: number | null;
    total_amount_declared: number | null;
  };

  /** 발행일 (Issue Date) */
  document_date: string | null;
  /** 발행일 경과 여부 (1년 기준) */
  document_date_staleness?: {
    is_stale: boolean;
    days_diff: number;
    threshold_days: number;
  };
  /** 대상 회사명 */
  company_name: string | null;

  share_classes_found: string[];
  trust_level: "HIGH" | "MEDIUM" | "LOW";
  cannot_determine: string[];

  /** AI 종합 소견 (추출 데이터 + 검증 결과 종합) */
  synthesis_reasoning?: string;
  /** 종합 판계 신뢰도 (0~1.0) */
  synthesis_confidence?: number;

  validation_summary: {
    status: "PASS" | "NEED_HITL" | "REJECT";
    triggers: RuleTrigger[];
    decidability: Decidability;
    summary_metrics: SummaryMetrics;
  };
}

// ============================================
// Stage Event (타임라인 단위)
// ============================================

export type StageName = 'QUEUE' | 'B' | 'C' | 'D' | 'E' | 'INSIGHTS' | 'FastExtractor' | 'FAST';
export type NextAction = 'AUTO_NEXT' | 'AUTO_RETRY' | 'HITL' | 'REJECT';

export interface StageEvent {
  stage_name: StageName;
  summary: string;
  rationale: string;
  confidence: number;
  outputs: DocumentAssessment | ExtractorOutput | NormalizedDoc | ValidationReport | InsightsAnswerSet;
  triggers: RuleTrigger[];
  next_action: NextAction;
  timestamp: string;
}

// ============================================
// HITL (Human-in-the-Loop)
// ============================================

export type RequiredAction =
  | 'RESCAN_REQUEST'
  | 'MISSING_PAGES_REQUEST'
  | 'MANUAL_CORRECTION'
  | 'DOCUMENT_CLASSIFICATION'
  | 'REFERENCE_VALUE_INPUT'
  | 'ENTITY_TYPE_CLARIFICATION';

export type ReasonCode =
  | 'DOCUMENT_CLASSIFICATION_NEEDED'
  | 'MISSING_REQUIRED_FIELD_OR_PARSE_FAILURE'
  | 'TOTAL_SHARES_MISMATCH'
  | 'RATIO_INCONSISTENCY'
  | 'AMOUNT_INCONSISTENCY'
  | 'REFERENCE_VALUE_MISSING'
  | 'EXTRACTION_FAILED'
  | 'ENTITY_TYPE_AMBIGUOUS';

export interface HITLPacket {
  packet_id: string; // Added packet_id
  id: string; // keeping id for backward compatibility
  doc_id: string;
  run_id: string;
  stage: StageName;
  status?: 'PENDING' | 'RESOLVED' | 'IGNORED';
  reason_codes: string[]; // Relaxed type for now
  required_action: string; // Relaxed type for now
  triggers: RuleTrigger[];
  operator_notes: string[];
  payload: {
    normalized?: NormalizedDoc;
    extractor_output?: ExtractorOutput;
    assessment?: DocumentAssessment;
  };
  created_at: string;
  resolved_at?: string;
  resolution?: {
    action_taken: string;
    resolved_by: string;
    corrections?: Record<string, unknown>;
  };
  context_info?: {
    company_name: string | null;
    document_date: string | null;
    shareholder_names: string[];
  };
  context_data?: any;
  document_snapshot?: {
    company_name: string;
    document_date: string;
    shareholder_count: number;
    preview_names: string[];
  };
}

// ============================================
// Run (실행 상태)
// ============================================

export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'hitl' | 'rejected' | 'error';

export interface Run {
  id: string;
  status: RunStatus;
  files: string[];
  created_at: string;
  updated_at: string;
  current_stage?: StageName;
  error?: string; // Added error
  error_message?: string;
  execution_mode?: 'FAST' | 'MULTI_AGENT';
  storage_provider?: 'SUPABASE' | 'LOCAL';
  file_metadata?: Record<string, { original_name: string }>;
}

// ============================================
// SSE Event Types
// ============================================

export type SSEEventType = 'stage_event' | 'final_answer' | 'hitl_required' | 'error' | 'completed' | 'agent_log' | 'log_entry';

// Agent Log Summary (for SSE)
export interface AgentLogSummary {
  total_duration_ms: number;
  stages_completed: string[];
  stages_skipped: string[];
  final_status: string;
  key_findings: string[];
  warnings: string[];
  errors: string[];
  hitl_reasons?: string[];
  next_steps?: string[];
}

export interface SSEMessage {
  type: SSEEventType;
  payload: StageEvent | InsightsAnswerSet | HITLPacket | AgentLogSummary | { message: string };
  timestamp: string;
}

// ============================================
// API Request/Response Types
// ============================================

export interface CreateRunResponse {
  runId: string;
}

export interface ExecuteRunResponse {
  success: boolean;
  message: string;
}

export interface HITLResolveRequest {
  action_taken: string;
  resolved_by: string;
  corrections?: Record<string, unknown>;
}

export interface HITLResolveResponse {
  success: boolean;
  resumed: boolean;
  message: string;
}

// ============================================
// Type Guards
// ============================================

export function isUnknownAnswer(value: unknown): value is UnknownAnswer {
  return typeof value === 'object' && value !== null && 'UNKNOWN' in value && (value as UnknownAnswer).UNKNOWN === true;
}

export function isMajorShareholderAnswer(value: unknown): value is MajorShareholderAnswer[] {
  return Array.isArray(value) && value.length > 0 && !('UNKNOWN' in value[0]);
}

// ============================================
// 상수 정의
// ============================================

/** 개인 판별 신호 키워드 */
export const INDIVIDUAL_SIGNALS = {
  // 주민등록번호 패턴 (000000-0000000)
  RESIDENT_ID_PATTERN: /\d{6}[-\s]?\d{7}/,

  // 생년월일 패턴 (주민번호 대신 사용 가능)
  BIRTH_DATE_PATTERNS: [
    /\d{4}[-./년]\s?\d{1,2}[-./월]\s?\d{1,2}일?/,  // YYYY년 MM월 DD일, YYYY-MM-DD
    /\d{2}[-./]\d{1,2}[-./]\d{1,2}/,  // YY-MM-DD
    /\d{6}/,  // YYMMDD (6자리 숫자만)
  ],

  // 명시적 개인 키워드
  EXPLICIT_KEYWORDS: ['개인', '자연인', '본인'],

  // 컬럼 헤더에서 개인임을 나타내는 키워드
  COLUMN_HINTS: ['주민등록번호', '생년월일', '성명', '주민번호'],
};

/** 법인 판별 신호 키워드 */
export const CORPORATE_SIGNALS = {
  // 법인 접두사/접미사
  PREFIXES: ['(주)', '주식회사', '㈜', '유한회사', '합자회사', '합명회사', '사단법인', '재단법인', '농업회사법인', '영농조합법인'],
  SUFFIXES: ['(주)', '주식회사', '㈜', 'Ltd', 'Ltd.', 'Inc', 'Inc.', 'Corp', 'Corp.', 'LLC', 'GmbH', 'Co.', 'Co.,Ltd', 'PTE', 'BV', 'NV'],

  // 사업자등록번호 패턴 (000-00-00000)
  BUSINESS_REG_PATTERN: /\d{3}[-\s]?\d{2}[-\s]?\d{5}/,

  // 법인등록번호 패턴 (000000-0000000) - 주민번호와 형식 동일하나 컨텍스트로 구분
  CORPORATE_REG_PATTERN: /\d{6}[-\s]?\d{7}/,

  // 명시적 법인 키워드
  EXPLICIT_KEYWORDS: ['법인', '대표이사', '대표자', '투자조합', '펀드', '재단', '조합', '기금', '회사'],

  // 컬럼 헤더에서 법인임을 나타내는 키워드
  COLUMN_HINTS: ['법인등록번호', '사업자등록번호', '사업자번호', '법인번호', '상호'],
};

/** 식별자 유형 판별 함수 */
export function detectIdentifierType(
  identifier: string,
  entityType: EntityType,
  columnHeader?: string
): IdentifierType {
  if (!identifier) return 'UNKNOWN';

  const cleaned = identifier.replace(/\s/g, '');

  // 사업자등록번호 패턴 (000-00-00000) - 법인 전용
  if (CORPORATE_SIGNALS.BUSINESS_REG_PATTERN.test(cleaned)) {
    return 'BUSINESS_REG';
  }

  // 6자리-7자리 패턴 (주민번호 또는 법인등록번호)
  if (/^\d{6}[-]?\d{7}$/.test(cleaned)) {
    // 컬럼 헤더로 구분
    if (columnHeader) {
      if (columnHeader.includes('법인') || columnHeader.includes('사업자')) {
        return 'CORPORATE_REG';
      }
      if (columnHeader.includes('주민')) {
        return 'RESIDENT_ID';
      }
    }
    // entity_type으로 구분
    if (entityType === 'CORPORATE') return 'CORPORATE_REG';
    if (entityType === 'INDIVIDUAL') return 'RESIDENT_ID';
    return 'UNKNOWN';
  }

  // 생년월일 패턴
  for (const pattern of INDIVIDUAL_SIGNALS.BIRTH_DATE_PATTERNS) {
    if (pattern.test(cleaned)) {
      return 'BIRTH_DATE';
    }
  }

  return 'OTHER';
}

/** 지분 산정 기준별 컬럼 키워드 */
export const OWNERSHIP_COLUMN_KEYWORDS = {
  SHARE_COUNT: ['주식수', '주수', '보유주식', '소유주식', '주식', 'shares'],
  RATIO_PERCENT: ['지분율', '지분비율', '비율', '점유율', '%', 'ratio', 'percentage'],
  AMOUNT_KRW: ['금액', '출자금', '투자금', '출자액', '취득가액', '원', 'amount'],
  UNIT_COUNT: ['출자좌수', '좌수', '구좌수', 'units'],
};
