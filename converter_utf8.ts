/** File: src/lib/server/services/converter.ts */
/**
 * ?뚯씪 蹂???쒕퉬?? * - PDF -> Image (PNG/JPG)
 * - TIFF -> Image (PNG/JPG)
 * - AI媛 吏곸젒 ?쎌? 紐삵븯???뺤떇??遺꾩꽍 媛?ν븯寃?蹂?? */

import { readFile } from 'fs/promises';
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
 * ?대?吏 由ъ궗?댁쭠 ?ы띁 (OOM 諛⑹?)
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
 * PDF ?뚯씪???대?吏(Base64) 諛곗뿴濡?蹂??- ?꾨줈?몄뒪 寃⑸━ 紐⑤뱶 (Child Process)
 * - 硫깅벑??諛??덉젙???뺣낫瑜??꾪빐 ?낅┰ ?꾨줈?몄뒪?먯꽌 ?ㅽ뻾
 */
export async function convertPdfToImages(filePath: string): Promise<{ base64: string; mimeType: string }[]> {
    console.log(`[Converter] Converting PDF via Isolated Process: ${filePath}`);

    return new Promise((resolve, reject) => {
        // ESM ?섍꼍?먯꽌 __dirname ?泥?        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        // ?꾩옱 ?뚯씪(converter.ts)???꾩튂: src/lib/server/services/
        // scripts ?대뜑 ?꾩튂: src/lib/server/scripts/
        // ?곕씪??../scripts/pdf-to-images.cjs濡??묎렐
        const scriptPath = join(__dirname, '..', 'scripts', 'pdf-to-images.cjs');

        console.log(`[Converter] Script path: ${scriptPath}`);
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
 * TIFF ?뚯씪???대?吏(Base64)濡?蹂?? */
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
 * ?뚯씪 ?뺤옣?먯뿉 ?곕씪 ?곸젅??遺꾩꽍???대?吏 異붿텧 (硫?고뙆??媛?μ꽦 怨좊젮)
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
 * ?뚯씪 ?뺤옣?먯뿉 ?곕씪 ?곸젅??遺꾩꽍???대?吏 異붿텧 (硫?고뙆??媛?μ꽦 怨좊젮)
 * URL???낅젰??寃쎌슦 (Vercel ?섍꼍), ?꾩떆 ?뚯씪濡??ㅼ슫濡쒕뱶 ??泥섎━
 */
export async function prepareImagesForAnalysis(filePathOrUrl: string): Promise<{ base64: string; mimeType: string }[]> {
    let targetPath = filePathOrUrl;
    let isTemp = false;

    try {
        // URL 媛먯? 諛??ㅼ슫濡쒕뱶
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
            // ?쇰컲 ?대?吏
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
        // ?꾩떆 ?뚯씪 ?뺣━
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
