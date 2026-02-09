/** File: src/lib/server/services/converter.ts */
/**
 * 파일 변환 서비스
 * - PDF -> Image (PNG/JPG)
 * - TIFF -> Image (PNG/JPG)
 * - AI가 직접 읽지 못하는 형식을 분석 가능하게 변환
 */

import { createCanvas, Image, loadImage } from '@napi-rs/canvas';
import * as UTIF from 'utif';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Fix for pdfjs-dist in Node.js - set global Image
if (typeof global !== 'undefined') {
    (global as any).Image = Image;
}

/**
 * 이미지 리사이징/보정 헬퍼 (받침 인식 개선)
 * 개발 환경에서는 자동으로 fast 모드 적용
 */
const isDevelopment = process.env.NODE_ENV === 'development';

// 개발 모드: 전처리 최소화로 속도 향상
const OCR_UPSCALE_FACTOR = Number(process.env.OCR_UPSCALE_FACTOR || (isDevelopment ? '1.0' : '1.8'));
const OCR_CONTRAST = Number(process.env.OCR_CONTRAST || (isDevelopment ? '1.0' : '1.3'));
const OCR_SHARPEN = Number(process.env.OCR_SHARPEN || (isDevelopment ? '0' : '0.6'));

// 개발 모드: fast 프리셋 자동 적용
const OCR_PRESET = (process.env.OCR_PRESET || (isDevelopment ? 'fast' : 'balanced')).toLowerCase();
const PRESET_CONFIG: Record<string, { maxDimension: number; jpegQuality: number }> = {
    fast: { maxDimension: 1800, jpegQuality: 70 },      // 속도 우선
    balanced: { maxDimension: 3000, jpegQuality: 85 },
    quality: { maxDimension: 3500, jpegQuality: 92 }
};
const ACTIVE_PRESET = PRESET_CONFIG[OCR_PRESET] || PRESET_CONFIG.balanced;

console.log(`[Converter] Preset: ${OCR_PRESET.toUpperCase()} (maxDim=${ACTIVE_PRESET.maxDimension}, upscale=${OCR_UPSCALE_FACTOR}, contrast=${OCR_CONTRAST}, sharpen=${OCR_SHARPEN})`);


async function resizeImageIfNeeded(
    base64: string,
    mimeType: string,
    maxDimension: number = ACTIVE_PRESET.maxDimension,
    upscaleFactor: number = OCR_UPSCALE_FACTOR,
    contrast: number = OCR_CONTRAST,
    sharpen: number = OCR_SHARPEN
): Promise<string> {
    const buffer = Buffer.from(base64, 'base64');
    const image = await loadImage(buffer);

    // Check dimensions
    const longest = Math.max(image.width, image.height);
    let scale = 1;

    if (longest > maxDimension) {
        scale = maxDimension / longest;
    } else if (upscaleFactor > 1) {
        // Upscale only when within max dimension
        scale = Math.min(upscaleFactor, maxDimension / longest);
    }

    if (scale === 1 && contrast === 1 && sharpen === 0) {
        return base64; // No resize or enhancement needed
    }

    // Calculate new size
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    if (scale !== 1) {
        console.log(`[Converter] Resizing image from ${image.width}x${image.height} to ${width}x${height} (preset=${OCR_PRESET})`);
    } else {
        console.log(`[Converter] Image size ${image.width}x${image.height} (preset=${OCR_PRESET})`);
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    if (contrast !== 1) {
        // Simple contrast enhancement for better Hangul 받침 visibility
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, Math.round((data[i] - 128) * contrast + 128)));
            data[i + 1] = Math.min(255, Math.max(0, Math.round((data[i + 1] - 128) * contrast + 128)));
            data[i + 2] = Math.min(255, Math.max(0, Math.round((data[i + 2] - 128) * contrast + 128)));
        }
        ctx.putImageData(imageData, 0, 0);
    }

    if (sharpen > 0) {
        // Unsharp mask (simple) to emphasize thin strokes
        const src = ctx.getImageData(0, 0, width, height);
        const dst = ctx.createImageData(width, height);
        const s = src.data;
        const d = dst.data;
        const w = width;
        const h = height;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const center = s[idx + c];
                    const top = s[idx + c - w * 4];
                    const bottom = s[idx + c + w * 4];
                    const left = s[idx + c - 4];
                    const right = s[idx + c + 4];
                    const lap = (top + bottom + left + right - 4 * center);
                    const val = Math.min(255, Math.max(0, Math.round(center - sharpen * lap)));
                    d[idx + c] = val;
                }
                d[idx + 3] = s[idx + 3];
            }
        }
        ctx.putImageData(dst, 0, 0);
    }

    const quality = ACTIVE_PRESET.jpegQuality;
    const outputBuffer = canvas.toBuffer('image/jpeg', quality);
    if (scale !== 1 || contrast !== 1 || sharpen > 0) {
        console.log(`[Converter] JPEG bytes=${outputBuffer.length}, quality=${quality}, preset=${OCR_PRESET}`);
    }

    return outputBuffer.toString('base64');
}

/**
 * PDF 파일을 이미지(Base64) 배열로 변환 - v2.0 (Memory-based, stdin 모드)
 * - 메모리 및 안정성 확보를 위해 독립 프로세스에서 실행
 * - stdin으로 Base64 전달하여 임시 파일 불필요 (서버리스 최적화)
 */
