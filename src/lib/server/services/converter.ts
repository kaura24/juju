/** File: src/lib/server/services/converter.ts */
/**
 * 파일 변환 서비스
 * - PDF -> Image (PNG/JPG)
 * - TIFF -> Image (PNG/JPG)
 * - AI가 직접 읽지 못하는 형식을 분석 가능하게 변환
 */

import { readFile } from 'fs/promises';
import { createCanvas, Image } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as UTIF from 'utif';

// Fix for pdfjs-dist in Node.js - set global Image
if (typeof global !== 'undefined') {
    (global as any).Image = Image;
}

// Custom CanvasFactory for pdfjs-dist 4.x in Node.js
class NodeCanvasFactory {
    create(width: number, height: number) {
        if (width <= 0 || height <= 0) {
            throw new Error(`Invalid canvas size: ${width} x ${height}`);
        }
        const canvas = createCanvas(width, height);
        (canvas as any).style = {};  // PDF.js expects a style property
        const context = canvas.getContext('2d');
        return { canvas, context };
    }

    reset(canvasAndContext: any, width: number, height: number) {
        if (!canvasAndContext.canvas) {
            throw new Error('Canvas is not specified');
        }
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }

    destroy(canvasAndContext: any) {
        if (canvasAndContext.canvas) {
            canvasAndContext.canvas.width = 0;
            canvasAndContext.canvas.height = 0;
        }
    }
}

const canvasFactory = new NodeCanvasFactory();

// PDF.js loading helper (Node.js compatibility)
async function getPdfDocument(data: Buffer) {
    return await (pdfjs as any).getDocument({
        data: new Uint8Array(data),
        useSystemFonts: true,
        disableFontFace: true,
        canvasFactory: canvasFactory
    }).promise;
}

/**
 * PDF 파일을 이미지(Base64) 배열로 변환
 */
export async function convertPdfToImages(filePath: string): Promise<{ base64: string; mimeType: string }[]> {
    console.log(`[Converter] Converting PDF: ${filePath}`);
    const data = await readFile(filePath);
    const pdf = await getPdfDocument(data);
    const images: { base64: string; mimeType: string }[] = [];

    console.log(`[Converter] PDF loaded: ${pdf.numPages} pages`);

    // 모든 페이지 변환
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for better OCR

        const { canvas, context } = canvasFactory.create(
            Math.floor(viewport.width),
            Math.floor(viewport.height)
        );

        console.log(`[Converter] Rendering page ${i}:`, { width: viewport.width, height: viewport.height });
        try {
            await page.render({
                canvasContext: context as any,
                viewport: viewport,
                canvasFactory: canvasFactory
            }).promise;
        } catch (renderErr) {
            console.error(`[Converter] Render Error on page ${i}:`, renderErr);
            throw renderErr;
        }

        images.push({
            base64: (canvas as any).toBuffer('image/png').toString('base64'),
            mimeType: 'image/png'
        });
        console.log(`[Converter] Page ${i} rendered`);
    }

    return images;
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

        images.push({
            base64: canvas.toBuffer('image/png').toString('base64'),
            mimeType: 'image/png'
        });
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
        // 일반 이미지는 그대로 반환 (배열로 감싸서)
        const buffer = await readFile(filePath);
        const base64 = buffer.toString('base64');
        const mimeTypes: Record<string, string> = {
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'gif': 'image/gif', 'webp': 'image/webp'
        };
        return [{
            base64,
            mimeType: mimeTypes[ext || ''] || 'image/png'
        }];
    }
}
