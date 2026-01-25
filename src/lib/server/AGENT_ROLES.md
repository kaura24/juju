# Agent 역할 정의서

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CODE ORCHESTRATOR                                │
│  (LLM이 아닌 코드가 흐름 제어, 분기 결정, 에러 처리)                      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  B_Gatekeeper │ → │  C_Extractor  │ → │  D_Normalizer │
│   (LLM Agent) │   │   (LLM Agent) │   │   (LLM Agent) │
│   문서 판정    │   │   데이터 추출  │   │    정규화     │
└───────────────┘   └───────────────┘   └───────────────┘
                                                │
                    ┌───────────────────────────┼───────────────┐
                    ▼                           ▼               ▼
            ┌───────────────┐           ┌───────────────┐   ┌───────────────┐
            │  E_Validator  │     →     │  INS_Analyst  │ → │ Final Output  │
            │   (CODE)      │           │   (LLM Agent) │   │               │
            │   정합성 검증  │           │   인사이트    │   │               │
            └───────────────┘           └───────────────┘   └───────────────┘
```

---

## 1. ORCHESTRATOR (코드)

### 역할
- **흐름 제어**: B → C → D → E → INSIGHTS 순차 실행
- **분기 결정**: 각 단계 결과에 따른 HITL/REJECT/AUTO_NEXT 결정
- **상태 관리**: Run 상태 업데이트, StageEvent 발송
- **에러 처리**: 예외 발생 시 에러 상태로 전환

### 핵심 원칙
```
⚠️ Orchestrator는 LLM이 아닌 코드다
⚠️ Orchestrator는 데이터를 분석/판단하지 않는다
⚠️ Orchestrator는 Agent의 출력을 신뢰하고 그대로 전달한다
```

### 분기 로직
| 단계 | 조건 | 결과 |
|------|------|------|
| B | route_suggestion = "REJECT" | REJECT |
| B | route_suggestion ≠ "EXTRACT" | HITL |
| C | blockers.length > 0 | HITL |
| D | (항상 통과) | AUTO_NEXT |
| E | status = "NEED_HITL" | HITL |
| E | status = "REJECT" | REJECT |

---

## 2. B_Gatekeeper (LLM Agent)

### 역할
문서가 "주주명부(또는 유사 문서)"인지 판정

### 입력
- 이미지 (base64)

### 출력: `DocumentAssessment`
```typescript
{
  is_shareholder_register: "YES" | "NO" | "UNKNOWN",
  has_required_info: "YES" | "NO" | "UNKNOWN",
  required_fields_present: {...},
  doc_quality: { readability, table_structure, page_count_guess },
  detected_document_type: string | null,
  detected_ownership_basis: OwnershipBasis,
  rationale: string,
  evidence_refs: EvidenceRef[],
  route_suggestion: "EXTRACT" | "REQUEST_MORE_INPUT" | "HITL_TRIAGE" | "REJECT"
}
```

### ✅ 허용 범위
- 문서 유형 판정 (주주명부인가?)
- 문서 품질 평가 (읽기 가능한가?)
- 필요 정보 존재 여부 판정
- 지분 산정 기준 감지 (어떤 기준으로 지분 표시?)
- 다음 단계 라우팅 제안

### ❌ 금지 사항
- 주주 데이터 추출 (C의 역할)
- 데이터 정규화 (D의 역할)
- 정합성 검증 (E의 역할)
- 대주주 판정 (INSIGHTS의 역할)

---

## 3. C_Extractor (LLM Agent)

### 역할
문서에서 모든 주주 관련 Raw 데이터를 추출

### 입력
- 이미지 (base64)
- DocumentAssessment (참조용 컨텍스트만)

### 출력: `ExtractorOutput`
```typescript
{
  records: RawShareholderRecord[],  // 원본 텍스트 그대로
  document_info: {
    company_name, total_shares_declared, total_capital_declared,
    par_value_per_share, document_date, detected_ownership_basis
  },
  table_structure: { 
    column_headers,     // 모든 컬럼 헤더
    identifier_column_header,  // 식별자 컬럼 헤더 ("주민등록번호", "생년월일", "법인등록번호", "사업자번호" 등)
    has_total_row, 
    total_row_values 
  },
  extraction_notes: string[],
  blockers: string[]
}
```

### ✅ 허용 범위
- 텍스트 원본 그대로 추출
- 테이블 구조 인식 (컬럼 헤더 포함)
- **식별자 컬럼 헤더 감지** (매우 중요!)
  - "주민등록번호" → 개인 신호
  - "생년월일" → 개인 신호
  - "법인등록번호" → 법인 신호
  - "사업자번호" → 법인 신호
- 개인/법인 신호(hints) 감지 및 기록
- 추출 불가 시 blockers 기록

### ❌ 금지 사항
- 숫자 변환 (D의 역할): "10,000" → 10000 ❌
- entity_type 최종 판정 (D의 역할): 신호만 기록 ✅
- identifier_type 판정 (D의 역할): 원본만 추출 ✅
- 합계 검증 (E의 역할)
- 누락된 값 추측

### ⚠️ 경계 주의
DocumentAssessment는 **참조용 컨텍스트**로만 사용:
- 문서 품질 정보를 참고하여 추출 전략 조정
- B의 판정 결과를 변경하거나 재평가하지 않음

---

## 4. D_Normalizer (LLM Agent)

### 역할
Raw 추출 데이터를 정규화된 구조로 변환

### 입력
- ExtractorOutput

### 출력: `NormalizedDoc`
```typescript
{
  shareholders: NormalizedShareholder[],
  document_properties: DocumentProperties,
  ordering_detected: OrderingRule,
  ownership_basis_detected: OwnershipBasis,
  normalization_notes: string[]
}
```

### ✅ 허용 범위
- 숫자 변환: "10,000" → 10000
- 지분율 변환: "25.5%" → 25.5
- 금액 변환: "1억" → 100000000
- entity_type 판정 (신호 기반):
  - entity_signals를 기반으로 INDIVIDUAL/CORPORATE/UNKNOWN 결정
  - 신뢰도(entity_type_confidence) 함께 출력
- **identifier_type 판정 (매우 중요!)**:
  - 컬럼 헤더와 entity_type을 기반으로 결정
- 정렬 순서 감지

### ❌ 금지 사항
- 합계 검증 (E의 역할)
- 데이터 임의 수정/보정
- 누락된 값을 0으로 채움
- 명시적 신호 없이 entity_type 단정

### ⚠️ entity_type 판정 규칙
```
신호 있음 (has_business_reg_number, has_corporate_prefix_suffix, column_indicates_corporate 등)
  → CORPORATE (confidence: 0.9+)

