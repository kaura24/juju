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
import { spawn } from 'child_process';
import { join } from 'path';

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
 * PDF 파일을 이미지(Base64) 배열로 변환 - 프로세스 격리 모드 (Child Process)
 * - 멱등성 및 안정성 확보를 위해 독립 프로세스에서 실행
 */
export async function convertPdfToImages(filePath: string): Promise<{ base64: string; mimeType: string }[]> {
    console.log(`[Converter] Converting PDF via Isolated Process: ${filePath}`);

    return new Promise((resolve, reject) => {
        const scriptPath = join(process.cwd(), 'scripts', 'pdf-to-images.cjs');
        // Spawn doesn't have maxBuffer, it's a stream.
        const child = spawn('node', [scriptPath, filePath], {
            env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' }
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
            console.error(`[Converter-Child-Stderr] ${chunk.toString()}`);
        });

        child.on('close', (code: number) => {
            const stdoutData = Buffer.concat(stdoutChunks).toString();
            const stderrData = Buffer.concat(stderrChunks).toString();

            if (code === 0) {
                try {
                    const images = JSON.parse(stdoutData.trim());
                    console.log(`[Converter] Isolated Process Success. Retrieved ${images.length} pages.`);
                    resolve(images);
                } catch (e: any) {
                    console.error('[Converter] JSON Parse Fail. Stdout length:', stdoutData.length);
                    reject(new Error(`Failed to parse bridge output: ${e.message}`));
                }
            } else {
                reject(new Error(`Isolated converter failed with code ${code}. Stderr: ${stderrData}`));
            }
        });

        child.on('error', (err: Error) => {
            reject(new Error(`Failed to start isolated converter: ${err.message}`));
        });
    });
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
export async function prepareImagesForAnalysis(filePath: string): Promise<{ base64: string; mimeType: string }[]> {
    const ext = filePath.toLowerCase().split('.').pop();

    if (ext === 'pdf') {
        return await convertPdfToImages(filePath);
    } else if (ext === 'tif' || ext === 'tiff') {
        return await convertTiffToImages(filePath);
    } else {
        // 일반 이미지
        const buffer = await readFile(filePath);
        let base64 = buffer.toString('base64');
        const mimeTypes: Record<string, string> = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'gif': 'image/gif', 'webp': 'image/webp'
        };
        let mimeType = mimeTypes[ext || ''] || 'image/png';

        // Resize check
        base64 = await resizeImageIfNeeded(base64, mimeType);

        // Ensure mimeType is updated to jpeg if we converted it
        // resizeImageIfNeeded always returns jpeg base64
        mimeType = 'image/jpeg';

        return [{ base64, mimeType }];
    }
}
