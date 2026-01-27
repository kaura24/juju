# 주주명부 분석 AI 시스템 (JuJu Shareholder Analyzer) v2.5

본 시스템은 **한국어 주주명부 이미지/PDF**를 분석하여 정형화된 데이터로 변환하는 엔터프라이즈급 AI 솔루션입니다. **GPT-4o Vision**의 인지 능력과 **TypeScript 기반 Rule Engine**의 계산 능력을 결합한 하이브리드 아키텍처를 채택했습니다.

## 🚀 v2.5 Major Update: Supabase Storage Integration
**Vercel Serverless 환경의 파일 시스템 제약을 영구적으로 해결하기 위해 Supabase Storage를 전면 도입했습니다.**

### 💾 Supabase Storage Architecture
기존 `/tmp` 디렉토리를 사용하는 임시 방편을 넘어, 엔터프라이즈급 안정을 위한 **클라우드 스토리지 파이프라인**을 구축했습니다.

1.  **Direct Upload via Service Role**: 서버 사이드에서 `SERVICE_KEY`를 사용하여 RLS(Row Level Security) 제약 없이 안정적으로 파일을 업로드합니다.
2.  **Public URL Generation**: 업로드된 이미지는 고유한 Public URL로 변환되어 GPT-4o Vision에게 전달됩니다. 이는 로컬 파일 경로를 사용할 때보다 훨씬 빠르고 안정적인 이미지 처리를 보장합니다.
3.  **Automatic Lifecycle Management**: 분석이 완료된 파일이나 실패한 파일은 정책에 따라 효율적으로 관리됩니다 (추후 확장 예정).

### 🛠️ Config Updates (.env)
시스템 구동을 위해 다음 환경변수가 필수적으로 요구됩니다.
```bash
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_KEY="your-service-role-key" # (Caution: Server-side only)
SUPABASE_BUCKET_NAME="uploads"
```

---

## 🏗️ 아키텍처 및 설계 철학 (Architecture & Philosophy)

### 🚨 Zero Tolerance Data Integrity Policy (무관용 데이터 원칙)
**이 원칙은 어떤 편의성보다 우선하며, 시스템이 절대로 어기면 안 되는 절대 규칙입니다.**
1.  **NO Silent Corrections**: AI나 시스템은 사용자에게 알리지 않고 데이터를 임의로 수정, 병합, 삭제해서는 안 됩니다.
2.  **NO Auto-Merging**: 명백해 보이는 중복이라도 시스템이 알아서 합쳐서는 안 됩니다. 반드시 오류(BLOCKER)를 발생시켜 사용자의 결정을 받아야 합니다.
3.  **Mandatory Metadata**: 분석 대상 회사명과 발행일(기준일)이 식별되지 않으면 분석을 거부하고 사람의 확인(HITL)을 요청해야 합니다.
4.  **Freshness Guarantee**: 발행일로부터 1년(365일)이 경과한 명부는 정합성 오류(STALE)로 처리하여 최신성 확인을 강제해야 합니다.
5.  **Report & Halt**: 데이터의 무결성이 의심되는 모든 상황에서 시스템은 "해결"하려 들지 말고, 즉시 멈추고 "보고"해야 합니다.

### 📅 Universal Identifier & Birthdate Policy (생년월일 추론 공통 규칙)
**Fast Track 및 Multi-Agent 모드 공통 적용 (Current Base Year: 2026)**
1.  **우선순위 1 (성별코드)**: 주민번호 뒷자리가 식별되면 그 첫 자리(1,2,5,6 vs 3,4,7,8)로 연도를 확정합니다.
2.  **우선순위 2 (Rule of 100)**: 뒷자리가 없으면 앞 2자리(YY)를 보고 판단하되, **현재(2026년)보다 미래가 되지 않도록(Not Future-Dated)** 1900/2000년대를 결정합니다.
    - 예: `85` -> 1985 (2085는 미래), `15` -> 2015 (과거)

