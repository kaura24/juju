/** File: src/lib/validator/ruleEngine.ts */
/**
 * 결정적 검증 룰 엔진 (E단계)
 * - LLM이 아닌 코드로 PASS/HITL/REJECT 결정
 * - 정합성 검증 수행
 * - 다양한 지분 산정 기준 지원
 */

import type { NormalizedDoc, ValidationReport, RuleTrigger, SummaryMetrics } from '$lib/types';

/**
 * 정규화된 문서 검증
 * @param doc 정규화된 주주명부 데이터
 * @returns 검증 결과 (PASS/NEED_HITL/REJECT)
 */
export function validateNormalized(doc: NormalizedDoc): ValidationReport {

  // ============================================
  // 변수 선언 및 메트릭 계산
  // ============================================
  const triggers: RuleTrigger[] = [];
  const { shareholders, document_properties } = doc;
  const totalSharesDeclared = document_properties?.total_shares_issued ?? null;
  const totalCapital = document_properties?.total_capital ?? null;

  const total_records = shareholders.length;
  const null_shares_count = shareholders.filter(s => s.shares === null).length;
  const null_ratio_count = shareholders.filter(s => s.ratio === null).length;
  const null_amount_count = shareholders.filter(s => s.amount === null).length;

  const validSharesRecords = shareholders.filter(s => s.shares !== null);
  const validRatioRecords = shareholders.filter(s => s.ratio !== null);
  const validAmountRecords = shareholders.filter(s => s.amount !== null);

  const sum_shares = validSharesRecords.length === total_records
    ? shareholders.reduce((acc, s) => acc + (s.shares ?? 0), 0)
    : null;

  const ratioCoverage = total_records > 0 ? validRatioRecords.length / total_records : 0;
  const sum_ratio = ratioCoverage >= 0.8
    ? shareholders.reduce((acc, s) => acc + (s.ratio ?? 0), 0)
    : null;

  const amountCoverage = total_records > 0 ? validAmountRecords.length / total_records : 0;
  const sum_amount = amountCoverage >= 0.8
    ? shareholders.reduce((acc, s) => acc + (s.amount ?? 0), 0)
    : null;

  const has_reference_total = totalSharesDeclared !== null || totalCapital !== null;

  // Entity type 통계
  const individual_count = shareholders.filter(s => s.entity_type === 'INDIVIDUAL').length;
  const corporate_count = shareholders.filter(s => s.entity_type === 'CORPORATE').length;
  const unknown_entity_count = shareholders.filter(s => s.entity_type === 'UNKNOWN').length;

  // ============================================
  // E-MIN-001: 최소 레코드 수
  // ============================================
  if (total_records < 1) {
    triggers.push({
      rule_id: 'E-MIN-001',
      severity: 'BLOCKER',
      message: '주주 레코드가 없습니다',
      suggestion: 'MANUAL_CORRECTION',
      metrics: { total_records }
    });
  }

  // ============================================
  // E-META-001: 대상 회사명 필수
  // ============================================
  if (!document_properties?.company_name) {
    triggers.push({
      rule_id: 'E-META-001',
      severity: 'BLOCKER',
      message: '분석 대상 회사명을 식별하지 못했습니다',
      suggestion: 'MANUAL_CORRECTION'
    });
  }

  // ============================================
  // E-META-002: 발행일(기준일) 필수
  // ============================================
  if (!document_properties?.document_date) {
    triggers.push({
      rule_id: 'E-META-002',
      severity: 'BLOCKER',
      message: '문서의 발행일(기준일)을 식별하지 못했습니다',
      suggestion: 'MANUAL_CORRECTION'
    });
  }

  // ============================================
  // E-META-003: 발행일 경과 여부 (1년)
  // ============================================
  if (document_properties?.document_date) {
    const docDate = new Date(document_properties.document_date);
    const today = new Date('2026-01-25'); // Current system time
    const diffTime = today.getTime() - docDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 365) {
      triggers.push({
        rule_id: 'E-META-003',
        severity: 'BLOCKER',
        message: `문서 발행일이 1년을 경과했습니다 (${diffDays}일 경과). 최신 명부를 사용해야 합니다.`,
        suggestion: 'RESCAN_REQUEST',
        metrics: { days_diff: diffDays, threshold_days: 365 }
      });
    }
  }

  // ============================================
  // E-META-004: 날짜 정보 완전성 검증 (YYYY-MM-DD)
  // ============================================
  if (document_properties?.document_date) {
    const dateStr = document_properties.document_date;
    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoPattern.test(dateStr)) {
      triggers.push({
        rule_id: 'E-META-004',
        severity: 'BLOCKER',
        message: `불완전한 날짜 형식 발견: "${dateStr}". 날짜는 반드시 YYYY-MM-DD(일자 포함) 형식이어야 합니다.`,
        suggestion: 'MANUAL_CORRECTION',
        metrics: { raw_date: dateStr }
      });
    }
  }

  // ============================================
  // E-NULL-001: 주식수 누락 비율
  // ============================================
  const null_shares_ratio = total_records > 0 ? null_shares_count / total_records : 0;
  if (null_shares_ratio > 0.5 && ratioCoverage < 0.5 && amountCoverage < 0.5) {
    triggers.push({
      rule_id: 'E-NULL-001',
      severity: 'WARNING',
      message: `지분 정보 부족: 주식수 ${(null_shares_ratio * 100).toFixed(0)}% 누락, 지분율 ${((1 - ratioCoverage) * 100).toFixed(0)}% 누락`,
      metrics: { null_shares_ratio: Math.round(null_shares_ratio * 100) / 100 }
    });
  }

  // ============================================
  // E-ZERO-001: 0 이하 주식수
  // ============================================
  const zeroOrNegativeShares = shareholders.filter(s => s.shares !== null && s.shares <= 0);
  if (zeroOrNegativeShares.length > 0) {
    triggers.push({
      rule_id: 'E-ZERO-001',
      severity: 'BLOCKER',
      message: `0 이하 주식수 ${zeroOrNegativeShares.length}건 발견`,
      suggestion: 'MANUAL_CORRECTION',
      evidence_refs: zeroOrNegativeShares.flatMap(s => s.evidence_refs),
      metrics: { count: zeroOrNegativeShares.length }
    });
  }

  // ============================================
  // E-ZERO-002: 0 이하 금액
  // ============================================
  const zeroOrNegativeAmount = shareholders.filter(s => s.amount !== null && s.amount <= 0);
  if (zeroOrNegativeAmount.length > 0) {
    triggers.push({
      rule_id: 'E-ZERO-002',
      severity: 'BLOCKER',
      message: `0 이하 금액 ${zeroOrNegativeAmount.length}건 발견`,
      suggestion: 'MANUAL_CORRECTION',
      evidence_refs: zeroOrNegativeAmount.flatMap(s => s.evidence_refs),
      metrics: { count: zeroOrNegativeAmount.length }
    });
  }

  // ============================================
  // E-SUM-001: 주식수 합계 검증
  // ============================================
  if (totalSharesDeclared !== null && totalSharesDeclared > 0 && sum_shares !== null) {
    const diff = Math.abs(sum_shares - totalSharesDeclared) / totalSharesDeclared;
    if (diff > 0.01) {
      triggers.push({
        rule_id: 'E-SUM-001',
        severity: 'BLOCKER',
        message: `주식수 합계 불일치: 합계=${sum_shares.toLocaleString()}, 선언값=${totalSharesDeclared.toLocaleString()} (${(diff * 100).toFixed(1)}% 차이)`,
        suggestion: 'REFERENCE_VALUE_INPUT',
        metrics: {
          sum_shares,
          total_shares_declared: totalSharesDeclared,
          diff_percent: (diff * 100).toFixed(2)
        }
      });
    }
  }

  // ============================================
  // E-SUM-002: 금액 합계 검증
  // ============================================
  if (totalCapital !== null && totalCapital > 0 && sum_amount !== null) {
    const diff = Math.abs(sum_amount - totalCapital) / totalCapital;
    if (diff > 0.01) {
      triggers.push({
        rule_id: 'E-SUM-002',
        severity: 'BLOCKER',
        message: `금액 합계 불일치: 합계=${sum_amount.toLocaleString()}원, 자본금=${totalCapital.toLocaleString()}원 (${(diff * 100).toFixed(1)}% 차이)`,
        suggestion: 'REFERENCE_VALUE_INPUT',
        metrics: {
          sum_amount,
          total_capital: totalCapital,
          diff_percent: (diff * 100).toFixed(2)
        }
      });
    }
  }

  // ============================================
  // E-RAT-001: 지분율 합계 검증
  // ============================================
  if (sum_ratio !== null && validRatioRecords.length > 0) {
    if (sum_ratio > 100.5 || sum_ratio < 99.5) {
      triggers.push({
        rule_id: 'E-RAT-001',
        severity: 'BLOCKER',
        message: `지분율 합계 불일치: ${sum_ratio.toFixed(2)}% (100%±0.5% 범위 초과)`,
        suggestion: 'MANUAL_CORRECTION',
        metrics: { sum_ratio: Math.round(sum_ratio * 100) / 100, coverage: Math.round(ratioCoverage * 100) / 100 }
      });
    }
  }

  // ============================================
  // E-REF-001: 기준값 부족
  // ============================================
  if (!has_reference_total && ratioCoverage < 0.5) {
    triggers.push({
      rule_id: 'E-REF-001',
      severity: 'WARNING',
      message: '총발행주식수/자본금 선언값 없고 지분율도 불충분하여 25% 이상 보유자 판정 불가',
      suggestion: 'REFERENCE_VALUE_INPUT',
      metrics: { has_reference_total, ratioCoverage: Math.round(ratioCoverage * 100) / 100 }
    });
  }

  // ============================================
  // E-ENT-001: entity_type UNKNOWN 비율
  // ============================================
  const unknownEntityRatio = total_records > 0 ? unknown_entity_count / total_records : 0;
  if (unknownEntityRatio > 0.3) {
    triggers.push({
      rule_id: 'E-ENT-001',
      severity: 'INFO',
      message: `법인/개인 구분 불명확 ${(unknownEntityRatio * 100).toFixed(0)}% (${unknown_entity_count}/${total_records}명)`,
      metrics: {
        unknownEntityRatio: Math.round(unknownEntityRatio * 100) / 100,
        individual_count,
        corporate_count,
        unknown_entity_count
      }
    });
  }

  // ============================================
  // E-CON-001: 개별 레코드 지표 정합성 (shares vs ratio vs amount)
  // ============================================
  const consistencyInconsistencies: string[] = [];
  shareholders.forEach(s => {
    if (!s.name) return;

    // 1. 주식수 vs 지분율
    if (s.shares !== null && s.ratio !== null && totalSharesDeclared && totalSharesDeclared > 0) {
      const calculatedRatio = (s.shares / totalSharesDeclared) * 100;
      if (Math.abs(calculatedRatio - s.ratio) > 1.0) { // 1% threshold
        consistencyInconsistencies.push(`${s.name}: 주식수 기반(${calculatedRatio.toFixed(1)}%) vs 표시 지분율(${s.ratio}%) 불일치`);
      }
    }

    // 2. 금액(지분금액) vs 지분율
    if (s.amount !== null && s.ratio !== null && totalCapital && totalCapital > 0) {
      const calculatedRatio = (s.amount / totalCapital) * 100;
      if (Math.abs(calculatedRatio - s.ratio) > 1.0) {
        consistencyInconsistencies.push(`${s.name}: 금액 기반(${calculatedRatio.toFixed(1)}%) vs 표시 지분율(${s.ratio}%) 불일치`);
      }
    }

    // 3. 주식수 vs 금액 (교차)
    if (s.shares !== null && s.amount !== null && totalSharesDeclared && totalSharesDeclared > 0 && totalCapital && totalCapital > 0) {
      const shareRatio = s.shares / totalSharesDeclared;
      const amountRatio = s.amount / totalCapital;
      if (Math.abs(shareRatio - amountRatio) > 0.01) {
        consistencyInconsistencies.push(`${s.name}: 주식 비율(${(shareRatio * 100).toFixed(1)}%) vs 금액 비율(${(amountRatio * 100).toFixed(1)}%) 불일치`);
      }
    }
  });

  if (consistencyInconsistencies.length > 0) {
    triggers.push({
      rule_id: 'E-CON-001',
      severity: 'BLOCKER',
      message: `지표 간 정합성 오류 ${consistencyInconsistencies.length}건 발견 (예: ${consistencyInconsistencies[0]})`,
      suggestion: 'MANUAL_CORRECTION',
      metrics: { inconsistencies: consistencyInconsistencies }
    });
  }

  // ============================================
  // E-NAME-001: 성명 오타 교정 및 의심 감지 (HITL 트리거)
  // ============================================
  const nameCorrectionRecords = shareholders.filter((s: any) => {
    const notes = s.normalization_notes;
    if (Array.isArray(notes)) {
      return notes.some((n: any) => typeof n === 'string' && (n.includes('성명 오타 교정') || n.includes('성명 의심')));
    }
    if (typeof notes === 'string') {
      return notes.includes('성명 오타 교정') || notes.includes('성명 의심');
    }
    return false;
  });

  if (nameCorrectionRecords.length > 0) {
    triggers.push({
      rule_id: 'E-NAME-001',
      severity: 'BLOCKER',
      message: `성명 교정 또는 의심 ${nameCorrectionRecords.length}건 발생 (사람 확인 필요)`,
      suggestion: 'MANUAL_CORRECTION', // User needs to verify
      metrics: { names: nameCorrectionRecords.map((s: any) => s.name) }
    });
  }

  // ============================================
  // E-DUP-001: 중복 주주명 (WARNING)
  // ============================================
  const names = shareholders.map(s => s.name).filter((n): n is string => n !== null);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    triggers.push({
      rule_id: 'E-DUP-001',
      severity: 'WARNING',
      message: `동명이인 발견 (단순 이름 중복): ${[...new Set(duplicates)].join(', ')}`,
      metrics: { duplicates: [...new Set(duplicates)] }
    });
  }

  // ============================================
  // E-DUP-002: 완전 중복 레코드 (이름 + 식별번호 일치) - BLOCKER
  // ============================================
  const exactDuplicates: string[] = [];
  const seenStr = new Set<string>();

  shareholders.forEach(s => {
    if (s.name && s.identifier) {
      const key = `${s.name}|${s.identifier}`;
      if (seenStr.has(key)) {
        exactDuplicates.push(`${s.name}(${s.identifier})`);
      } else {
        seenStr.add(key);
      }
    }
  });

  if (exactDuplicates.length > 0) {
    triggers.push({
      rule_id: 'E-DUP-002',
      severity: 'BLOCKER', // Error!
      message: `완전 중복 레코드 ${exactDuplicates.length}건 감지! (이름+식별번호 일치 -> 데이터 오류)`,
      suggestion: 'MANUAL_CORRECTION', // Remove duplicate or fix
      metrics: { count: exactDuplicates.length, details: exactDuplicates }
    });
  }

  // ============================================
  // E-ID-001: 식별번호 형식 검증
  // ============================================
  const invalidIdentifiers = shareholders.filter(s => {
    if (!s.identifier) return false;
    // 주민등록번호 또는 사업자등록번호 패턴이 아닌 경우
    const residentPattern = /^\d{6}[-\s]?\d{7}$/;
    const businessPattern = /^\d{3}[-\s]?\d{2}[-\s]?\d{5}$/;
    const birthDatePattern = /^\d{4}[-./]?\d{2}[-./]?\d{2}$/;  // 생년월일 패턴
    return !residentPattern.test(s.identifier) &&
      !businessPattern.test(s.identifier) &&
      !birthDatePattern.test(s.identifier);
  });
  if (invalidIdentifiers.length > 0) {
    triggers.push({
      rule_id: 'E-ID-001',
      severity: 'INFO',
      message: `비표준 식별번호 형식 ${invalidIdentifiers.length}건`,
      metrics: { count: invalidIdentifiers.length }
    });
  }

  // ============================================
  // E-ID-002: 주주 식별자 필수 검증 (1:1 매칭)
  // 모든 주주는 반드시 식별정보(주민/법인/사업자번호 또는 생년월일)가 1:1로 매칭되어야 함
  // ============================================
  const shareholdersWithoutIdentifier = shareholders.filter(s => !s.identifier);

  if (shareholdersWithoutIdentifier.length > 0) {
    triggers.push({
      rule_id: 'E-ID-002',
      severity: 'BLOCKER',
      message: `개별 주주 식별 정보 누락 ${shareholdersWithoutIdentifier.length}건 (1:1 매칭 실패)`,
      suggestion: 'MANUAL_CORRECTION',
      evidence_refs: shareholdersWithoutIdentifier.flatMap(s => s.evidence_refs),
      metrics: {
        count: shareholdersWithoutIdentifier.length,
        names: shareholdersWithoutIdentifier.map(s => s.name).filter(n => n !== null)
      }
    });
  }

  // 주주 명칭 수와 식별번호 수 비교
  const uniqueNames = new Set(shareholders.map(s => s.name).filter(n => n !== null));
  const uniqueIdentifiers = new Set(shareholders.map(s => s.identifier).filter(i => i !== null));

  if (uniqueNames.size !== uniqueIdentifiers.size && total_records > 0) {
    triggers.push({
      rule_id: 'E-ID-003',
      severity: 'BLOCKER',
      message: `주주 수(${uniqueNames.size}명)와 식별번호 수(${uniqueIdentifiers.size}개) 불일치`,
      suggestion: 'MANUAL_CORRECTION',
      metrics: { names_count: uniqueNames.size, identifiers_count: uniqueIdentifiers.size }
    });
  }

  // ============================================
  // E-ID-004: 식별자 자릿수/형식 엄격 검증
  // ============================================
  shareholders.forEach(s => {
    if (!s.identifier || !s.identifier_type) return;

    const id = s.identifier.replace(/[-\s]/g, ''); // 하이픈 제거 후 순수 숫자만 계산
    let isValidLength = true;
    let expectedLength = 0;

    switch (s.identifier_type) {
      case 'BUSINESS_REG':
        expectedLength = 10;
        isValidLength = id.length === 10;
        break;
      case 'CORPORATE_REG':
      case 'RESIDENT_ID':
        expectedLength = 13;
        isValidLength = id.length === 13;
        break;
      case 'BIRTH_DATE':
        // 생년월일은 YYYY-MM-DD 형식이므로 하이픈 포함 10자여야 함
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        isValidLength = datePattern.test(s.identifier);
        expectedLength = 10;
        break;
    }

    if (!isValidLength) {
      triggers.push({
        rule_id: 'E-ID-004',
        severity: 'BLOCKER',
        message: `${s.name}의 식별자(${s.identifier_type}) 자릿수 오류: 현재 ${id.length}자리, 기대치 ${expectedLength}자리. (임의 추론 금지 원칙)`,
        suggestion: 'MANUAL_CORRECTION',
        evidence_refs: s.evidence_refs,
        metrics: { name: s.name, type: s.identifier_type, actual: id.length, expected: expectedLength }
      });
    }
  });

  // ============================================
  // E-CONF-001: 낮은 신뢰도 레코드
  // ============================================
  const lowConfidenceRecords = shareholders.filter(s => s.confidence < 0.5);
  if (lowConfidenceRecords.length > total_records * 0.3) {
    triggers.push({
      rule_id: 'E-CONF-001',
      severity: 'WARNING',
      message: `낮은 신뢰도(< 50%) 레코드 ${lowConfidenceRecords.length}건 (${((lowConfidenceRecords.length / total_records) * 100).toFixed(0)}%)`,
      metrics: { count: lowConfidenceRecords.length, ratio: lowConfidenceRecords.length / total_records }
    });
  }

  // ============================================
  // 최종 상태 결정
  // ============================================
  const hasBlocker = triggers.some(t => t.severity === 'BLOCKER');
  const status: ValidationReport['status'] = hasBlocker ? 'NEED_HITL' : 'PASS';

  // Calculate Data Quality Score (0-100)
  const identifierCoverage = total_records > 0
    ? shareholders.filter(s => s.identifier !== null).length / total_records
    : 0;
  const ratioCompleteness = ratioCoverage;
  const noBlockers = hasBlocker ? 0 : 1;
  const dataQualityScore = Math.round((identifierCoverage * 40 + ratioCompleteness * 40 + noBlockers * 20));

  const summary_metrics: SummaryMetrics = {
    total_records,
    null_shares_count,
    null_ratio_count,
    null_amount_count,
    sum_shares,
    sum_ratio,
    sum_amount,
    has_reference_total,
    individual_count,
    corporate_count,
    unknown_entity_count
  };

  // Enhanced validation report with data quality
  return {
    status,
    triggers,
    summary_metrics,
    data_quality_score: dataQualityScore,
    structural_failures: triggers.filter(t => t.severity === 'BLOCKER').map(t => t.rule_id)
  };
}

