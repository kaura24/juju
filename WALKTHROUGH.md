# WALKTHROUGH.md — JuJu Shareholder Analyzer v3.1.0

> 프로젝트 전체 구조와 코드 흐름을 이해하기 위한 기술 워크스루 문서입니다.

---

## 1. 프로젝트 개요

한국어 **주주명부 이미지/PDF**를 업로드하면 GPT-4o Vision + TypeScript Rule Engine이 협업하여 정형 데이터로 변환하는 AI 분석 시스템입니다.

| 항목 | 내용 |
|------|------|
| **버전** | 3.1.0 (Multi-Platform Optimized) |
| **프레임워크** | SvelteKit (Svelte 5 Runes) + TailwindCSS v4 + Vite 7 |
| **배포** | Vercel (`@sveltejs/adapter-vercel`) |
| **저장소** | Supabase Storage (이미지 + 메타데이터 JSON) |
| **AI** | OpenAI GPT-4o / GPT-4o-mini + `@openai/agents` |

---

## 2. 디렉토리 구조

```
JuJu/
├── src/
│   ├── app.html                      # HTML 템플릿
│   ├── routes/
│   │   ├── +page.svelte              # 메인 페이지 (업로드 + 결과)
│   │   ├── +layout.svelte            # 레이아웃 (공통 헤더/스타일)
│   │   ├── layout.css                # CSS 변수 & 디자인 시스템
│   │   ├── api/
│   │   │   ├── runs/                 # 분석 실행 API
│   │   │   │   ├── +server.ts        # POST: 새 분석 생성
│   │   │   │   └── [id]/             # 개별 Run 관리
│   │   │   │       ├── execute/      # 분석 실행
│   │   │   │       ├── events/       # SSE 이벤트 스트림
│   │   │   │       ├── result/       # 결과 조회
│   │   │   │       └── status/       # 상태 조회
│   │   │   ├── hitl/                 # HITL 승인 API
│   │   │   ├── session/              # 세션 관리
│   │   │   ├── storage/              # 스토리지 관리
│   │   │   ├── debug/                # 디버그 엔드포인트
│   │   │   └── system-status/        # 시스템 상태 조회
│   │   ├── runs/[id]/                # 분석 상세 페이지
│   │   └── hitl/                     # HITL 승인 페이지
│   └── lib/
│       ├── components/               # Svelte 5 UI 컴포넌트 (11개)
│       ├── server/
│       │   ├── orchestrator.ts       # ★ 핵심: 분석 파이프라인 오케스트레이터
│       │   ├── agents.ts             # AI 에이전트 정의 (5종)
│       │   ├── envCheck.ts           # 멀티 플랫폼 환경 감지
│       │   ├── storage.ts            # 스토리지 추상화 레이어
│       │   ├── agentLogger.ts        # 실시간 로그 스트리밍
│       │   ├── sessionLock.ts        # 동시 실행 방지
│       │   ├── events.ts             # SSE 이벤트 관리
│       │   ├── services/
│       │   │   ├── analyst.ts        # 분석 결과 산출 (결정적)
│       │   │   ├── converter.ts      # PDF→이미지 변환
│       │   │   ├── supabase_storage.ts # Supabase 연동
│       │   │   └── persistentLogger.ts # 영구 로그 저장
│       │   └── agents/               # 에이전트 관련 모듈
│       ├── types/                    # TypeScript 타입 정의
│       ├── validator/                # Rule Engine (Zod 기반)
│       ├── output/                   # 결과 포매터
│       └── client/                   # 클라이언트 유틸
├── scripts/
│   ├── pdf-to-images.cjs            # PDF→이미지 변환 (CommonJS, pdfjs-dist v3)
│   ├── check-models.js              # 사용 가능 모델 확인
│   └── test-*.{cjs,ts}              # 테스트 스크립트
├── static/                          # 정적 파일 (favicon 등)
├── supabase_setup.sql               # Supabase RLS 정책 SQL
├── supabase_policies.sql            # 추가 정책 SQL
├── package.json                     # v3.1.0
├── svelte.config.js                 # Vercel 어댑터 설정
├── vite.config.js                   # Vite + TailwindCSS + Vitest
└── tsconfig.json
```

---

## 3. 분석 파이프라인 흐름

### 3.1 Fast Track (저복잡도 문서)
```
Upload → Gatekeeper(복잡도 판정) → FastExtractor(단일 패스) → Analyst → 결과
```

### 3.2 Multi-Agent Pipeline (고복잡도 문서)
```
Upload → Gatekeeper → Extractor → Normalizer → Validator → Analyst → 결과
         (문서 분류)   (OCR 추출)   (표준화)     (규칙 검증)  (인사이트)
```

