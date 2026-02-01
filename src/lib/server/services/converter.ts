/** File: src/lib/server/services/converter.ts */
/**
 * 파일 변환 서비스
 * - PDF -> Image (PNG/JPG)
 * - TIFF -> Image (PNG/JPG)
 * - AI가 직접 읽지 못하는 형식을 분석 가능하게 변환
 */

import { readFile } from 'fs/promises';
import { createCanvas, Image, loadImage } from '@napi-rs/canvas';
import * as UTIF from 'utif';
<<<<<<< Updated upstream
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
=======
import { join } from 'path';
import { createRequire } from 'module';
>>>>>>> Stashed changes

// Fix for pdfjs-dist in Node.js - set global Image
if (typeof global !== 'undefined') {
    (global as any).Image = Image;
}

/**
 * 이미지 리사이징 헬퍼 (OOM 방지)
 */
async function resizeImageIfNeeded(base64: string, mimeType: string, maxDimension: number = 2048): Promise<string> {
    const buffer = Buffer.from(base64, 'base64');
    const image = await loadImage(buffer);

    // Check dimensions
    if (image.width <= maxDimension && image.height <= maxDimension) {
        return base64; // No resize needed
    }

    // Calculate new size
    let width = image.width;
    let height = image.height;
    if (width > height) {
        if (width > maxDimension) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
        }
    } else {
        if (height > maxDimension) {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
        }
    }

    console.log(`[Converter] Resizing image from ${image.width}x${image.height} to ${width}x${height}`);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toBuffer('image/jpeg', 85).toString('base64');
}

/**
 * PDF 파일을 이미지(Base64) 배열로 변환 - Inline Processing (No Temp Files)
 * - Vercel 호환성을 위해 메모리 내에서 직접 처리
 * - pdfjs-dist의 dynamic load 문제 해결을 위해 createRequire 사용
 */
export async function convertPdfToImages(filePath: string): Promise<{ base64: string; mimeType: string }[]> {
    console.log(`[Converter] Converting PDF Inline: ${filePath}`);

<<<<<<< Updated upstream
    return new Promise((resolve, reject) => {
        // ESM 환경에서 __dirname 대체
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        // 현재 파일(converter.ts)의 위치: src/lib/server/services/
        // scripts 폴더 위치: src/lib/server/scripts/
        // 따라서 ../scripts/pdf-to-images.cjs로 접근
        const scriptPath = join(__dirname, '..', 'scripts', 'pdf-to-images.cjs');

        console.log(`[Converter] Script path: ${scriptPath}`);
        // Spawn doesn't have maxBuffer, it's a stream.
        const child = spawn('node', [scriptPath, filePath], {
            env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' }
=======
    try {
        const require = createRequire(import.meta.url);

        // Dynamically load pdfjs-dist to avoid ESM/CJS conflicts at build time
        // We use the specific 'legacy' build for better Node compatibility usually,
        // or the standard build depending on the version. 
        // Trying standard first, then fallback to legacy if needed. 
        // Note: In Vercel, node_modules should be available.
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

        // Load data into a Uint8Array
        const dataBuffer = await readFile(filePath);
        const data = new Uint8Array(dataBuffer);

        // Load PDF Document
        const loadingTask = pdfjsLib.getDocument({
            data,
            cMapUrl: 'node_modules/pdfjs-dist/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/'
>>>>>>> Stashed changes
        });

        const doc = await loadingTask.promise;
        const totalPages = doc.numPages;
        console.log(`[Converter] PDF loaded. Total pages: ${totalPages}`);

        const images: { base64: string; mimeType: string }[] = [];

        // Limit pages to avoid timeout on Vercel (e.g., max 5 pages)
        // User can request more, but for safety in synchronous flow:
        const MAX_PAGES = 5;
        const pagesToProcess = Math.min(totalPages, MAX_PAGES);

        if (totalPages > MAX_PAGES) {
            console.warn(`[Converter] PDF has ${totalPages} pages. Only processing first ${MAX_PAGES} to prevent timeout.`);
        }

        for (let i = 1; i <= pagesToProcess; i++) {
            const page = await doc.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for quality

            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');

            await page.render({
                canvasContext: context as any, // Type mismatch workaround
                viewport: viewport
            }).promise;

            let base64 = canvas.toBuffer('image/jpeg', 85).toString('base64');
            const mimeType = 'image/jpeg';

            // Resize if needed (keep it consistent)
            base64 = await resizeImageIfNeeded(base64, mimeType);

            images.push({ base64, mimeType });
            console.log(`[Converter] Page ${i} renered`);
        }

        return images;

    } catch (error: any) {
        console.error(`[Converter] Inline PDF conversion failed:`, error);
        throw new Error(`PDF conversion error: ${error.message}`);
    }
}

/**
 * TIFF 파일을 이미지(Base64)로 변환
 */
export async function convertTiffToImages(filePath: string): Promise<{ base64: string; mimeType: string }[]> {
    console.log(`[Converter] Converting TIFF: ${filePath}`);
    const data = await readFile(filePath);
    const ifds = UTIF.decode(data);
    const images: { base64: string; mimeType: string }[] = [];

    for (let i = 0; i < ifds.length; i++) {
        UTIF.decodeImage(data, ifds[i]);
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
// Helper to download URL to tmp file
async function downloadUrlToTmp(url: string, ext: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempName = `download_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const { tmpdir } = await import('os');
    const tempPath = join(tmpdir(), tempName);

    await import('fs/promises').then(fs => fs.writeFile(tempPath, buffer));
    return tempPath;
}

/**
 * 파일 확장자에 따라 적절한 분석용 이미지 추출 (멀티파트 가능성 고려)
 * URL이 입력된 경우 (Vercel 환경), 임시 파일로 다운로드 후 처리
 */
export async function prepareImagesForAnalysis(filePathOrUrl: string): Promise<{ base64: string; mimeType: string }[]> {
    let targetPath = filePathOrUrl;
    let isTemp = false;

    try {
        // URL 감지 및 다운로드
        if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')) {
            console.log(`[Converter] Downloading remote file: ${filePathOrUrl}`);
            const ext = filePathOrUrl.split('?')[0].split('.').pop() || 'tmp';
            targetPath = await downloadUrlToTmp(filePathOrUrl, ext);
            isTemp = true;
        }

        const ext = targetPath.toLowerCase().split('.').pop();
        let result: { base64: string; mimeType: string }[] = [];

        if (ext === 'pdf') {
            result = await convertPdfToImages(targetPath);
        } else if (ext === 'tif' || ext === 'tiff') {
            result = await convertTiffToImages(targetPath);
        } else {
            // 일반 이미지
            const buffer = await readFile(targetPath);
            let base64 = buffer.toString('base64');
            const mimeTypes: Record<string, string> = {
                'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp'
            };
            let mimeType = mimeTypes[ext || ''] || 'image/png';

            // Resize check
            base64 = await resizeImageIfNeeded(base64, mimeType);
            mimeType = 'image/jpeg'; // Resized is always jpeg

            result = [{ base64, mimeType }];
        }

        return result;

    } finally {
        // 임시 파일 정리
        if (isTemp) {
            try {
                await import('fs/promises').then(fs => fs.unlink(targetPath));
                console.log(`[Converter] Cleaned up temp file: ${targetPath}`);
            } catch (e) {
                console.warn(`[Converter] Failed to cleanup temp file: ${targetPath}`);
            }
        }
    }
}