### 7. 날짜 정규화 정책 (Date Standardization Policy)
- **발행일 (Issue Date)**: 문서 전체의 기준이 되는 날짜(발행일, 기준일, 생성일, 작성일, **'ㅇㅇㅇ일 현재'**, 또는 **법인인감/도장 근처 날짜**)는 분석 결과의 **'발행일'** 필드로 통합하여 관리합니다.
- **생년월일 (Birth Date)**: 개별 주주의 신원 정보인 생년월일은 주주 데이터의 **'식별번호'** 필드에 저장되며, 발행일과는 엄격히 구분됩니다.
- **신선도 검증 (Staleness Check)**: 발행일이 현재 시점으로부터 **1년(365일)을 초과**한 경우, 데이터 실효성이 상실된 것으로 판단하여 오류를 발생시킵니다.
- **구분 원칙**: 날짜가 **제목 아래, 문서 하단, 혹은 도장 날인 근처**에 있다면 발행일로 판정하며, 표(Table) 내부 주주 정보 행에 위치하면 생년월일로 판정합니다.

### 8. 실소유자 판정 정책 (Beneficial Owner Policy)
시스템은 다음 2단계 로직에 따라 실소유자를 판정하며, UI 및 결과에는 **"25% 이상"** 또는 **"(25% 미만)"** 두 가지 레이블링만 사용합니다.

1.  **1단계 (25% 이상)**: 지분율이 25% 이상인 모든 주주를 추출합니다.
2.  **2단계 (25% 미만 - 최대주주)**: 1단계에 해당하는 주주가 한 명도 없는 경우, 지분율이 가장 높은 주주 1인을 선정하여 **"최대주주 (25% 미만)"**로 독립 표기합니다.
    *   *참고: 3단계(대표이사 등 고위경영진)는 현재 시스템 판단 범위에서 제외됩니다.*

- 실소유자는 문서 내에서 최대 **4명**까지만 존재할 수 있습니다 (지분 합계 100% 제약).
- 시스템은 1위 주주뿐만 아니라 기준을 충족하는 모든 주주를 추출하여 보고합니다.
- 적용: Fast Track 및 Multi-Agent 모드 공통 적용.

### 9. 무추론 원칙 (No Guessing Policy / Anti-Hallucination)
데이터의 무결성을 위해 시스템은 부족한 정보를 임의로 채우거나 추론하지 않는 것을 원칙으로 합니다.

- **날짜 데이터**: '2022.02'와 같이 '일(Day)' 정보가 없는 경우, 임의로 '2022-02-01'로 변환하지 않습니다. 이 경우 데이터 불완전으로 판정하여 **"알 수 없음"** 또는 **"부분적 정보"**로 리포팅하며, Validator에서 `BLOCKER`를 발생시킵니다.
- **식별자 데이터**: 사업자번호, 법인번호, 주민번호 등의 자릿수가 법적 기준에 미달하는 경우(예: 사업자번호 9자리 추출), 임의로 0을 붙이거나 숫자를 지어내지 않습니다.
- **철저한 검증**: 모든 날짜는 ISO-8601(YYYY-MM-DD) 형식을, 모든 식별번호는 각각의 고유 자릿수(BRN 10자, CRN/ID 13자)를 충족해야 정합성 검증을 통과할 수 있습니다.

### 1. Hybrid Reliability (AI + Code)
금융/법률 데이터 처리를 위해 **"확률적 직관(AI)"**과 **"결정적 검증(Code)"**을 분리했습니다.
- **AI Layer (Intuition)**: 비정형 이미지 해석, 문맥 파악, 오타 교정 제안, 성명 적합성 판단. (오판 가능성 인정)
- **Code Layer (Verification)**: 100% 신뢰할 수 있는 수학적 검증, 데이터 무결성 강제, 계산 로직. (타협 없음)

