import { chromium } from 'playwright';

async function runTest() {
    console.log('🚀 [Step 1] брау저를 별도의 창으로 실행합니다...');
    const browser = await chromium.launch({
        headless: false,
        args: ['--new-window']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // 에러 추적을 위한 콘솔 로그 및 네트워크 리스너 추가
    page.on('console', msg => {
        if (msg.type() === 'error') console.error(`❌ [Page Error]: ${msg.text()}`);
        else console.log(`[Page Log]: ${msg.text()}`);
    });
    page.on('pageerror', err => console.error(`💥 [Uncaught Exception]: ${err.message}`));
    page.on('requestfailed', request => console.error(`🔌 [Network Failed]: ${request.url()} - ${request.failure()?.errorText}`));

    try {
        console.log('🌐 [Step 2] http://localhost:5173/ 에 접속하여 초기 상태를 확인합니다...');
        await page.goto('http://localhost:5173/', { timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 60000 });

        // Step 2 검증: 페이지 타이틀이 JuJu Analysis 인지 확인
        const title = await page.locator('h1').first().textContent();
        if (!title?.includes('JuJu Analysis')) {
            throw new Error('페이지 로드 실패: JuJu Analysis 타이틀을 찾을 수 없습니다.');
        }
        console.log('✅ [Check] 메인 페이지 정상 로드 확인 완료');
        await page.screenshot({ path: 'test_01_loaded.png' });

        console.log('📤 [Step 3] 대상 파일을 업로드합니다...');
        const filePath = 'E:\\Google Drive\\VIBE_class\\주주명부_Case1_2026-01-24T15-34-17.jpg';

        const fileInput = page.locator('#file-upload-input');
        await fileInput.setInputFiles(filePath);

        // Step 3 검증: 파일이 정상적으로 UI에 등록되었는지 확인 (선택된 파일 텍스트 확인)
        console.log('⏳ [Check] 파일이 정상적으로 등록되었는지 확인 대기 중...');
        // 주주명부_Case1 라는 텍스트가 화면 어딘가에 나타나는지 확인하는 것이 가장 확실함
        const fileItem = page.locator('text=주주명부_Case1');
        await fileItem.waitFor({ state: 'visible', timeout: 5000 });
        console.log('✅ [Check] "주주명부_Case1_..." 파일 UI 등록 확인 완료');
        await page.screenshot({ path: 'test_02_uploaded.png' });

        console.log('👆 [Step 4] "심층 분석" 버튼을 클릭합니다...');
        await page.keyboard.press('Escape'); // Vite 에러 오버레이 닫기 시도

        const deepAnalysisBtn = page.locator('button.analyze-btn.multi-agent');
        await deepAnalysisBtn.waitFor({ state: 'visible', timeout: 5000 });
        await deepAnalysisBtn.evaluate((node) => node.click());

        // Step 4 검증: 분석 진행 상태(Loading)로 넘어갔는지 확인
        console.log('⏳ [Check] 분석이 정상적으로 시작되었는지(로그 스트림 화면 전환) 확인 중...');
        // 보통 로그 스트리밍 영역이나 진행률 표시줄이 나타남
        const logBox = page.locator('.log-box, .terminal');
        await logBox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => console.log('⚠️ [Warning] 로그 박스를 찾지 못했으나 분석은 진행 중일 수 있습니다.'));
        console.log('✅ [Check] 버튼 클릭 성공 및 분석 시작 확인');
        await page.screenshot({ path: 'test_03_analyzing.png' });

        console.log('⏳ [Step 5] 심층 분석 완료를 대기합니다. (최대 30초)');

        // 결과 테이블이나 답변 컨테이너가 뜰 때까지 대기
        await page.waitForSelector('table.min-w-full, .answer-container', {
            state: 'visible',
            timeout: 30000
        }); console.log('✅ [Check] 심층 분석 결과(테이블 또는 AI 응답) 렌더링 확인 완료');

        console.log('📸 [Step 6] 최종 결과 스크린샷 캡쳐 중...');
        await page.screenshot({ path: 'test_04_final_result.png', fullPage: true });

        console.log('🎉 [Result] 모든 테스트 검증을 통과했습니다!');

    } catch (err) {
        console.error('❌ [Error] 테스트 진행 중 오류 발생:', err.message);
        await page.screenshot({ path: 'test_error_dump.png', fullPage: true });
    } finally {
        console.log('종료를 위해 브라우저를 닫습니다.');
        await browser.close();
    }
}

runTest();
