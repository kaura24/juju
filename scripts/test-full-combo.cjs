
const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require('@napi-rs/canvas');
const { pathToFileURL } = require('url');

console.log('1. Modules loaded');
global.Image = Image;

class NodeCanvasFactory {
    create(width, height) {
        console.log('   -> Factory create called');
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
    try {
        console.log('2. Importing PDFJS (v3/CJS)');
        const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
        const getDocument = pdfjs.getDocument;
        const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;

        console.log('3. Setting Worker');
        // v3 legacy worker is pdf.worker.js
        GlobalWorkerOptions.workerSrc = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.js');

        console.log('4. Reading File');
        const filePath = "c:\\Gdrive\\VIBE_class\\JuJu\\uploads\\1a04746e-6e2b-4b89-a471-5b859d8c7e2a_주주명부3.pdf";
        const data = fs.readFileSync(filePath);
        console.log('5. File read success, size:', data.length);

        const canvasFactory = new NodeCanvasFactory();

        console.log('6. Calling getDocument');
        const loadingTask = getDocument({
            data: new Uint8Array(data),
            cMapUrl: path.join(__dirname, '../node_modules/pdfjs-dist/cmaps/'),
            cMapPacked: true,
            canvasFactory: canvasFactory, // Supported in v3
            disableFontFace: true
        });

        console.log('7. Awaiting promise');
        const pdf = await loadingTask.promise;
        console.log('8. PDF Loaded, pages:', pdf.numPages);

        const page = await pdf.getPage(1);
        console.log('9. Page 1 loaded');

        const viewport = page.getViewport({ scale: 1.0 });
        console.log('10. Viewport created');

        const { canvas, context } = canvasFactory.create(
            Math.floor(viewport.width),
            Math.floor(viewport.height)
        );

        console.log('11. Rendering...');
        await page.render({
            canvasContext: context,
            viewport: viewport,
            canvasFactory: canvasFactory
        }).promise;
        console.log('12. Render success');

        const buf = canvas.toBuffer('image/jpeg', 80);
        console.log('13. Buffer created:', buf.length);

    } catch (e) {
        console.error('ERROR CAUGHT:', e);
    }
}

run();