### 2. Safety-First (Fail-Safe)
데이터가 불확실할 경우 잘못된 결과를 내는 것보다 **'판단 보류'**를 우선합니다.
- **HITL (Human-in-the-Loop)**: AI가 데이터를 임의로 수정했거나(성명 교정), 검증 규칙이 깨진 경우(합계 불일치) 즉시 프로세스를 잠그고(Block) 사람의 승인을 요구합니다.

### 3. Visual Consistency & Usability
모든 분석 과정은 사용자가 이해하기 쉬운 **카드형 UI**와 **로그-결과 차트의 시각적 동기화(500px Matching)**를 통해 전달됩니다.

---

## 🤖 에이전트 상세 명세 (Full Agent Specifications)

시스템은 5단계의 파이프라인으로 구성되며, 각 에이전트는 단일 책임 원칙(SRP)에 따라 동작합니다.

### 🚪 Step 1. Gatekeeper (문서 수문장)
**"Is this document worth analyzing?"**
불필요한 과금을 방지하고 시스템 리소스를 보호하는 첫 번째 필터입니다.

- **Input**: 원본 이미지 (Base64)
- **Logic**:
  1.  **Document Classification**: 이미지의 시각적 특징(표, 인장, 제목 위치)을 분석하여 '주주명부'인지 판별합니다. (이력서, 영수증 등 거부)
  2.  **Feasibility Check**: 분석에 필수적인 3대 요소(주주명, 식별번호, 지분정보)가 모두 존재하는지 스캔합니다.
  3.  **Smart Routing**: 문서 복잡도에 따라 실행 전략을 결정합니다.
      - *Low Complexity*: **FastExtractor** (단일 호출로 처리, 속도 최적화)
      - *High Complexity*: **Multi-Agent Pipeline** (단계별 정밀 처리, 정확도 최적화)

### 📄 Step 2. Extractor (데이터 추출기)
**"Read exactly what you see."**
이미지 픽셀을 텍스트 데이터로 변환하는 OCR 및 구조화 에이전트입니다.

- **Logic**:
  1.  **Table parsing**: 테두리가 없거나 셀이 병합된 복잡한 표 구조를 시각적으로 해석하여 행/열을 매핑합니다.
  2.  **Raw Extraction**: 이 단계에서는 데이터를 교정하지 않습니다. '홍청군'으로 적혀있으면 그대로 '홍청군'으로 추출합니다. 이는 원본 데이터의 추적 가능성(Traceability)을 보장하기 위함입니다.
  3.  **Schema Validation**: 추출된 JSON이 시스템의 `Zod Schema`를 통과하는지 1차 검증합니다. (필수 필드 누락 방지)

### 🔄 Step 3. Normalizer (표준화 및 심층 분석기)
**"Transform Raw Data into System Intelligence."**
가장 복잡하고 중요한 에이전트로, 단순 정규화를 넘어선 **지능형 분석**을 수행합니다.

#### 3.1. Numeric & Format Normalization (수치/서식 정규화)
다양한 표기법을 연산 가능한 표준 포맷으로 통일합니다.
- **Shares (주식수)**: `"10,000주"`, `"1만주"`, `"1,000"` → `10000` (Integer)
- **Ratio (지분율)**: `"25.5%"`, `"0.255"`, `"25.5"` → `25.5` (Float, 단위 통일)
- **Amount (금액)**: `"1억 5천만원"`, `"150,000,000원"` → `150000000` (Integer)
- **Date**: `"2020.05.01"`, `"20년5월1일"` → `"2020-05-01"` (ISO 8601)

#### 3.2. Identifier Standardization (식별번호 표준화)
식별번호의 패턴을 분석하여 타입을 확정합니다.
- **INDIVIDUAL**: 주민등록번호 패턴(`\d{6}-\d{7}`) 감지 시, 개인정보 보호를 위해 **생년월일(BIRTH_DATE)**로 변환하여 저장합니다.
- **CORPORATE**: 사업자등록번호(`\d{3}-\d{2}-\d{5}`) 또는 법인등록번호 패턴을 감지하여 타입을 태깅합니다.