/**
 * HITL 필요 여부 판단 및 reason_code 추출
 */
export function extractHITLReasonCodes(triggers: RuleTrigger[]): string[] {
  const reasonCodes: string[] = [];

  for (const trigger of triggers) {
    if (trigger.severity !== 'BLOCKER') continue;

    switch (trigger.rule_id) {
      case 'E-MIN-001':
      case 'E-ZERO-001':
      case 'E-ZERO-002':
        reasonCodes.push('MISSING_REQUIRED_FIELD_OR_PARSE_FAILURE');
        break;
      case 'E-SUM-001':
        reasonCodes.push('TOTAL_SHARES_MISMATCH');
        break;
      case 'E-SUM-002':
        reasonCodes.push('AMOUNT_INCONSISTENCY');
        break;
      case 'E-RAT-001':
      case 'E-CON-001':
        reasonCodes.push('RATIO_INCONSISTENCY');
        break;
      case 'E-NAME-001':
        reasonCodes.push('NAME_CORRECTION_DETECTED');
        break;
      case 'E-ID-002':
      case 'E-ID-003':
        reasonCodes.push('IDENTIFIER_MISMATCH_OR_MISSING');
        break;
      case 'E-DUP-002':
        reasonCodes.push('DUPLICATE_RECORD');
        break;
      case 'E-META-001':
      case 'E-META-002':
        reasonCodes.push('METADATA_MISSING');
        break;
      case 'E-META-003':
        reasonCodes.push('STALE_DOCUMENT');
        break;
      case 'E-META-004':
        reasonCodes.push('METADATA_MISSING'); // Format issue is treated as missing full info
        break;
      case 'E-ID-004':
        reasonCodes.push('IDENTIFIER_MISMATCH_OR_MISSING');
        break;
    }
  }

  return [...new Set(reasonCodes)];
}

