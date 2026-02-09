/**
 * PDF to Image Isolated Converter - v2.0 (Memory-based)
 * 
 * Usage:
 *   Mode 1 (stdin): node scripts/pdf-to-images.cjs --stdin
 *     - Base64 데이터를 stdin으로 받아 메모리에서 처리
 *     - 서버리스 환경 최적화 (임시 파일 불필요)
 * 
 *   Mode 2 (file): node scripts/pdf-to-images.cjs <filePath>
 *     - 기존 파일 경로 기반 처리 (로컬 개발용)
 * 
 * [CRITICAL MAINTAINER NOTE]
 * This script is tightly coupled with pdfjs-dist v3.11.174.
 * DO NOT UPGRADE pdfjs-dist without thorough testing of "canvas" module compatibility.
 * DO NOT REMOVE console.log/warn overrides below - they prevent JSON corruption.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require('@napi-rs/canvas');

// Redirect all logs to stderr to keep stdout clean for JSON
console.log = console.error;
console.warn = console.error;

// Fix for pdfjs-dist in Node.js
global.Image = Image;

class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);
        canvas.style = {};
        const context = canvas.getContext('2d');
        return { canvas, context };
    }
    reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }
    destroy(canvasAndContext) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
    }
}

/**
 * PDF Buffer를 이미지 배열로 변환
 */
async function convertPdfBuffer(pdfBuffer) {
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    const getDocument = pdfjs.getDocument;
    const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;

    // Configure worker
    GlobalWorkerOptions.workerSrc = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.js');

    const canvasFactory = new NodeCanvasFactory();

    const loadingTask = getDocument({
        data: new Uint8Array(pdfBuffer),
        cMapUrl: path.join(__dirname, '../node_modules/pdfjs-dist/cmaps/'),
        cMapPacked: true,
        canvasFactory: canvasFactory,
        disableFontFace: true
    });

    const pdf = await loadingTask.promise;
    const images = [];

    console.error(`[PDF-Converter] PDF loaded. Pages: ${pdf.numPages}`);

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewportRaw = page.getViewport({ scale: 1.0 });
        const MAX_DIM = 2048;
        let scale = 2.0;

        if (viewportRaw.width * scale > MAX_DIM || viewportRaw.height * scale > MAX_DIM) {
            scale = Math.min(MAX_DIM / viewportRaw.width, MAX_DIM / viewportRaw.height);
        }

        const viewport = page.getViewport({ scale });
        const { canvas, context } = canvasFactory.create(
            Math.floor(viewport.width),
            Math.floor(viewport.height)
        );

        await page.render({
            canvasContext: context,
            viewport: viewport,
            canvasFactory: canvasFactory
        }).promise;

        images.push({
            base64: canvas.toBuffer('image/jpeg', 80).toString('base64'),
            mimeType: 'image/jpeg'
        });

        canvasFactory.destroy({ canvas });
        if (page.cleanup) page.cleanup();

        console.error(`[PDF-Converter] Page ${i}/${pdf.numPages} converted`);
    }

    await pdf.destroy();
    return images;
}

/**
 * stdin에서 Base64 데이터 읽기
 */
function readStdinBase64() {
    return new Promise((resolve, reject) => {
        const chunks = [];

        process.stdin.on('data', (chunk) => {
            chunks.push(chunk);
        });

        process.stdin.on('end', () => {
            const base64Data = Buffer.concat(chunks).toString('utf8').trim();
            resolve(base64Data);
        });

        process.stdin.on('error', (err) => {
            reject(err);
        });

        // 30초 타임아웃
        setTimeout(() => {
            reject(new Error('stdin read timeout (30s)'));
        }, 30000);
    });
}

async function run() {
    console.error('[PDF-Converter] Starting conversion...');

    const args = process.argv.slice(2);
    const isStdinMode = args.includes('--stdin') || args.includes('--base64');

    let pdfBuffer;

    try {
        if (isStdinMode) {
            // Mode 1: stdin에서 Base64 데이터 읽기
            console.error('[PDF-Converter] Mode: STDIN (Memory-based, serverless optimized)');
            const base64Data = await readStdinBase64();

            if (!base64Data || base64Data.length === 0) {
                throw new Error('No data received from stdin');
            }

            console.error(`[PDF-Converter] Received ${base64Data.length} chars of base64 data`);
            pdfBuffer = Buffer.from(base64Data, 'base64');

        } else {
            // Mode 2: 파일 경로에서 읽기 (기존 방식, 로컬 개발용)
            const filePath = args[0];
            if (!filePath) {
                console.error('Usage:');
                console.error('  Mode 1 (stdin):  node pdf-to-images.cjs --stdin < input.pdf.b64');
                console.error('  Mode 2 (file):   node pdf-to-images.cjs <filePath>');
                process.exit(1);
            }

            console.error(`[PDF-Converter] Mode: FILE (path=${filePath})`);
            pdfBuffer = fs.readFileSync(filePath);
        }

        console.error(`[PDF-Converter] Buffer size: ${pdfBuffer.length} bytes`);

        const images = await convertPdfBuffer(pdfBuffer);

        console.error(`[PDF-Converter] Success! Converted ${images.length} pages`);

        // Output result to stdout
        process.stdout.write(JSON.stringify(images));
        process.exit(0);

    } catch (err) {
        console.error('[PDF-Converter] Conversion Error:', err.message);
        if (err.stack) console.error(err.stack);
        process.exit(1);
    }
}

run();