#### 3.3. Advanced Name Analysis (심층 성명 분석) [AI Intelligence]
단순 오타 교정을 넘어, 인구통계학적/언어학적 지식을 활용해 이름의 진위 여부를 판단합니다.
- **음운론적 적합성 (Phonetic)**: 소리 내어 읽었을 때 한국어 이름으로 자연스러운지 판단합니다. (예: '박딹' → ❌)
- **어휘적 희소성 (Lexical Rarity)**: '청군', '흥청' 등 이름에 거의 쓰이지 않는 희귀 단어가 포함되었는지 통계적으로 검토합니다.
  - *Action*: '홍청군' 감지 → '홍성준' 제안 또는 의심 태깅.
- **인구통계학적 정합성 (Demographic)**: 식별번호에서 추출한 연령대/성별과 이름의 매칭 확률을 계산합니다. (예: 2020년생 '점순' → ⚠️)

#### 3.4. Entity Classification (실체 분류)
이름, 식별번호 형태, 문맥 신호(Signal)를 종합하여 주주가 **'개인(Individual)'**인지 **'법인(Corporate)'**인지 최종 판정합니다.

### ✅ Step 4. Validator (규칙 기반 검증기)
**"Code never lies."**
AI의 판단 결과를 코드로 심사하는 최종 관문입니다. (`ruleEngine.ts`)

- **Rule: E-NAME-001 (성명 안전장치)**: Normalizer가 남긴 `normalization_notes`에 "성명 교정"이나 "성명 의심"이 포함된 경우, **즉시 HITL(사람 확인)을 트리거합니다.** (BLOCKER Level)
- **Rule: E-META-001/002 (필수 정보)**: 회사명 또는 발행일이 누락된 경우 즉시 중단합니다.
- **Rule: E-META-003 (날짜 실효성)**: 발행일이 1년을 경과한 경우 BLOCKER를 발생시킵니다.
- **Rule: E-CON-001 (3자 교차 검증)**: **"주식수와 지분율과 지분금액은 서로 모순될 수 없다"**는 원칙을 검증합니다. (주식수 비중 == 금액 비중 == 지분율) 이 셋 중 하나라도 어긋나면 즉시 중단합니다.
- **Rule: E-SUM-001 (수치 무결성)**: 모든 주주의 주식수 합계가 문서 상단에 명시된 '총발행주식수'와 정확히 일치하는지 검증합니다.
- **Rule: E-ID-002 (1:1 식별)**: 주주의 명수와 유효한 식별번호의 개수가 1:1로 대응되는지 확인하여 동명이인 혼동을 방지합니다.

### 📊 Step 5. Analyst (종합 인사이터)
**"AI reasoning based on structured evidence."**
검증된 데이터와 각 단계의 판단 근거(JSON)를 바탕으로, AI가 최종적으로 사람이 이해하기 쉬운 언어로 요약/설명합니다.

- **AI Synthesis**: 이전 단계(Gatekeeper~Validator)에서 도출된 모든 판단 근거와 JSON 데이터를 취합합니다.
- **AI Re-explanation**: 취합된 정밀 데이터를 다시 AI에 전달하여, "왜 이런 결과가 나왔는지"에 대한 논리적 근거를 자연어로 재구성합니다.
- **25% Rule Algorithm**: 지분율 25% 이상 실소유주(BO)를 판별하고 내림차순 정렬합니다.
- **Decision Support**: 성명 교정 내역, 지분율 역산 근거 등을 투명하게 공개하여 사용자의 최종 판단을 돕습니다.

---

## 4. 📱 UI/UX 디자인 가이드

- **Split View System**: 좌측 로그 뷰어(과정)와 우측 결과 뷰어(결과)를 동시에 배치하여 투명성을 높였습니다.
- **Matched Geometry**: 로그 카드의 너비와 결과 카드의 너비를 **500px로 정밀하게 일치**시켜, 시각적 안정감을 주고 모바일 가독성을 극대화했습니다.
- **Card Metaphor**: 모든 정보 단위를 '카드'로 모듈화하여 정보의 위계를 명확히 했습니다.

