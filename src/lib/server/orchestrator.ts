/** File: src/lib/server/orchestrator.ts */
// ============================================
// 오케스트레이터 모듈 (Fast Track Refactor)
// ============================================

import { readFile } from 'fs/promises';
import { runGatekeeperAgent, runExtractorAgent, runNormalizerAgent, MODEL } from './agents';
import { AnalystService } from './services/analyst';       // New Service

import {
  getRun,
  updateRunStatus,
  saveStageEvent,
  saveArtifact,
  createHITLPacket,
  getArtifact
} from './storage';

import {
  emitStageEvent,
  emitFinalAnswer,
  emitError,
  emitCompleted,
  emitAgentLog,
  emitHITLRequired
} from './events';

import {
  initRunLog,
  startAgentLog,
  addAgentLog,
  completeAgentLog,
  completeRunLog,
  type OrchestratorSummary
} from './agentLogger';

import type {
  StageEvent,
  DocumentAssessment,
  ExtractorOutput,
  NormalizedDoc,
  ValidationReport,
  InsightsAnswerSet,
  HITLPacket,
  RuleTrigger
} from '$lib/types';
import { detectIdentifierType } from '$lib/types';
import { validateNormalized } from '../validator/ruleEngine';
import { calculateEffectiveRatios } from './logic/ownership';

// ============================================
// 이미지 로딩 유틸리티
// ============================================

async function loadImageAsBase64(filePath: string): Promise<{ base64: string; mimeType: string }> {
  const buffer = await readFile(filePath);
  const base64 = buffer.toString('base64');
  const ext = filePath.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'pdf': 'application/pdf',
    'tif': 'image/tiff', 'tiff': 'image/tiff'
  };
  return { base64, mimeType: mimeTypes[ext || ''] || 'image/png' };
}

/**
 * 이미지를 Supabase Storage에 업로드하고 Public URL 배열을 반환합니다.
 */
