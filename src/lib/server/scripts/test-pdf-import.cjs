
const path = require('path');
const { pathToFileURL } = require('url');

console.log('1. Starting test');

async function test() {
    try {
        console.log('2. Importing pdfjs-dist...');
        const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
        console.log('3. Import success');

        const pdfjs = pdfjsModule.default || pdfjsModule;
        const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions || pdfjsModule.GlobalWorkerOptions;

        console.log('4. Setting worker...');
        const workerPath = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
        console.log('Worker Path:', workerPath);
        GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
        console.log('5. Worker set:', GlobalWorkerOptions.workerSrc);

    } catch (e) {
        console.error('ERROR:', e);
    }
}

test();