---

**Last Updated**: 2026-01-27
**System Version**: 2.5.0 (Supabase Integrated) - Vercel & Supabase Hybrid Architecture
**Maintainer**: JuJu Dev Team

---

## 5. 🛠️ 트러블슈팅 및 유지보수 가이드 (Troubleshooting & Maintenance)

### 🚨 PDF Processing & Image Conversion (Critical)
**[2026-01-26] PDF 인식 실패 및 JSON 파싱 에러 해결 기록**

PDF를 이미지로 변환하는 `scripts/pdf-to-images.cjs` 모듈은 Node.js 환경과 `pdfjs-dist` 라이브러리 간의 호환성에 매우 민감합니다. **절대로** 충분한 테스트 없이 이 모듈이나 관련 의존성을 업데이트하지 마십시오.

#### 1. 문제 상황 (Issue)
- **증상 1**: `npm run dev` 실행 중 PDF 변환 시 "Segmentation Fault" 또는 이유 없는 프로세스 종료 발생.
- **증상 2**: `JSON Parse Error` (Unexpected token 'W'). `pdfjs-dist`에서 발생하는 경고 메시지("Warning: Cannot polyfill...")가 표준 출력(stdout)으로 새어 나와 결과값(JSON)을 오염시킴.

#### 2. 원인 (Root Cause)
- **버전 호환성**: `pdfjs-dist` v4.x 버전은 최신 Node.js 환경의 Canvas API와 충돌하여 렌더링 시 **Segmentation Fault**를 유발함.
- **로그 오염**: `pdfjs-dist` 내부에서 발생하는 `console.warn` 로그가 프로세스의 `stdout`으로 출력되어, 파이프라인이 이를 JSON 데이터로 착각하고 파싱하려다 실패함.

#### 3. 해결 및 제어 조치 (Resolution & Controls)
1.  **Downgrade to v3**: `pdfjs-dist` 버전을 안정적인 **`3.11.174`**로 고정했습니다. (v4.x로 업그레이드 금지)
2.  **Explicit CommonJS**: `scripts/pdf-to-images.cjs`는 ESM(`import`) 대신 **CommonJS(`require`)** 방식을 사용하여 안정성을 확보했습니다.
3.  **Stdout Protection**: 스크립트 최상단에서 `console.log`와 `console.warn`을 강제로 `console.error`(`stderr`)로 리다이렉트했습니다.
    ```javascript
    // scripts/pdf-to-images.cjs
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = console.error; // Stdout 오염 방지
    console.warn = console.error;
    ```
    이로 인해 오직 결과 JSON만이 `process.stdout.write`를 통해 출력됨을 보장합니다.

#### ⚠️ 유지보수 주의사항 (Maintenance Warning)
- **`package.json`**: `pdfjs-dist` 버전을 **`^3.11.174`**로 유지하십시오. 캐럿(`^`)이 있더라도 메이저 버전 업데이트는 피해야 합니다.
- **`scripts/pdf-to-images.cjs`**: 이 파일의 로깅 로직(`console.log` 오버라이딩)을 제거하지 마십시오. 제거 시 다시 JSON 파싱 에러가 재발합니다.

#### 2. Vercel Runtime Error (File System Permission)
- **증상**: 배포 후 파일 업로드나 데이터 저장 시 `ENOENT: no such file or directory, mkdir '/var/task/uploads'` 에러 발생.
- **원인**: Vercel과 같은 서버리스 환경은 파일 시스템이 **읽기 전용(Read-Only)**입니다. 프로젝트 루트 하위의 `uploads`, `data`, `logs` 디렉토리에 직접 쓰기가 불가능합니다.
- **해결**: 서버리스 환경에서 유일하게 쓰기가 가능한 **임시 디렉토리 (`/tmp`, os.tmpdir())**를 사용하도록 `src/lib/server/storage.ts` 로직을 수정했습니다.
  - Vercel 환경 감지: `process.env.VERCEL === '1' || process.env.VERCEL === 'true'`
  - 기본 경로 전환: `IS_VERCEL ? os.tmpdir() : process.cwd()`