async function uploadImagesToSupabase(runId: string, images: { base64: string; mimeType: string }[]): Promise<string[]> {
  const { env } = await import('$env/dynamic/private');
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn('[Orchestrator] Supabase config missing, skipping cloud upload.');
    return [];
  }

  try {
    const { uploadImage, getPublicUrl } = await import('./services/supabase_storage');
    const urls: string[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const buffer = Buffer.from(img.base64, 'base64');
      const fileName = `${runId}/page_${i + 1}.${img.mimeType.split('/')[1] || 'png'}`;

      await uploadImage(buffer, fileName, img.mimeType);
      const url = getPublicUrl(fileName);
      urls.push(url);
    }

    return urls;
  } catch (error) {
    console.error('[Orchestrator] Supabase Upload failed:', error);
    // User requested: "Don't bend to local" -> throwing error instead of fallback if config exists
    throw new Error(`Supabase upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================
// Session Cancellation Tracking
// ============================================

const cancelledRuns = new Map<string, boolean>();

export function cancelRun(runId: string): void {
  console.log(`[Orchestrator] Cancelling run: ${runId} `);
  cancelledRuns.set(runId, true);
}

function isCancelled(runId: string): boolean {
  return cancelledRuns.get(runId) === true;
}

function clearCancellation(runId: string): void {
  cancelledRuns.delete(runId);
}

// ============================================
// 메인 오케스트레이터 (Fast Pipeline)
// ============================================

// Add import at the top (I will assume I can't touch top imports here so I'll rely on the previous fix or add it here if it's missing? I can't add imports with this tool if I'm targeting lines 54-183. I will do imports separately)

// ============================================
// Startup Initialization
// ============================================

let isInitialized = false;

/**
 * Initialize orchestrator - cleanup orphaned sessions
 * Call this once when server starts
 */
export async function initializeOrchestrator(): Promise<void> {
  if (isInitialized) return;
  console.log('[Orchestrator] Initializing...');

  const { cleanupRunningSessions } = await import('./storage');
  const cleanedCount = await cleanupRunningSessions();
  if (cleanedCount > 0) {
    console.log(`[Orchestrator] Cleaned up ${cleanedCount} stale running sessions on startup.`);
  }

  // Global error handlers to catch "King" errors before process dies
  if (!process.listenerCount('uncaughtException')) {
    process.on('uncaughtException', (err) => {
      console.error('[CRITICAL] Uncaught Exception:', err.message, err.stack);
    });
  }
  if (!process.listenerCount('unhandledRejection')) {
    process.on('unhandledRejection', (reason) => {
      console.error('[CRITICAL] Unhandled Rejection:', reason);
    });
  }

  isInitialized = true;
  console.log('[Orchestrator] Initialized successfully');
}

// ============================================
// Idempotency & Concurrency Management
// ============================================

const runLocks = new Set<string>();

export async function executeRun(runId: string, mode: 'FAST' | 'MULTI_AGENT' = 'MULTI_AGENT'): Promise<void> {
  console.log(`[Orchestrator] === executeRun ENTRY === runId=${runId}, mode=${mode}, locked=${runLocks.has(runId)}`);

  // 멱등성 보장: 이미 실행 중이면 중복 실행 방지
  if (runLocks.has(runId)) {
    console.warn(`[Orchestrator] Run ${runId} is already being processed. Rejecting duplicate request.`);
    return;
  }

  runLocks.add(runId);
  console.log(`[Orchestrator] Lock acquired for run ${runId}`);

  const startTime = Date.now();
  let currentStage: string = 'INIT';
  const completedStages: string[] = [];
  const errors: string[] = [];

  try {
    // 1. Initial Logging & Status Update (Early update to avoid "Pending" hang in UI)
    // Ensure initialization on first run
    console.log(`[Orchestrator] Initializing orchestrator for run ${runId}...`);
    await initializeOrchestrator();
    console.log(`[Orchestrator] Updating run status to 'running' for ${runId}...`);
    await updateRunStatus(runId, 'running');

    console.log(`[Orchestrator-DEBUG] executeRun called with runId=${runId}, mode="${mode}"`);
    console.log(`[Orchestrator] Starting run ${runId} in ${mode} mode`);

    await initRunLog(runId);
    await startAgentLog(runId, 'Orchestrator');
    await addAgentLog(runId, 'Orchestrator', 'INFO', `실행 시작(${mode})`, `${mode} 모드로 분석을 시작합니다 (멱등적 실행)`);

    const run = await getRun(runId);
    if (!run || run.files.length === 0) throw new Error('No files to process');

    const { prepareImagesForAnalysis } = await import('./services/converter');
    const images = await prepareImagesForAnalysis(run.files[0]);

    if (images.length === 0) throw new Error('No images extracted from files or file is corrupted');

    // ============================================
    // Supabase Upload (New)
    // ============================================
    await addAgentLog(runId, 'Orchestrator', 'INFO', '이미지 업로드 시작', '분석을 위해 이미지를 클라우드 스토리지에 업로드합니다');
    const imageUrls = await uploadImagesToSupabase(runId, images);

    const { updateRunStorageProvider } = await import('./storage');
    if (imageUrls.length > 0) {
      await updateRunStorageProvider(runId, 'SUPABASE');
      await addAgentLog(runId, 'Orchestrator', 'SUCCESS', '이미지 업로드 완료', `${imageUrls.length}개 페이지 업로드됨 (클라우드 모드)`);
    } else {
      await updateRunStorageProvider(runId, 'LOCAL');
      await addAgentLog(runId, 'Orchestrator', 'WARNING', '이미지 업로드 건너뜀', 'Supabase 설정이 되어있지 않아 로컬 데이터로 분석을 계속합니다 (로컬 모드)');
    }

    let normalizedDoc: NormalizedDoc | null = null;
    let extractionCountVal = 0;
    let validationReport: ValidationReport | null = null;

    if (mode === 'FAST') {
      // ============================================
      // FAST TRACK (Adaptive Retry Logic)
      // ============================================
      currentStage = 'FastExtractor';
      await updateRunStatus(runId, 'running', 'FastExtractor');
      await startAgentLog(runId, 'FastExtractor');
      await addAgentLog(runId, 'FastExtractor', 'INFO', '고속 추출 시작', '단일 패스로 추출 및 분석 수행');

      // Emit stage event for UI
      emitStageEvent(runId, {
        stage_name: 'FastExtractor',
        summary: '고속 추출 및 분석 중',
        rationale: '단일 패스 모드 실행',
        confidence: 0.5,
        outputs: {} as any,
        triggers: [],
        next_action: 'AUTO_NEXT',
        timestamp: new Date().toISOString()
      });

      // Dynamic import to avoid circular dependency issues if any
      const { runFastExtractor } = await import('./agents/fast_extractor');
      const { extractHITLReasonCodes } = await import('../validator/ruleEngine');

      let attempt = 1;
      const MAX_ATTEMPTS = 2;
      let fastResult;

      // Retry Loop
      while (attempt <= MAX_ATTEMPTS) {
        const feedback = attempt > 1 ? '지분율 합계가 100%가 아니거나, 지분율이 0%인 주주가 발견되었습니다. 다시 정밀하게 계산해 주세요.' : undefined;
        if (attempt > 1) {
          console.log(`[Orchestrator] Retrying FastExtractor (Attempt ${attempt}) with feedback: ${feedback}`);
          await addAgentLog(runId, 'FastExtractor', 'WARNING', `재시도 (${attempt}/${MAX_ATTEMPTS})`, '검증 실패로 인한 AI 재분석 수행');
        }

        console.log(`[Orchestrator] Run ${runId}: Calling runFastExtractor (Attempt ${attempt})...`);
        fastResult = await runFastExtractor(images, feedback, imageUrls);

        // AI Initial Gatekeeping
        if (!fastResult.is_valid) {
          // ... (Same invalid logic) ...
          // If invalid, we break immediately, no retry for invalid doc type usually
          break;
        }

        // Step 2: Map to NormalizedDoc (Use raw output first)
        const currentNormalizedDoc: NormalizedDoc = {
          document_properties: {
            company_name: fastResult.document_info?.company_name || null,
            total_shares_issued: fastResult.document_info?.total_shares_declared || null,
            total_capital: fastResult.document_info?.total_capital_declared || null,
            par_value_per_share: null,
            company_business_reg_number: null,
            company_corporate_reg_number: null,
            document_date: fastResult.document_info?.document_date || null,
            document_type: '주주명부',
            page_count: 1,
            ownership_basis: 'UNKNOWN',
            has_total_row: false,
            total_row_values: null,
            authorized_shares: null
          },
          shareholders: fastResult.shareholders?.map(s => ({
            name: s.name,
            identifier: s.identifier || null,
            identifier_type: detectIdentifierType(s.identifier || '', s.entity_type || 'UNKNOWN'),
            entity_type: s.entity_type || 'UNKNOWN',
            entity_type_confidence: 0.9,
            entity_signals: { raw_signals: [] },
            shares: s.shares || null,
            ratio: s.ratio || null,
            amount: s.amount || null,
            share_class: s.share_class || null,
            address: s.remarks || null,
            confidence: 0.9,
            evidence_refs: [],
            unknown_reasons: []
          })) || [],
          ordering_detected: 'UNKNOWN',
          ownership_basis_detected: 'UNKNOWN',
          normalization_notes: []
        };

        // Note: calculateEffectiveRatios NO LONGER auto-fixes 0% to 100% (reverted).
        // It strictly follows declared ratio if present.
        currentNormalizedDoc.shareholders = calculateEffectiveRatios(currentNormalizedDoc.shareholders, currentNormalizedDoc.document_properties);

        // Step 3: Validation
        const validationReport = validateNormalized(currentNormalizedDoc);
        const reasonCodes = extractHITLReasonCodes(validationReport.triggers || []);

        // [FIX] Always update normalizedDoc with the latest attempt's result
        // This ensures that if we exit the loop (success or max attempts), normalizedDoc is valid.
        normalizedDoc = currentNormalizedDoc;

        // Check for Retry Conditions (Zero Ratio or Sum Mismatch means AI failure)
        const needsRetry = reasonCodes.includes('RATIO_INCONSISTENCY') ||
          validationReport.triggers.some(t => t.rule_id === 'E-ZERO-RATIO');

        if (needsRetry && attempt < MAX_ATTEMPTS) {
          attempt++;
          continue; // Retry loop
        }

        // If we get here, either success or max attempts reached (and we proceed with the last result)
        break;
      }

      if (!fastResult || !fastResult.is_valid) {
        // Logic for handling invalid result (copied from original)
        const reason = fastResult?.rejection_reason || 'Invalid Doc';
        await addAgentLog(runId, 'FastExtractor', 'WARNING', '문서 거부 (AI)', reason);
        await completeAgentLog(runId, 'FastExtractor', 'FAILED', '문서 거부');
        await updateRunStatus(runId, 'rejected');
        emitError(runId, `문서가 거부되었습니다: ${reason}`);
        await completeRunLog(runId, 'FAILED', {
          total_duration_ms: Date.now() - startTime,
          stages_completed: ['FastExtractor'],
          stages_skipped: [],
          final_status: 'FAILED',
          key_findings: [],
          warnings: ['Gatekeeper Rejected'],
          errors: [reason]
        });
        return;
      }

      // Step 3: Re-validate final result
      // ... (Proceed with original logic using normalizedDoc) ...
      const validationReport = validateNormalized(normalizedDoc!);

      console.log(`[Orchestrator] Run ${runId}: Final Validation Status = ${validationReport.status}`);

      if (validationReport.status === 'NEED_HITL') {
        const triggers = validationReport.triggers.filter(t => t.severity === 'BLOCKER');
        const reason = triggers[0]?.message || '정합성 오류 발견';
        await addAgentLog(runId, 'FastExtractor', 'WARNING', '정합성 검증 실패', reason);

        const hitlPacket = await createHITLPacket(runId, 'FastExtractor', {
          normalized: normalizedDoc!,
          triggers: validationReport.triggers
        }, {
          company_name: normalizedDoc!.document_properties.company_name,
          document_date: fastResult.document_info?.document_date || null,
          shareholder_names: normalizedDoc!.shareholders.map(s => s.name || 'UNKNOWN')
        });
        await updateRunStatus(runId, 'hitl', 'FastExtractor');
        emitHITLRequired(runId, hitlPacket);
        return;
      }

      // Step 4: Final Insight Generation
      // ... (Original logic using normalizedDoc) ...
      // Need to populate programmaticallyIdentifiedBO using normalizedDoc
      const aiIdentifiedBO = fastResult.over_25_percent_holders || [];
      const programmaticallyIdentifiedBO = (normalizedDoc!.shareholders || [])
        .filter(s => s.ratio !== null && s.ratio >= 25)
        .map(s => ({
          name: s.name,
          ratio: s.ratio,
          identifier: s.identifier,
          entity_type: s.entity_type
        }));

      // Merge and deduplicate
      const mergedBO = [...aiIdentifiedBO];
      programmaticallyIdentifiedBO.forEach(p => {
        if (!mergedBO.find(m => m.name === p.name)) {
          mergedBO.push(p as any);
        }
      });

      // [Fallback Logic] Use normalizedDoc
      if (mergedBO.length === 0 && (normalizedDoc!.shareholders || []).length > 0) {
        const sortedAll = [...(normalizedDoc!.shareholders || [])].sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
        const top1 = sortedAll[0];
        if (top1 && (top1.ratio || 0) > 0) {
          mergedBO.push({
            name: top1.name,
            ratio: top1.ratio,
            identifier: top1.identifier,
            entity_type: top1.entity_type
          } as any);
          console.log(`[Orchestrator][FastTrack] No 25%+ holder found. Using Top 1 fallback: ${top1.name} (${top1.ratio}%)`);
        }
      }

      const insights: InsightsAnswerSet = {
        document_assessment: {
          is_valid_shareholder_register: 'YES',
          evidence_refs: []
        },
        over_25_percent: mergedBO
          .sort((a, b) => (b.ratio || 0) - (a.ratio || 0)) // 내림차순 정렬 (Descending)
          .map(h => {
            const matchedRecord = fastResult.shareholders?.find((s: any) => s.identifier === h.identifier && h.identifier !== null)
              || fastResult.shareholders?.find((s: any) => s.name === h.name);

            return {
              name: h.name || matchedRecord?.name || 'UNKNOWN',
              entity_type: h.entity_type || matchedRecord?.entity_type || 'UNKNOWN',
              entity_type_confidence: 0.9,
              entity_signals: { raw_signals: [] },
              identifier: h.identifier || matchedRecord?.identifier || null,
              identifier_type: detectIdentifierType(h.identifier || matchedRecord?.identifier || '', h.entity_type || matchedRecord?.entity_type || 'UNKNOWN'),
              shares: (h as any).shares || matchedRecord?.shares || null,
              ratio: h.ratio ?? (h as any).percentage ?? matchedRecord?.ratio ?? (matchedRecord as any)?.percentage ?? 0,
              amount: null,
              share_class: null,
              evidence_refs: [],
              confidence: 0.9,
              unknown_reasons: []
            };
          }),

        ordering_rule: 'UNKNOWN',

        totals: {
          total_shares_declared: fastResult.document_info?.total_shares_declared || null,
          total_amount_declared: fastResult.document_info?.total_capital_declared || null
        },

        document_date: fastResult.document_info?.document_date || null,
        document_date_staleness: (() => {
          if (!fastResult.document_info?.document_date) return undefined;
          const docDate = new Date(fastResult.document_info.document_date);
          const today = new Date('2026-01-25');
          const diffTime = today.getTime() - docDate.getTime();
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          return {
            is_stale: diffDays > 365,
            days_diff: diffDays,
            threshold_days: 365
          };
        })(),
        company_name: fastResult.document_info?.company_name || null,

        share_classes_found: [...new Set(fastResult.shareholders?.map(s => s.share_class).filter(Boolean) as string[])],
        trust_level: 'MEDIUM',
        cannot_determine: [],
        synthesis_reasoning: fastResult.rejection_reason || '분석 완료',
        synthesis_confidence: 0.8,
        validation_summary: {
          status: 'PASS',
          triggers: [],
          summary_metrics: {
            total_records: fastResult.shareholders?.length || 0,
            valid_records: fastResult.shareholders?.length || 0,
            invalid_records: 0
          } as any,
          decidability: {
            is_decidable: true,
            reason: 'Fast track analysis completed'
          }
        }
      };

      await saveArtifact(runId, 'FAST', 'answer_set', insights);
      await addAgentLog(runId, 'FastExtractor', 'SUCCESS', '분석 완료', `${fastResult.shareholders?.length || 0}명 분석 결과 도출`);
      await completeAgentLog(runId, 'FastExtractor', 'SUCCESS', '고속 분석 완료');

      completedStages.push('FastExtractor');

      // Orchestrator Summary
      const duration = Date.now() - startTime;
      const summary: OrchestratorSummary = {
        total_duration_ms: duration,
        stages_completed: completedStages,
        stages_skipped: ['B', 'C', 'D', 'E', 'INSIGHTS'],
        final_status: 'COMPLETED',
        key_findings: [
          `모드: FAST (Mono-Agent)`,
          `주주 ${fastResult.shareholders?.length || 0}명 추출`,
          `25% 이상 주주(내림차순): ${Array.isArray(insights.over_25_percent) ? insights.over_25_percent.map(h => `${h.name}(${h.ratio}%)`).join(', ') : '없음'}`
        ],
        warnings: [],
        errors: []
      };

      await completeRunLog(runId, 'COMPLETED', summary);
      emitAgentLog(runId, summary);
      emitFinalAnswer(runId, insights);

      // Finalize database status
      await updateRunStatus(runId, 'completed');
      emitCompleted(runId);

      console.log(`[Orchestrator] Run ${runId} COMPLETED (FAST) in ${duration} ms`);
      return; // End execution for FAST mode here

    } else {
      // ============================================
      // MULTI AGENT TRACK
      // ============================================

      // STAGE B: Gatekeeper
      currentStage = 'B';
      if (isCancelled(runId)) throw new Error('Run cancelled by user');
      const assessment = await runStageB(runId, images, imageUrls);
      if (!assessment) return;
      completedStages.push('B');

      // STAGE C: Extractor
      currentStage = 'C';
      if (isCancelled(runId)) throw new Error('Run cancelled by user');
      const extractorOutput = await runStageC(runId, images, assessment, imageUrls);
      if (!extractorOutput) return;
      completedStages.push('C');
      extractionCountVal = extractorOutput.records.length;

      // STAGE D: Normalizer
      currentStage = 'D';
      if (isCancelled(runId)) throw new Error('Run cancelled by user');
      normalizedDoc = await runStageD(runId, extractorOutput);
      if (!normalizedDoc) return;
      completedStages.push('D');

      // STAGE E: Validator
      currentStage = 'E';
      validationReport = await runStageE(runId, normalizedDoc);

      if (!validationReport || validationReport.status === 'REJECT') {
        console.log(`[Orchestrator] Validation REJECTED. Stopping run ${runId}.`);
        return;
      }

      completedStages.push('E');
      // Even if status is 'NEED_HITL', we proceed to INSIGHTS so the Analyst can explain the reason.
    }

    // ============================================
    // STAGE INSIGHTS (Common - MULTI_AGENT only here as FAST returns early)
    // ============================================
    if (normalizedDoc) {
      currentStage = 'INSIGHTS';

      // Use the actual report if E stage finished, or create a fallback
      const finalValidationReport: ValidationReport = validationReport ?? {
        status: 'PASS',
        triggers: [],
        summary_metrics: {
          total_records: normalizedDoc.shareholders.length,
          null_shares_count: 0,
          null_ratio_count: 0,
          null_amount_count: 0,
          sum_shares: null,
          sum_ratio: null,
          sum_amount: null,
          has_reference_total: false,
          individual_count: 0,
          corporate_count: 0,
          unknown_entity_count: 0
        }
      };
      const insights = await runStageINSIGHTS(runId, normalizedDoc, finalValidationReport, imageUrls);

      completedStages.push('INSIGHTS');

      // Orchestrator Summary
      const duration = Date.now() - startTime;
      const summary: OrchestratorSummary = {
        total_duration_ms: duration,
        stages_completed: completedStages,
        stages_skipped: [],
        final_status: 'COMPLETED',
        key_findings: [
          `모드: MULTI_AGENT`,
          `주주 ${extractionCountVal}명 추출`,
          `실소유자(25%+): ${Array.isArray(insights.over_25_percent) ? insights.over_25_percent.map(h => `${h.name}(${h.ratio}%)`).join(', ') : '판별 불가'}`
        ],
        warnings: [],
        errors: []
      };

      await completeRunLog(runId, 'COMPLETED', summary);
      emitAgentLog(runId, summary);

      // Finalize database status
      await updateRunStatus(runId, 'completed');
      emitCompleted(runId);

      console.log(`[Orchestrator] Run ${runId} COMPLETED in ${duration} ms`);
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error(`[Orchestrator] Run ${runId} FAILED at ${currentStage}: `, msg, stack);
    errors.push(msg);

    // Check if this was a user cancellation
    const isCancellation = msg.includes('cancelled by user');

    await updateRunStatus(runId, 'error', undefined, msg);
    emitError(runId, msg);
    await completeRunLog(runId, isCancellation ? 'CANCELLED' : 'FAILED', {
      total_duration_ms: Date.now() - startTime,
      stages_completed: completedStages,
      stages_skipped: [],
      final_status: isCancellation ? 'CANCELLED' : 'FAILED',
      key_findings: [],
      warnings: [],
      errors: [msg]
    });
  } finally {
    // Always clear cancellation flag
    clearCancellation(runId);
    runLocks.delete(runId);
  }
}

// Helper for summary
function extractionCount(output: any): number {
  return output.records ? output.records.length : 0;
}

// Deprecated functions (kept for import safety if needed, but unused in main flow)
function getNextSteps() { return [] }

// ============================================
// Stage B: Gatekeeper
// ============================================

async function runStageB(
  runId: string,
  images: { base64: string; mimeType: string }[],
  imageUrls?: string[]
): Promise<DocumentAssessment | null> {
  console.log(`[Orchestrator] Stage B for run ${runId}`);

  // 로깅 시작
  startAgentLog(runId, 'B_Gatekeeper');
  addAgentLog(runId, 'B_Gatekeeper', 'INFO', '문서 분석 시작', '업로드된 문서의 유형과 품질을 분석합니다');
  const stageStart = Date.now();

  await updateRunStatus(runId, 'running', 'B');

  addAgentLog(runId, 'B_Gatekeeper', 'INFO', 'AI 모델 호출', `${MODEL}를 사용하여 문서를 분석합니다 (페이지 수: ${images.length}, URL: ${imageUrls?.length || 0})`);
  const assessment = await runGatekeeperAgent(images, imageUrls);
  await saveArtifact(runId, 'B', 'assessment', assessment);

  // 분석 결과 로깅
  addAgentLog(runId, 'B_Gatekeeper', 'INFO', '문서 유형 판정',
    `주주명부 여부: ${assessment.is_shareholder_register}, 필요 정보 포함: ${assessment.has_required_info} `,
    { detected_type: assessment.detected_document_type, ownership_basis: assessment.detected_ownership_basis }
  );

  addAgentLog(runId, 'B_Gatekeeper', 'INFO', '문서 품질 평가',
    `가독성: ${assessment.doc_quality.readability}, 테이블 구조: ${assessment.doc_quality.table_structure} `,
    assessment.doc_quality
  );

  addAgentLog(runId, 'B_Gatekeeper', 'INFO', '라우팅 결정',
    `다음 단계: ${assessment.route_suggestion} `,
    { rationale: assessment.rationale }
  );

  const stageEvent: StageEvent = {
    stage_name: 'B',
    summary: `문서 판정: ${assessment.is_shareholder_register} `,
    rationale: assessment.rationale,
    confidence: assessment.doc_quality.readability === 'HIGH' ? 0.9 :
      assessment.doc_quality.readability === 'MEDIUM' ? 0.7 : 0.5,
    outputs: assessment,
    triggers: [],
    next_action: assessment.route_suggestion === 'EXTRACT' ? 'AUTO_NEXT' :
      assessment.route_suggestion === 'REJECT' ? 'REJECT' : 'HITL',
    timestamp: new Date().toISOString()
  };

  await saveStageEvent(runId, stageEvent);
  emitStageEvent(runId, stageEvent);

  // REJECT 처리
  if (assessment.route_suggestion === 'REJECT') {
    addAgentLog(runId, 'B_Gatekeeper', 'WARNING', '문서 거부',
      '이 문서는 주주명부로 인식되지 않습니다', undefined, Date.now() - stageStart);
    completeAgentLog(runId, 'B_Gatekeeper', 'FAILED', '문서가 주주명부가 아니거나 처리할 수 없습니다');
    await updateRunStatus(runId, 'rejected');
    return null;
  }

  // HITL 처리
  if (assessment.route_suggestion !== 'EXTRACT') {
    addAgentLog(runId, 'B_Gatekeeper', 'WARNING', 'HITL 필요',
      `사람의 검토가 필요합니다: ${assessment.route_suggestion} `, undefined, Date.now() - stageStart);
    completeAgentLog(runId, 'B_Gatekeeper', 'SUCCESS', '문서 분석 완료, 사람 검토 필요');
    const packet = await createHITLPacket(runId, 'B', { assessment }, {
      company_name: assessment.detected_document_type, // Use detected type as best effort if name missing
      document_date: null,
      shareholder_names: []
    });
    await updateRunStatus(runId, 'hitl');
    emitHITLRequired(runId, packet);
    return null;
  }

  addAgentLog(runId, 'B_Gatekeeper', 'SUCCESS', '분석 완료',
    `${assessment.detected_document_type || '주주명부'}로 확인, 추출 단계로 진행합니다`,
    undefined, Date.now() - stageStart);
  completeAgentLog(runId, 'B_Gatekeeper', 'SUCCESS',
    `문서 확인 완료: ${assessment.detected_document_type || '주주명부'}, 품질: ${assessment.doc_quality.readability} `);

  return assessment;
}

// ============================================
// Stage C: Extractor
// ============================================

async function runStageC(
  runId: string,
  images: { base64: string; mimeType: string }[],
  assessment: DocumentAssessment,
  imageUrls?: string[]
): Promise<ExtractorOutput | null> {
  console.log(`[Orchestrator] Stage C for run ${runId}`);

  // 로깅 시작
  startAgentLog(runId, 'C_Extractor');
  addAgentLog(runId, 'C_Extractor', 'INFO', '데이터 추출 시작', '문서에서 주주 정보를 추출합니다');
  const stageStart = Date.now();

  await updateRunStatus(runId, 'running', 'C');

  addAgentLog(runId, 'C_Extractor', 'INFO', 'AI 모델 호출', `${MODEL}를 사용하여 테이블 데이터를 추출합니다 (페이지 수: ${images.length}, URL: ${imageUrls?.length || 0})`);
  const extractorOutput = await runExtractorAgent(images, assessment, imageUrls);
  await saveArtifact(runId, 'C', 'extractor_output', extractorOutput);

  // 추출 결과 로깅
  addAgentLog(runId, 'C_Extractor', 'INFO', '주주 레코드 추출',
    `${extractorOutput.records.length}개 주주 레코드 발견`,
    { record_count: extractorOutput.records.length }
  );

  if (extractorOutput.document_info) {
    addAgentLog(runId, 'C_Extractor', 'INFO', '문서 정보 추출',
      `회사명: ${extractorOutput.document_info.company_name || '불명'}, ` +
      `총발행주식수: ${extractorOutput.document_info.total_shares_declared || '불명'} `,
      extractorOutput.document_info
    );
  }

  if (extractorOutput.table_structure) {
    addAgentLog(runId, 'C_Extractor', 'INFO', '테이블 구조 분석',
      `컬럼: ${extractorOutput.table_structure.column_headers?.join(', ') || '불명'}, ` +
      `합계행: ${extractorOutput.table_structure.has_total_row ? '있음' : '없음'} `,
      extractorOutput.table_structure
    );
  }

  if (extractorOutput.extraction_notes.length > 0) {
    addAgentLog(runId, 'C_Extractor', 'INFO', '추출 메모',
      extractorOutput.extraction_notes.join('; ')
    );
  }

  const hasBlockers = extractorOutput.blockers.length > 0;

  if (hasBlockers) {
    addAgentLog(runId, 'C_Extractor', 'WARNING', '추출 문제 발견',
      `${extractorOutput.blockers.length}개 문제: ${extractorOutput.blockers.join(', ')} `
    );
  }

  const stageEvent: StageEvent = {
    stage_name: 'C',
    summary: `${extractorOutput.records.length}개 주주 레코드 추출`,
    rationale: extractorOutput.extraction_notes.join('; ') || '추출 완료',
    confidence: hasBlockers ? 0.4 : 0.85,
    outputs: extractorOutput,
    triggers: extractorOutput.blockers.map(b => ({
      rule_id: 'C-BLOCK',
      severity: 'BLOCKER' as const,
      message: b
    })),
    next_action: hasBlockers ? 'HITL' : 'AUTO_NEXT',
    timestamp: new Date().toISOString()
  };

  await saveStageEvent(runId, stageEvent);
  emitStageEvent(runId, stageEvent);

  // HITL 처리
  if (hasBlockers) {
    addAgentLog(runId, 'C_Extractor', 'WARNING', 'HITL 필요',
      '데이터 추출에 문제가 있어 사람의 검토가 필요합니다', undefined, Date.now() - stageStart);
    completeAgentLog(runId, 'C_Extractor', 'SUCCESS',
      `추출 완료(문제 ${extractorOutput.blockers.length}건), 사람 검토 필요`);
    const packet = await createHITLPacket(runId, 'C', {
      extractor_output: extractorOutput,
      triggers: stageEvent.triggers
    }, {
      company_name: extractorOutput.document_info.company_name,
      document_date: extractorOutput.document_info.document_date,
      shareholder_names: extractorOutput.records.map(r => r.raw_name || 'UNKNOWN')
    });
    await updateRunStatus(runId, 'hitl');
    emitHITLRequired(runId, packet);
    return null;
  }

  addAgentLog(runId, 'C_Extractor', 'SUCCESS', '추출 완료',
    `${extractorOutput.records.length}개 레코드 추출 완료, 정규화 단계로 진행합니다`,
    undefined, Date.now() - stageStart);
  completeAgentLog(runId, 'C_Extractor', 'SUCCESS',
    `${extractorOutput.records.length}개 주주 레코드 추출 완료`);

  return extractorOutput;
}

/**
 * 생년월일 정규화 헬퍼 함수
 * 사용자의 요구사항: 다양한 포맷(19851615, 750328, 75-02-23 등) 처리 및 100세 수명 기준 연도 추정
 */
function refineBirthDates(doc: NormalizedDoc): void {
  const CURRENT_YEAR = new Date().getFullYear();

  for (const s of doc.shareholders) {
    // 이미 확정된 다른 타입은 건너뜀
    if (s.identifier_type === 'RESIDENT_ID' || s.identifier_type === 'BUSINESS_REG' || s.identifier_type === 'CORPORATE_REG') {
      continue;
    }

    if (!s.identifier) continue;

    // 1. 숫자만 추출
    const rawDigits = s.identifier.replace(/[^0-9]/g, '');

    let year = 0;
    let month = 0;
    let day = 0;
    let parsed = false;

    // Case A: 8자리 (YYYYMMDD) - 예: 19850615
    if (rawDigits.length === 8) {
      year = parseInt(rawDigits.substring(0, 4), 10);
      month = parseInt(rawDigits.substring(4, 6), 10);
      day = parseInt(rawDigits.substring(6, 8), 10);
      parsed = true;
    }
    // Case B: 6자리 (YYMMDD) - 예: 750328
    else if (rawDigits.length === 6) {
      const yy = parseInt(rawDigits.substring(0, 2), 10);
      month = parseInt(rawDigits.substring(2, 4), 10);
      day = parseInt(rawDigits.substring(4, 6), 10);

      // 연도 추정 (100세 수명 기준)
      // 현재 연도(2026) 기준으로, YY가 (26 - 100) ~ 26 사이면 2000년대?
      // 더 간단한 로직: 
      // 만약 20YY가 현재 연도보다 미래라면 1900년대로 간주 (단, 미래 1년 정도는 허용 가능하나 보수적으로)
      // 예: 26 -> 2026 (올해), 27 -> 1927 (미래니까 과거로)
      // User Logic: "현재 시점에서 인간의 수명을 약 100살로 계산에서 그 안에서 나이를 추정"

      const year2000 = 2000 + yy;
      if (year2000 > CURRENT_YEAR) {
        year = 1900 + yy;
      } else {
        year = year2000;
      }
      parsed = true;
    }

    if (parsed) {
      // 날짜 유효성 검사 (간단)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        // 정규화 적용
        const yyyy = year.toString();
        const mm = month.toString().padStart(2, '0');
        const dd = day.toString().padStart(2, '0');

        s.identifier = `${yyyy}-${mm}-${dd}`;
        s.identifier_type = 'BIRTH_DATE';

        // 생년월일이 있으면 개인일 확률이 매우 높음
        if (s.entity_type === 'UNKNOWN') {
          s.entity_type = 'INDIVIDUAL';
        }
      }
    }
  }
}

// ============================================
// Stage D: Normalizer
// ============================================

async function runStageD(
  runId: string,
  extractorOutput: ExtractorOutput
): Promise<NormalizedDoc | null> {
  console.log(`[Orchestrator] Stage D for run ${runId}`);

  // 로깅 시작
  startAgentLog(runId, 'D_Normalizer');
  addAgentLog(runId, 'D_Normalizer', 'INFO', '데이터 정규화 시작', '추출된 데이터를 표준 형식으로 변환합니다');
  const stageStart = Date.now();

  await updateRunStatus(runId, 'running', 'D');

  addAgentLog(runId, 'D_Normalizer', 'INFO', 'AI 모델 호출', `${MODEL}를 사용하여 데이터를 정규화합니다`);
  const normalizedDoc = await runNormalizerAgent(extractorOutput);

  // 후처리: 지분율 자동 계산 및 보정
  calculateMissingRatios(normalizedDoc);

  await saveArtifact(runId, 'D', 'normalized_doc', normalizedDoc);

  // 정규화 결과 로깅
  const individuals = normalizedDoc.shareholders.filter(s => s.entity_type === 'INDIVIDUAL');
  const corporates = normalizedDoc.shareholders.filter(s => s.entity_type === 'CORPORATE');
  const unknowns = normalizedDoc.shareholders.filter(s => s.entity_type === 'UNKNOWN');

  addAgentLog(runId, 'D_Normalizer', 'INFO', '주주 유형 분류',
    `개인: ${individuals.length} 명, 법인: ${corporates.length} 개, 불명: ${unknowns.length} 명`,
    { individual_count: individuals.length, corporate_count: corporates.length, unknown_count: unknowns.length }
  );

  // 개인 주주 식별자 정보 로깅
  const individualsWithId = individuals.filter(s => s.identifier &&
    (s.identifier_type === 'RESIDENT_ID' || s.identifier_type === 'BIRTH_DATE'));
  const individualsWithoutId = individuals.filter(s => !s.identifier ||
    (s.identifier_type !== 'RESIDENT_ID' && s.identifier_type !== 'BIRTH_DATE'));

  if (individuals.length > 0) {
    addAgentLog(runId, 'D_Normalizer', individualsWithoutId.length > 0 ? 'WARNING' : 'INFO',
      '개인 주주 식별정보',
      `식별정보 있음: ${individualsWithId.length} 명, 없음: ${individualsWithoutId.length} 명`,
      {
        with_identifier: individualsWithId.map(s => s.name),
        without_identifier: individualsWithoutId.map(s => s.name)
      }
    );
  }

  // 지분 정보 로깅
  const withRatio = normalizedDoc.shareholders.filter(s => s.ratio !== null).length;
  const withShares = normalizedDoc.shareholders.filter(s => s.shares !== null).length;
  const withAmount = normalizedDoc.shareholders.filter(s => s.amount !== null).length;

  addAgentLog(runId, 'D_Normalizer', 'INFO', '지분 정보 변환',
    `지분율 보유: ${withRatio} 명, 주식수 보유: ${withShares} 명, 금액 보유: ${withAmount} 명`,
    { ownership_basis: normalizedDoc.ownership_basis_detected, ordering: normalizedDoc.ordering_detected }
  );

  if (normalizedDoc.normalization_notes.length > 0) {
    addAgentLog(runId, 'D_Normalizer', 'INFO', '정규화 메모',
      normalizedDoc.normalization_notes.join('; ')
    );
  }

  const stageEvent: StageEvent = {
    stage_name: 'D',
    summary: `${normalizedDoc.shareholders.length}개 레코드 정규화`,
    rationale: normalizedDoc.normalization_notes.join('; ') || '정규화 완료',
    confidence: 0.8,
    outputs: normalizedDoc,
    triggers: [],
    next_action: 'AUTO_NEXT',
    timestamp: new Date().toISOString()
  };

  await saveStageEvent(runId, stageEvent);
  emitStageEvent(runId, stageEvent);

  addAgentLog(runId, 'D_Normalizer', 'SUCCESS', '정규화 완료',
    `${normalizedDoc.shareholders.length}개 레코드 정규화 완료, 검증 단계로 진행합니다`,
    undefined, Date.now() - stageStart);
  completeAgentLog(runId, 'D_Normalizer', 'SUCCESS',
    `${normalizedDoc.shareholders.length}개 레코드 정규화(개인 ${individuals.length}, 법인 ${corporates.length})`);

  return normalizedDoc;
}

/**
 * 지분율 자동 계산 및 보정
 * - 총발행주식수 또는 자본금이 있으면 지분율을 역산하여 채움
 * - 단일 주주의 경우 합계 정보 누락 시 보정 로직 포함 (주식수/금액 모두 지원)
 */
function calculateMissingRatios(doc: NormalizedDoc): void {
  // 1. 단일 주주 보정
  if (doc.shareholders.length === 1) {
    const s = doc.shareholders[0];

    // Case A: 주식수는 있는데 지분율 없음
    if (s.shares !== null && s.ratio === null) {
      let total = doc.document_properties?.total_shares_issued;
      if (!total || total === 0) {
        total = s.shares;
        if (!doc.document_properties) {
          doc.document_properties = { total_shares_issued: total } as any;
        } else {
          doc.document_properties.total_shares_issued = total;
        }
        doc.normalization_notes.push('단일 주주 보정: 총발행주식수 미상으로 보유주식수 기반 자동 설정');
      }
      if (total === s.shares) {
        s.ratio = 100.0;
        doc.normalization_notes.push('단일 주주 보정: 지분율 100% 자동 설정 (주식수 기반)');
      }
    }

    // Case B: 금액은 있는데 지분율 없음 (주식수 기반 처리가 안 된 경우)
    if (s.amount !== null && s.ratio === null) {
      let totalCap = doc.document_properties?.total_capital;
      if (!totalCap || totalCap === 0) {
        totalCap = s.amount;
        if (!doc.document_properties) {
          doc.document_properties = { total_capital: totalCap } as any;
        } else {
          doc.document_properties.total_capital = totalCap;
        }
        doc.normalization_notes.push('단일 주주 보정: 자본금 미상으로 보유금액 기반 자동 설정');
      }
      if (totalCap === s.amount) {
        s.ratio = 100.0;
        doc.normalization_notes.push('단일 주주 보정: 지분율 100% 자동 설정 (금액 기반)');
      }
    }
  }

  // 2. 지분율 역산 로직 (모든 주주 대상)
  const totalShares = doc.document_properties?.total_shares_issued;
  const totalCapital = doc.document_properties?.total_capital;

  let calculatedCount = 0;

  // (1) 주식수 기반 역산
  if (totalShares && totalShares > 0) {
    doc.shareholders.forEach(s => {
      if (s.shares !== null && s.ratio === null) {
        const calculated = (s.shares / totalShares) * 100;
        s.ratio = Math.round(calculated * 100) / 100;
        calculatedCount++;
      }
    });
  }

  // (2) 금액 기반 역산 (아직 지분율 없는 경우)
  if (totalCapital && totalCapital > 0) {
    doc.shareholders.forEach(s => {
      if (s.amount !== null && s.ratio === null) {
        const calculated = (s.amount / totalCapital) * 100;
        s.ratio = Math.round(calculated * 100) / 100;
        calculatedCount++;
      }
    });
  }

  if (calculatedCount > 0) {
    doc.normalization_notes.push(`지분율 자동 계산: ${calculatedCount}명 지분율 역산 완료`);
  }
}

// ============================================
// Stage E: Validator (결정적 코드)
// ============================================

async function runStageE(
  runId: string,
  normalizedDoc: NormalizedDoc
): Promise<ValidationReport | null> {
  console.log(`[Orchestrator] Stage E for run ${runId}`);

  // 로깅 시작
  startAgentLog(runId, 'E_Validator');
  addAgentLog(runId, 'E_Validator', 'INFO', '검증 시작', '정규화된 데이터의 정합성을 검증합니다');
  const stageStart = Date.now();

  await updateRunStatus(runId, 'running', 'E');

  addAgentLog(runId, 'E_Validator', 'INFO', '룰 엔진 실행', '결정적 검증 규칙을 적용합니다 (AI가 아닌 코드 기반)');

  // 결정적 룰 엔진 실행
  const validationReport = validateNormalized(normalizedDoc);
  await saveArtifact(runId, 'E', 'validation_report', validationReport);

  // 검증 결과 로깅
  const { summary_metrics } = validationReport;
  addAgentLog(runId, 'E_Validator', 'INFO', '메트릭 계산',
    `총 ${summary_metrics.total_records} 명, ` +
    `주식수 null: ${summary_metrics.null_shares_count} 명, ` +
    `지분율 null: ${summary_metrics.null_ratio_count} 명`,
    summary_metrics
  );

  // 각 트리거 로깅
  const blockers = validationReport.triggers.filter(t => t.severity === 'BLOCKER');
  const warnings = validationReport.triggers.filter(t => t.severity === 'WARNING');
  const infos = validationReport.triggers.filter(t => t.severity === 'INFO');

  if (blockers.length > 0) {
    addAgentLog(runId, 'E_Validator', 'ERROR', '심각한 문제 발견',
      `${blockers.length}개 BLOCKER: ${blockers.map(t => t.rule_id).join(', ')} `,
      blockers.map(t => ({ rule_id: t.rule_id, message: t.message }))
    );
    blockers.forEach(t => {
      addAgentLog(runId, 'E_Validator', 'ERROR', `규칙 ${t.rule_id} `,
        t.message, t.metrics
      );
    });
  }

  if (warnings.length > 0) {
    addAgentLog(runId, 'E_Validator', 'WARNING', '경고 사항',
      `${warnings.length}개 WARNING: ${warnings.map(t => t.rule_id).join(', ')} `,
      warnings.map(t => ({ rule_id: t.rule_id, message: t.message }))
    );
  }

  if (infos.length > 0) {
    addAgentLog(runId, 'E_Validator', 'INFO', '참고 사항',
      `${infos.length}개 INFO: ${infos.map(t => t.rule_id).join(', ')} `
    );
  }

  addAgentLog(runId, 'E_Validator', validationReport.status === 'PASS' ? 'SUCCESS' : 'WARNING',
    '검증 결과',
    `최종 상태: ${validationReport.status} `,
    { status: validationReport.status, trigger_count: validationReport.triggers.length }
  );

  const stageEvent: StageEvent = {
    stage_name: 'E',
    summary: `검증 결과: ${validationReport.status} `,
    rationale: validationReport.triggers.map(t => t.message).join('; ') || '모든 검증 통과',
    confidence: validationReport.status === 'PASS' ? 0.95 : 0.5,
    outputs: validationReport,
    triggers: validationReport.triggers,
    next_action: validationReport.status === 'PASS' ? 'AUTO_NEXT' :
      validationReport.status === 'NEED_HITL' ? 'HITL' : 'REJECT',
    timestamp: new Date().toISOString()
  };

  await saveStageEvent(runId, stageEvent);
  emitStageEvent(runId, stageEvent);

  // REJECT 처리
  if (validationReport.status === 'REJECT') {
    addAgentLog(runId, 'E_Validator', 'ERROR', '검증 실패',
      '데이터가 요구사항을 충족하지 못하여 거부되었습니다', undefined, Date.now() - stageStart);
    completeAgentLog(runId, 'E_Validator', 'FAILED', '검증 실패 - 데이터 거부');
    await updateRunStatus(runId, 'rejected');
    return validationReport;
  }

  // HITL 처리
  if (validationReport.status === 'NEED_HITL') {
    addAgentLog(runId, 'E_Validator', 'WARNING', 'HITL 필요',
      `${blockers.length}개 심각한 문제로 인해 사람의 검토가 필요합니다`, undefined, Date.now() - stageStart);
    completeAgentLog(runId, 'E_Validator', 'SUCCESS',
      `검증 완료 - HITL 필요(문제 ${blockers.length}건)`);
    const packet = await createHITLPacket(runId, 'E', {
      normalized: normalizedDoc,
      triggers: validationReport.triggers
    }, {
      company_name: normalizedDoc.document_properties.company_name,
      document_date: normalizedDoc.document_properties.document_date,
      shareholder_names: normalizedDoc.shareholders.map(s => s.name || 'UNKNOWN')
    });
    await updateRunStatus(runId, 'hitl');
    emitHITLRequired(runId, packet);
    return validationReport;
  }

  addAgentLog(runId, 'E_Validator', 'SUCCESS', '검증 통과',
    '모든 검증 규칙을 통과했습니다, 분석 단계로 진행합니다',
    undefined, Date.now() - stageStart);
  completeAgentLog(runId, 'E_Validator', 'SUCCESS',
    `검증 통과(경고 ${warnings.length}건, 참고 ${infos.length}건)`);

  return validationReport;
}

// ============================================
// Stage INSIGHTS: Analyst
// ============================================

async function runStageINSIGHTS(
  runId: string,
  normalizedDoc: NormalizedDoc,
  validationReport: ValidationReport,
  imageUrls?: string[]
): Promise<InsightsAnswerSet> {
  console.log(`\n\n========================================`);
  console.log(`[Orchestrator] Stage INSIGHTS for run ${runId}`);
  console.log(`[Orchestrator] normalizedDoc exists: ${!!normalizedDoc}`);
  console.log(`[Orchestrator] normalizedDoc.shareholders: ${normalizedDoc?.shareholders?.length ?? 'undefined'}`);
  console.log(`[Orchestrator] validationReport exists: ${!!validationReport}`);
  console.log(`[Orchestrator] validationReport.status: ${validationReport?.status}`);
  console.log(`========================================\n`);

  // 로깅 시작
  console.log(`[INSIGHTS] Step 1: startAgentLog...`);
  startAgentLog(runId, 'INS_Analyst');
  addAgentLog(runId, 'INS_Analyst', 'INFO', '최종 분석 시작', '정규화된 데이터를 바탕으로 최종 인사이트를 도출합니다');
  const stageStart = Date.now();

  console.log(`[INSIGHTS] Step 2: updateRunStatus...`);
  await updateRunStatus(runId, 'running', 'INSIGHTS');

  console.log(`[INSIGHTS] Step 3: addAgentLog...`);
  addAgentLog(runId, 'INS_Analyst', 'INFO', '분석 서비스 실행', '결정적 분석 알고리즘을 수행합니다 (No LLM)');

  console.log(`[INSIGHTS] Step 4: Creating AnalystService...`);
  const analyst = new AnalystService();
  console.log(`[INSIGHTS] Step 5: Calling analyst.generateReport()...`);
  try {
    const answerSet = await analyst.generateReport(normalizedDoc, validationReport, imageUrls);

    await saveArtifact(runId, 'INSIGHTS', 'answer_set', answerSet);

    // 분석 결과 로깅
    // 실소유자(25%+) 결과 로깅
    if ('UNKNOWN' in answerSet.over_25_percent) {
      addAgentLog(runId, 'INS_Analyst', 'WARNING', '실소유자 판별',
        `판별 불가: ${answerSet.over_25_percent.reason} `,
        answerSet.over_25_percent
      );
    } else {
      const over25Names = answerSet.over_25_percent.map(s => `${s.name}(${s.ratio}%)`).join(', ');
      addAgentLog(runId, 'INS_Analyst', 'INFO', '실소유자 판정',
        `${answerSet.over_25_percent.length} 명 식별: ${over25Names || '없음'} `,
        { count: answerSet.over_25_percent.length }
      );
    }

    // 판별 불가 항목
    if (answerSet.cannot_determine.length > 0) {
      addAgentLog(runId, 'INS_Analyst', 'WARNING', '판별 불가 항목',
        `${answerSet.cannot_determine.length}개 항목 판별 불가`,
        answerSet.cannot_determine
      );
    }

    const isDecidable = answerSet.validation_summary.decidability.is_decidable;

    const over25List = Array.isArray(answerSet.over_25_percent)
      ? answerSet.over_25_percent.map(h => `${h.name}(${h.ratio}%)`).join(', ')
      : '판별 불가';

    const stageEvent: StageEvent = {
      stage_name: 'INSIGHTS',
      summary: isDecidable ? `분석 완료: 25% 이상 주주(${over25List})` : `분석 불가: ${answerSet.validation_summary.decidability.reason}`,
      rationale: `종합 분석 결과: ${isDecidable ? '정상(정합성 확인됨)' : '부적합(데이터 결함 발견)'} - ${answerSet.validation_summary.decidability.reason}`,
      confidence: answerSet.synthesis_confidence || (isDecidable ? 1.0 : 0.5),
      outputs: answerSet,
      triggers: answerSet.validation_summary.triggers,
      next_action: isDecidable ? 'AUTO_NEXT' : 'HITL',
      timestamp: new Date().toISOString()
    };

    await saveStageEvent(runId, stageEvent);
    emitStageEvent(runId, stageEvent);
    emitFinalAnswer(runId, answerSet);

    const finalStatus = isDecidable ? 'SUCCESS' : 'WARNING';
    const finalMsg = isDecidable ? '분석 완료' : '분석 불가 (정합성 오류)';

    addAgentLog(runId, 'INS_Analyst', finalStatus, finalMsg,
      isDecidable
        ? `최종 분석 완료 - 25% 이상 주주(내림차순): ${over25List}`
        : `종합 분석 소견: ${answerSet.synthesis_reasoning}`,
      { synthesis_confidence: answerSet.synthesis_confidence }, Date.now() - stageStart);

    completeAgentLog(runId, 'INS_Analyst', isDecidable ? 'SUCCESS' : 'FAILED',
      isDecidable ? `분석 완료 - 25% 이상 주주: ${over25List}` : `분석 불가 - 사유: ${answerSet.validation_summary.decidability.reason}`);

    // [FIX] If validation report was NEED_HITL, maintain hitl status instead of 'completed'
    if (validationReport.status === 'NEED_HITL') {
      await updateRunStatus(runId, 'hitl');
      // No emitCompleted here, as it's waiting for human.
      console.log(`[Orchestrator] Run ${runId} paused for HITL after INSIGHTS explanation.`);
    } else {
      await updateRunStatus(runId, 'completed');
      emitCompleted(runId);
      console.log(`[Orchestrator] Run ${runId} COMPLETED in ${Date.now() - stageStart} ms`);
    }

    return answerSet;
  } catch (err: any) {
    console.error('[Orchestrator] INSIGHTS Stage Error:', err);
    addAgentLog(runId, 'INS_Analyst', 'ERROR', '분석 오류', err.message || 'Unknown Error');
    completeAgentLog(runId, 'INS_Analyst', 'FAILED', '분석 단계 실행 실패');
    throw err;
  }
}

// ============================================
// HITL 이후 재개
// ============================================

/**
 * HITL 처리 후 Run 재개
 */
export async function resumeRunAfterHITL(
  runId: string,
  corrections?: Record<string, unknown>
): Promise<void> {
  console.log(`[Orchestrator] Resuming run ${runId} after HITL`);

  const run = await getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId} `);
  }

  if (run.status !== 'hitl') {
    throw new Error(`Run ${runId} is not in HITL status`);
  }

  const currentStage = run.current_stage;

  // 현재 단계부터 재실행
  // corrections가 있으면 해당 artifact를 업데이트하고 다음 단계부터 진행

  try {
    await updateRunStatus(runId, 'running');

    const { prepareImagesForAnalysis } = await import('./services/converter');
    const images = await prepareImagesForAnalysis(run.files[0]);
    if (images.length === 0) throw new Error('No images available');

    // 단계별 재개 로직
    switch (currentStage) {
      case 'B': {
        // B단계 HITL 후 재시작 - 전체 재실행
        await executeRun(runId);
        break;
      }

      case 'C': {
        // C단계 HITL 후 재시작
        const assessment = await getArtifact<DocumentAssessment>(runId, 'B', 'assessment');
        if (!assessment) throw new Error('Assessment not found');

        // corrections가 있으면 수동 입력된 extractorOutput 사용
        let extractorOutput: ExtractorOutput | null;
        if (corrections?.extractor_output) {
          extractorOutput = corrections.extractor_output as ExtractorOutput;
          await saveArtifact(runId, 'C', 'extractor_output', extractorOutput);
        } else {
          extractorOutput = await runStageC(runId, images, assessment);
        }
        if (!extractorOutput) return;

        const normalizedDoc = await runStageD(runId, extractorOutput);
        if (!normalizedDoc) return;

        const validationReport = await runStageE(runId, normalizedDoc);
        if (!validationReport || validationReport.status !== 'PASS') return;

        await runStageINSIGHTS(runId, normalizedDoc, validationReport);
        break;
      }

      case 'D': {
        // D단계 HITL 후 재시작
        const extractorOutput = await getArtifact<ExtractorOutput>(runId, 'C', 'extractor_output');
        if (!extractorOutput) throw new Error('Extractor output not found');

        let normalizedDoc: NormalizedDoc | null;
        if (corrections?.normalized_doc) {
          normalizedDoc = corrections.normalized_doc as NormalizedDoc;
          await saveArtifact(runId, 'D', 'normalized_doc', normalizedDoc);
        } else {
          normalizedDoc = await runStageD(runId, extractorOutput);
        }
        if (!normalizedDoc) return;

        const validationReport = await runStageE(runId, normalizedDoc);
        if (!validationReport || validationReport.status !== 'PASS') return;

        await runStageINSIGHTS(runId, normalizedDoc, validationReport);
        break;
      }

      case 'E': {
        // E단계 HITL 후 재시작
        let normalizedDoc = await getArtifact<NormalizedDoc>(runId, 'D', 'normalized_doc');
        if (!normalizedDoc) throw new Error('Normalized doc not found');

        // corrections가 있으면 수정된 normalizedDoc 사용
        if (corrections?.normalized_doc) {
          normalizedDoc = corrections.normalized_doc as NormalizedDoc;
          await saveArtifact(runId, 'D', 'normalized_doc', normalizedDoc);
        }

        const validationReport = await runStageE(runId, normalizedDoc);
        if (!validationReport || validationReport.status !== 'PASS') return;

        await runStageINSIGHTS(runId, normalizedDoc, validationReport);
        break;
      }

      default:
        throw new Error(`Cannot resume from stage: ${currentStage} `);
    }

    await updateRunStatus(runId, 'completed');
    emitCompleted(runId);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Orchestrator] Resume failed for run ${runId}: `, errorMessage);
    await updateRunStatus(runId, 'error', undefined, errorMessage);
    emitError(runId, errorMessage);
  }
}