/**
 * suggestion으로부터 required_action 결정
 */
export function determineRequiredAction(triggers: RuleTrigger[]): string {
  const blockers = triggers.filter(t => t.severity === 'BLOCKER');

  if (blockers.length === 0) {
    return 'MANUAL_CORRECTION';
  }

  // suggestion이 있는 첫 번째 BLOCKER의 suggestion 사용
  const withSuggestion = blockers.find(t => t.suggestion);
  if (withSuggestion?.suggestion) {
    return withSuggestion.suggestion;
  }

  return 'MANUAL_CORRECTION';
}

/**
 * 지분율 계산 가능 여부 판단
 */
export function canCalculateRatio(doc: NormalizedDoc): {
  canCalculate: boolean;
  method: 'DIRECT_RATIO' | 'SHARES_DIVIDED_BY_TOTAL' | 'AMOUNT_DIVIDED_BY_TOTAL' | null;
  totalReference: number | null;
} {
  const { shareholders, document_properties } = doc;

  // 1. 직접 ratio가 있는지 확인
  const ratioCount = shareholders.filter((s: any) => s.ratio !== null).length;
  if (ratioCount >= shareholders.length * 0.5) {
    return {
      canCalculate: true,
      method: 'DIRECT_RATIO',
      totalReference: null
    };
  }

  // 2. 주식수 + 총발행주식수로 계산 가능한지
  const sharesCount = shareholders.filter((s: any) => s.shares !== null).length;
  const totalShares = document_properties?.total_shares_issued;
  if (sharesCount >= shareholders.length * 0.5 && totalShares && totalShares > 0) {
    return {
      canCalculate: true,
      method: 'SHARES_DIVIDED_BY_TOTAL',
      totalReference: totalShares
    };
  }

  // 3. 금액 + 자본금으로 계산 가능한지
  const amountCount = shareholders.filter((s: any) => s.amount !== null).length;
  const totalCapital = document_properties?.total_capital;
  if (amountCount >= shareholders.length * 0.5 && totalCapital && totalCapital > 0) {
    return {
      canCalculate: true,
      method: 'AMOUNT_DIVIDED_BY_TOTAL',
      totalReference: totalCapital
    };
  }

  return {
    canCalculate: false,
    method: null,
    totalReference: null
  };
}