export async function convertPdfToImagesFromBuffer(
    pdfBuffer: Buffer,
    sourceLabel: string
): Promise<{ base64: string; mimeType: string }[]> {
    const startTime = Date.now();
    const bufferSizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(2);

    console.log(`[Converter] Converting PDF via stdin (Memory-based): ${sourceLabel}`);
    console.log(`[Converter] Buffer size: ${bufferSizeMB} MB`);

    return new Promise((resolve, reject) => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        // 스크립트 경로 탐색 (src/lib/server/services -> scripts)
        const scriptPath = join(__dirname, '..', '..', '..', '..', 'scripts', 'pdf-to-images.cjs');

        console.log(`[Converter] Script path: ${scriptPath}`);
        console.log(`[Converter] Mode: stdin (--stdin) - No temp files`);

        // --stdin 모드로 실행 (Base64를 stdin으로 전달)
        const child = spawn('node', [scriptPath, '--stdin'], {
            env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' }
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
            // 진행 로그만 출력 (에러 아님)
            const msg = chunk.toString().trim();
            if (msg.includes('[PDF-Converter]')) {
                console.log(msg);
            }
        });

        child.on('close', (code: number) => {
            const duration = Date.now() - startTime;
            const stdoutData = Buffer.concat(stdoutChunks).toString();
            const stderrData = Buffer.concat(stderrChunks).toString();

            if (code === 0) {
                try {
                    const images = JSON.parse(stdoutData.trim());
                    console.log(`[Converter] ✅ Success! ${images.length} pages in ${duration}ms`);
                    resolve(images);
                } catch (e: any) {
                    console.error('[Converter] JSON Parse Fail. Stdout length:', stdoutData.length);
                    reject(new Error(`Failed to parse bridge output: ${e.message}`));
                }
            } else {
                console.error(`[Converter] ❌ Failed with code ${code}`);
                reject(new Error(`Isolated converter failed with code ${code}. Stderr: ${stderrData}`));
            }
        });

        child.on('error', (err: Error) => {
            reject(new Error(`Failed to start isolated converter: ${err.message}`));
        });

        // stdin으로 Base64 데이터 전달
        child.stdin.write(pdfBuffer.toString('base64'));
        child.stdin.end();
    });
}

/**
 * TIFF 파일을 이미지(Base64)로 변환
 */
export async function convertTiffToImagesFromBuffer(
    tiffBuffer: Buffer,
    sourceLabel: string
): Promise<{ base64: string; mimeType: string }[]> {
    console.log(`[Converter] Converting TIFF (buffer): ${sourceLabel}`);
    const ifds = UTIF.decode(tiffBuffer);
    const images: { base64: string; mimeType: string }[] = [];

    for (let i = 0; i < ifds.length; i++) {
        UTIF.decodeImage(tiffBuffer, ifds[i]);
        const rgba = UTIF.toRGBA8(ifds[i]);

        const canvas = createCanvas(ifds[i].width, ifds[i].height);
        const ctx = canvas.getContext('2d');

        const imageData = ctx.createImageData(ifds[i].width, ifds[i].height);
        imageData.data.set(new Uint8ClampedArray(rgba));
        ctx.putImageData(imageData, 0, 0);

        let finalBase64 = canvas.toBuffer('image/jpeg', 85).toString('base64');
        const mimeType = 'image/jpeg';

        // Resize check
        finalBase64 = await resizeImageIfNeeded(finalBase64, mimeType);

        images.push({ base64: finalBase64, mimeType });
        console.log(`[Converter] TIFF Frame ${i} rendered`);
    }

    return images;
}

/**
 * 파일 확장자에 따라 적절한 분석용 이미지 추출 (멀티파트 가능성 고려)
 */
// Helper to download URL into memory (no local temp files)
async function downloadUrlToBuffer(url: string): Promise<{ buffer: Buffer; contentType: string | null; ext: string }> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);

    const contentType = response.headers.get('content-type');
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = url.split('?')[0].split('.').pop() || '';
    return { buffer, contentType, ext };
}

/**
 * 파일 확장자에 따라 적절한 분석용 이미지 추출 (멀티파트 가능성 고려)
 * URL이 입력된 경우 (Vercel 환경), 임시 파일로 다운로드 후 처리
 */
export async function prepareImagesForAnalysis(filePathOrUrl: string): Promise<{ base64: string; mimeType: string }[]> {
    if (!filePathOrUrl.startsWith('http://') && !filePathOrUrl.startsWith('https://')) {
        throw new Error('[Converter] Local file paths are disabled. Expected a remote URL.');
    }

    console.log(`[Converter] Downloading remote file: ${filePathOrUrl}`);
    const { buffer, contentType, ext } = await downloadUrlToBuffer(filePathOrUrl);
    const normalizedExt = ext.toLowerCase();
    let result: { base64: string; mimeType: string }[] = [];

    if (normalizedExt === 'pdf') {
        result = await convertPdfToImagesFromBuffer(buffer, filePathOrUrl);
    } else if (normalizedExt === 'tif' || normalizedExt === 'tiff') {
        result = await convertTiffToImagesFromBuffer(buffer, filePathOrUrl);
    } else {
        const mimeTypes: Record<string, string> = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'gif': 'image/gif', 'webp': 'image/webp'
        };
        let mimeType = mimeTypes[normalizedExt || ''] || contentType || 'image/png';
        let base64 = buffer.toString('base64');

        base64 = await resizeImageIfNeeded(base64, mimeType);
        mimeType = 'image/jpeg';
        result = [{ base64, mimeType }];
    }

    return result;
}