신호 있음 (has_resident_id_pattern, has_birth_date, column_indicates_individual 등)
  → INDIVIDUAL (confidence: 0.9+)

신호 없음
  → UNKNOWN (confidence: 0.5 이하)
  → 이름 형태만으로 추측 금지!
```

### ⚠️ identifier_type 판정 규칙
| 식별번호 패턴 | 컬럼 헤더 | entity_type | → identifier_type |
|--------------|-----------|-------------|-------------------|
| 000-00-00000 | 무관 | 무관 | BUSINESS_REG |
| 000000-0000000 | "주민등록번호" | - | RESIDENT_ID |
| 000000-0000000 | "법인등록번호" | - | CORPORATE_REG |
| 000000-0000000 | 없음 | INDIVIDUAL | RESIDENT_ID |
| 000000-0000000 | 없음 | CORPORATE | CORPORATE_REG |
| 000000-0000000 | 없음 | UNKNOWN | UNKNOWN |
| YYYY-MM-DD | - | - | BIRTH_DATE |
| YYMMDD (6자리) | "생년월일" | - | BIRTH_DATE |

**개인은 주민등록번호 또는 생년월일 둘 중 하나를 사용할 수 있음**
**법인은 사업자등록번호 또는 법인등록번호 둘 중 하나를 사용할 수 있음**

---

## 5. E_Validator (CODE - 결정적)

### 역할
정규화된 데이터의 정합성 검증

### 입력
- NormalizedDoc

### 출력: `ValidationReport`
```typescript
{
  status: "PASS" | "NEED_HITL" | "REJECT",
  triggers: RuleTrigger[],
  summary_metrics: SummaryMetrics
}
```

### ✅ 허용 범위 (코드로 수행)
- 레코드 수 검증
- 합계 검증 (주식수, 금액, 지분율)
- 0 이하 값 검증
- 중복 검증
- 메트릭 계산

### ❌ 금지 사항
- 데이터 수정
- 대주주 판정 (INSIGHTS의 역할)
- 25% 이상 보유자 판정 (INSIGHTS의 역할)

### 핵심 원칙
```
⚠️ E_Validator는 LLM이 아닌 코드다
⚠️ PASS/NEED_HITL/REJECT는 코드 룰로만 결정한다
⚠️ 데이터를 수정하지 않고 문제만 보고한다
```

### 검증 룰 목록
| rule_id | severity | 조건 |
|---------|----------|------|
| E-MIN-001 | BLOCKER | records.length < 1 |
| E-ZERO-001 | BLOCKER | shares ≤ 0 존재 |
| E-ZERO-002 | BLOCKER | amount ≤ 0 존재 |
| E-SUM-001 | BLOCKER | sum(shares) ≠ total (>1% 차이) |
| E-SUM-002 | BLOCKER | sum(amount) ≠ capital (>1% 차이) |
| E-RAT-001 | BLOCKER | sum(ratio) ∉ [99.5, 100.5] |
| E-REF-001 | WARNING | 기준값 부족 |
| E-ENT-001 | INFO | UNKNOWN entity > 30% |
| E-DUP-001 | WARNING | 중복 이름 |

---

## 6. INS_Analyst (LLM Agent)

### 역할
정규화된 데이터를 분석하여 최종 인사이트 생성

### 입력
- NormalizedDoc
- ValidationReport

### 출력: `InsightsAnswerSet`
```typescript
{
  document_assessment: {...},
  major_shareholder: MajorShareholderAnswer | UnknownAnswer,
  top_shareholders_sorted: NormalizedShareholder[],
  ordering_rule: OrderingRule,
  ownership_basis_used: OwnershipBasis,
  over_25_percent: [...] | UnknownAnswer,
  over_25_determination: { basis, calculation_method, total_reference },
  document_summary: {...},
  share_classes_found: string[],
  trust_level: "HIGH" | "MEDIUM" | "LOW",
  cannot_determine: string[],
  validation_summary: {...}
}
```

### ✅ 허용 범위
- 대주주 판정 (ratio/shares/amount 기준)
- 25% 이상 보유자 계산
- 정렬 및 순위 결정
- 신뢰도 평가
- UNKNOWN 처리

### ❌ 금지 사항
- 원본 데이터 수정
- entity_type 재판정 (D의 결과 그대로 사용)
- 검증 결과 변경 (E의 결과 그대로 사용)
- 기준값 없이 비율 추정

### ⚠️ 25% 판정 규칙
```
1순위: ratio 직접 사용 (ratio ≥ 25)
2순위: shares / total_shares × 100 (기준값 있을 때만)
3순위: amount / total_capital × 100 (기준값 있을 때만)
4순위: UNKNOWN (기준값 없음)
```

---

## 데이터 흐름 요약

```
[이미지]
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ B_Gatekeeper                                                 │
│ "이 문서가 주주명부인가?"                                      │
│ 출력: DocumentAssessment                                      │
└─────────────────────────────────────────────────────────────┘
    │ route_suggestion = "EXTRACT"
    ▼
