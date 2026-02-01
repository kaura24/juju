
const { createCanvas, Image } = require('@napi-rs/canvas');
console.log('1. Canvas loaded');

try {
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 100, 100);
    console.log('2. Canvas draw success');
    const buf = canvas.toBuffer('image/png');
    console.log('3. Buffer created, size:', buf.length);
} catch (e) {
    console.error('Canvas error:', e);
}