### 🚀 [2026-01-27] Vercel Stability & Multi-Agent Reliability (v2.4)
**서버리스 환경에서의 분석 중단 및 UI '대기 중' 프리징 현상 해결**

1.  **Immediate Status Transition**: 분석 시작 즉시 상태를 `running`으로 전송하여 사용자 피드백 지연을 최소화했습니다.
2.  **Persistent Execution Mode**: 업로드 시 선택한 모드(Fast/Multi)를 DB에 영구 저장하여, 세션 유실 시에도 동일한 모드로 재시작할 수 있게 했습니다.
3.  **Self-Healing Detail Page**: 분석 상세 페이지 진입 시 상태가 `pending`인 경우, 시스템이 자동으로 분석 실행(Execute) 코드를 재트리거하는 클라이언트-서버 협업 로직을 구현했습니다.
4.  **Client-Side Polling Fallback**: SSE(Server-Sent Events) 연결이 불안정한 환경에서도 5초 주기로 최신 상태를 강제 동기화하는 백업 메커니즘을 적용했습니다.
5.  **Debug Monitor (🐞)**: 실시간 API 통신 및 SSE 이벤트를 모니터링할 수 있는 숨겨진 디버그 패널을 추가하여 운영 안정성을 확보했습니다.

---

## 6. 🎨 UI 디자인 시스템 (User Interface Design System)

### Design Core: Microsoft Fluent Design v4.0 (Light Mode)
본 프로젝트는 엔터프라이즈 환경에서의 가독성과 신뢰성을 높이기 위해 **Microsoft Fluent Design System**을 채택하고 있으며, 생산성 향상을 위한 독자적인 그라데이션 시스템(v4.2)이 적용되어 있습니다.

#### 1. 컬러 팔레트 구조 (Color Palette Structure)
모든 스타일은 `src/routes/layout.css`에 CSS Variable로 정의되어 있어 유지보수가 용이합니다.

| 분류 (Category) | 변수명 (Variable) | 색상값 (Hex/Gradient) | 용도 (Usage) |
| :--- | :--- | :--- | :--- |
| **Background** | `--fluent-bg-solid` | `#f3f3f3` | 전체 앱 배경 (Soft Grey) |
| | `--fluent-bg-card` | `#ffffff` | 콘텐츠 카드 배경 (Pure White) |
| | `--fluent-bg-acrylic` | `rgba(255,255,255, 0.95)` | 반투명 글래스 이펙트 |
| **Text** | `--fluent-text-primary` | `#202020` | 본문, 주요 데이터 (Nearly Black) |
| | `--fluent-text-secondary` | `#606060` | 설명, 메타데이터 (Medium Grey) |
| | `--fluent-text-disabled` | `#bdc3c7` | 비활성화 텍스트 |
| **Accent** | `--fluent-accent` | `#2563eb` | 강조, 포커스, 링크 (Tech Blue) |
| **Action** | `--btn-primary-bg` | `Linear Gradient (Blue)` | 주요 액션 버튼 (입체감 적용) |
| | `--btn-noir-bg` | `Linear Gradient (Slate)` | 보조 액션 버튼 (Neutral) |
| | `--btn-danger-bg` | `Linear Gradient (Red)` | 위험 액션 (삭제 등) |

#### 2. 시각적 계층 (Visual Hierarchy)
- **Elevation (그림자)**: `fluent-shadow-2` ~ `16` 단계를 사용하여 요소의 중요도에 따라 입체감을 부여했습니다.
- **Typography**: 'Segoe UI Variable'을 기본으로 하여 숫자 가독성에 최적화된 폰트 시스템을 사용합니다.
- **Micro-Interactions**: 모든 버튼과 링크에는 `83ms`(Fast) ~ `167ms`(Normal)의 부드러운 전환 애니메이션(`cubic-bezier`)이 적용되어 있습니다.