### 3.3 실행 흐름 (코드 레벨)
1. **`+page.svelte`** → `UploadPanel.svelte`에서 파일 선택 & 업로드
2. **`POST /api/runs`** → Run 생성, 이미지를 Supabase에 업로드
3. **`POST /api/runs/[id]/execute`** → `orchestrator.ts`가 파이프라인 실행
4. **`GET /api/runs/[id]/events`** → SSE로 실시간 진행 상황 스트리밍
5. **`GET /api/runs/[id]/result`** → 최종 분석 결과 응답
6. **`RunSummary.svelte`** + **`AnswerDisplay.svelte`** → 결과 렌더링

---

## 4. 핵심 모듈 상세

### 4.1 Orchestrator (`orchestrator.ts`, ~64KB)
- 분석 세션의 생성·실행·상태 관리
- Fast Track / Multi-Agent 라우팅 결정
- 각 에이전트 순차 호출 및 에러 핸들링
- SSE 이벤트 발행 (Stage 전환, 진행률, 완료/실패)

### 4.2 Agents (`agents.ts`, ~38KB)
5개 에이전트 정의:
| 에이전트 | 역할 |
|----------|------|
| **Gatekeeper** | 문서 분류 + 실행 전략 결정 |
| **Extractor** | 이미지→구조화 JSON (원본 그대로) |
| **Normalizer** | 수치·날짜·식별번호 표준화 + 성명 심층 분석 |
| **Validator** | Rule Engine 기반 교차 검증 |
| **Analyst** | 인사이트 요약 + 실소유자 판별 |
| **FastExtractor** | 위 전체를 단일 패스로 수행 |

### 4.3 Environment Detection (`envCheck.ts`, ~12KB)
- Vercel / Netlify / Cloudflare / Railway / Render / Local 자동 감지
- 플랫폼별 런타임 프로파일 (타임아웃, 메모리, spawn 허용 여부)
- 시스템 시작 시 상태 배너 출력

### 4.4 Storage (`storage.ts`, ~15KB)
- 로컬 파일 시스템 / Supabase 이중 지원
- 환경 변수에 따른 자동 전환
- Run/Event/Artifact/HITL 메타데이터 CRUD

---

## 5. UI 컴포넌트 (Svelte 5 Runes)

| 컴포넌트 | 크기 | 역할 |
|----------|------|------|
| `UploadPanel.svelte` | 24KB | 파일 선택, PDF→이미지 클라이언트 변환, 업로드 |
| `RunSummary.svelte` | 22KB | 분석 결과 종합 표시 (카드 UI) |
| `RunLogStream.svelte` | 20KB | 실시간 SSE 로그 스트리밍 |
| `AgentLogViewer.svelte` | 18KB | 에이전트별 로그 뷰어 |
| `HitlDetail.svelte` | 11KB | HITL 승인 상세 화면 |
| `AnswerDisplay.svelte` | 10KB | 인사이트 답변 표시 |
| `MajorShareholdersTable.svelte` | 7KB | 대주주 테이블 |
| `DebugPanel.svelte` | 6KB | API/SSE 디버그 모니터 (🐞) |
| `StageCard.svelte` | 6KB | 파이프라인 단계 카드 |
| `HitlInbox.svelte` | 5KB | HITL 요청 목록 |
| `RunTimeline.svelte` | 2KB | 분석 타임라인 표시 |

---

## 6. API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/api/runs` | 새 분석 Run 생성 |
| `POST` | `/api/runs/[id]/execute` | 분석 실행 트리거 |
| `GET` | `/api/runs/[id]/events` | SSE 이벤트 스트림 |
| `GET` | `/api/runs/[id]/result` | 분석 결과 조회 |
| `GET` | `/api/runs/[id]/status` | Run 상태 조회 |
| `GET/POST` | `/api/hitl/[id]` | HITL 승인 관리 |
| `GET` | `/api/session` | 세션 정보 |
| `GET` | `/api/system-status` | 시스템 상태 |
| `GET` | `/api/debug` | 디버그 정보 |

---

## 7. 데이터 흐름 (Supabase Storage)

```
juju-images-public/          # 이미지 버킷 (Public)
  └── {runId}/
      └── page_1.jpeg, page_2.jpeg ...

juju-data/                   # 메타데이터 버킷 (Private)
  ├── runs/{runId}.json      # Run 상태 및 설정
  ├── events/{eventId}.json  # Stage 이벤트 로그
  ├── artifacts/{id}.json    # 분석 결과물
  └── hitl/{hitlId}.json     # HITL 패킷
```

---

## 8. 개발 시 주의사항

1. **`pdfjs-dist` 버전 고정** (v3.11.174) — v4.x에서 Segfault 발생
2. **`scripts/pdf-to-images.cjs`** — `console.log` 오버라이딩 코드 삭제 금지
3. **Svelte 5 Runes** — `$state`, `$derived`, `$effect` 사용, `export let` 대신 `$props()` 사용
4. **세션 잠금** — `sessionLock.ts`가 동시 실행 방지 (같은 Run 중복 실행 차단)
5. **개발 모드** — 자동으로 `gpt-4o-mini` 사용 (비용 절감)

---

**Last Updated**: 2026-02-11
**Version**: 3.1.0
