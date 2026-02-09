/**
 * PDF to Image Isolated Converter
 * Run via: node scripts/pdf-to-images.js <filePath>
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

async function run() {
    console.error('Starting conversion...');
    const mode = process.argv[2];
    const label = process.argv[3] || 'stdin';

    let dataBuffer;
    if (mode === '--base64') {
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        const base64 = Buffer.concat(chunks).toString().trim();
        if (!base64) {
            console.error('No base64 data provided on stdin');
            process.exit(1);
        }
        dataBuffer = Buffer.from(base64, 'base64');
        console.error(`Processing buffer input: ${label}`);
    } else {
        const filePath = mode;
        if (!filePath) {
            console.error('No file path provided');
            process.exit(1);
        }
        console.error(`Processing file: ${filePath}`);
        dataBuffer = fs.readFileSync(filePath);
    }

    try {
        // Load PDF.js (CommonJS in v3)
        const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
        const getDocument = pdfjs.getDocument;
        const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;

        // Configure worker
        GlobalWorkerOptions.workerSrc = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.js');

        const canvasFactory = new NodeCanvasFactory();

        const loadingTask = getDocument({
            data: new Uint8Array(dataBuffer),
            cMapUrl: path.join(__dirname, '../node_modules/pdfjs-dist/cmaps/'),
            cMapPacked: true,
            canvasFactory: canvasFactory,
            disableFontFace: true
        });

        const pdf = await loadingTask.promise;
        const images = [];

        console.error(`PDF loaded. Pages: ${pdf.numPages}`);

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
        }

        await pdf.destroy();

        // Output result to stdout (Restore log for a moment if needed, or just use process.stdout.write)
        process.stdout.write(JSON.stringify(images));
        process.exit(0);
    } catch (err) {
        console.error('Conversion Error:', err);
        // Ensure error logging is visible
        if (err.stack) console.error(err.stack);
        process.exit(1);
    }
}

run();