┌─────────────────────────────────────────────────────────────┐
│ C_Extractor                                                  │
│ "문서에서 주주 정보를 원본 그대로 추출"                          │
│ 출력: ExtractorOutput (raw_name, raw_shares 등)               │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ D_Normalizer                                                 │
│ "추출된 데이터를 정규화 (숫자 변환, entity_type 판정)"           │
│ 출력: NormalizedDoc (shares: number, entity_type 등)          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ E_Validator (CODE)                                           │
│ "정합성 검증 (합계 일치, 0 이하 값 등)"                         │
│ 출력: ValidationReport (PASS/NEED_HITL/REJECT)                │
└─────────────────────────────────────────────────────────────┘
    │ status = "PASS"
    ▼
┌─────────────────────────────────────────────────────────────┐
│ INS_Analyst                                                  │
│ "대주주, 25% 이상 보유자, 신뢰도 등 인사이트 생성"               │
│ 출력: InsightsAnswerSet (final answer)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 경계 위반 체크리스트

### B_Gatekeeper
- [ ] 주주 이름을 추출하지 않았는가?
- [ ] 데이터를 정규화하지 않았는가?
- [ ] 대주주를 판정하지 않았는가?

### C_Extractor
- [ ] 숫자를 변환하지 않았는가? ("10,000" 그대로 유지)
- [ ] entity_type을 최종 판정하지 않았는가? (신호만 기록)
- [ ] 합계를 검증하지 않았는가?

### D_Normalizer
- [ ] 합계를 검증하지 않았는가?
- [ ] 누락된 값을 0으로 채우지 않았는가?
- [ ] 명시적 신호 없이 entity_type을 단정하지 않았는가?

### E_Validator
- [ ] 데이터를 수정하지 않았는가?
- [ ] 대주주를 판정하지 않았는가?

### INS_Analyst
- [ ] entity_type을 재판정하지 않았는가?
- [ ] 기준값 없이 비율을 추정하지 않았는가?
- [ ] 검증 결과를 변경하지 않았는가?
