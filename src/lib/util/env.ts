/** File: src/lib/util/env.ts */
/**
 * 환경변수 검증 및 로딩 모듈
 * - 서버 사이드에서만 사용
 * - 누락된 필수 환경변수 체크 (즉시 종료 + 명확한 에러)
 * - 비밀값은 절대 로깅하지 않음
 */

import { env } from '$env/dynamic/private';

export interface EnvConfig {
	// OpenAI 설정
	OPENAI_API_KEY: string;
	OPENAI_MODEL: string;
	OPENAI_ORGANIZATION_ID?: string;
	OPENAI_PROJECT_ID?: string;

	// Resend 설정 (선택)
	RESEND_API_KEY?: string;
	RECIPIENT_EMAIL?: string;
	SENDER_EMAIL?: string;

	// 개발용
	MOCK_LLM: boolean;
}

const REQUIRED_VARS = [
	'OPENAI_API_KEY'
] as const;

let cachedConfig: EnvConfig | null = null;

/**
 * 환경변수 검증 및 로딩
 * 누락된 필수 환경변수가 있으면 에러 발생 (즉시 종료)
 */
export function loadEnvConfig(): EnvConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	const missingVars: string[] = [];

	// MOCK_LLM이 true면 OPENAI_API_KEY는 필수가 아님
	const mockLlm = env.MOCK_LLM === 'true';

	// 필수 환경변수 체크
	for (const key of REQUIRED_VARS) {
		// MOCK 모드에서는 OPENAI_API_KEY 누락 무시
		if (mockLlm && key === 'OPENAI_API_KEY') {
			continue;
		}
		if (!env[key]) {
			missingVars.push(key);
		}
	}

	// 누락된 환경변수가 있으면 명확한 에러 메시지와 함께 종료
	if (missingVars.length > 0) {
		const errorMessage = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ 필수 환경변수 누락 오류
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

다음 환경변수가 설정되지 않았습니다:
${missingVars.map(v => `  • ${v}`).join('\n')}

해결 방법:
1. 프로젝트 루트에 .env 파일을 생성하세요
2. 아래 형식으로 환경변수를 설정하세요:

   OPENAI_API_KEY=sk-your-api-key-here
   RESEND_API_KEY=re_your-api-key-here

3. 서버를 재시작하세요

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

		console.error(errorMessage);
		throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
	}

	cachedConfig = {
		OPENAI_API_KEY: env.OPENAI_API_KEY || '',
		// 기본 모델은 agents.ts에서 관리하므로 여기서는 빈 값을 허용
		OPENAI_MODEL: env.OPENAI_MODEL || '',
		OPENAI_ORGANIZATION_ID: env.OPENAI_ORGANIZATION_ID,
		OPENAI_PROJECT_ID: env.OPENAI_PROJECT_ID,

		RESEND_API_KEY: env.RESEND_API_KEY,
		RECIPIENT_EMAIL: env.RECIPIENT_EMAIL,
		SENDER_EMAIL: env.SENDER_EMAIL,

		MOCK_LLM: mockLlm
	};

	return cachedConfig;
}

/**
 * 환경변수 캐시 클리어 (테스트용)
 */
export function clearEnvCache(): void {
	cachedConfig = null;
}
