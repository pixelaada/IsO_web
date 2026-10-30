const video = document.getElementById('bg-video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const asciiOutput = document.getElementById('ascii-output');

const chars = " .:-=+*#%@";
const scale = 0.75;

function resizeCanvas() {
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale * 0.5;
    asciiOutput.style.fontSize = `${Math.max(6, 8 * scale)}px`;
}

function renderFrame() {
    if (video.paused || video.ended) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let ascii = '';
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const charIndex = Math.floor((gray / 255) * (chars.length - 1));
            ascii += chars[charIndex];
        }
        ascii += '\n';
    }
    asciiOutput.textContent = ascii;
    requestAnimationFrame(renderFrame);
}

video.addEventListener('loadedmetadata', () => {
    resizeCanvas();
    renderFrame();
});

video.addEventListener('resize', resizeCanvas);
window.addEventListener('resize', resizeCanvas);

video.play().catch(() => {
    document.body.addEventListener('click', () => video.play(), { once: true });
});

// ===== EFECTO BLUR PALABRA A PALABRA =====
setTimeout(() => {
    const headings = ['h1', 'h4', 'a'];

    // Paso 1: crear un span por cada palabra en h1 y h4
    headings.forEach(tag => {
        document.querySelectorAll(tag).forEach(el => {
            const text = el.textContent?.trim();
            if (!text) return;

            const words = text.split(/\s+/);
            el.innerHTML = '';

            words.forEach((word, wordIdx) => {
                const span = document.createElement('span');
                span.textContent = word + (wordIdx < words.length - 1 ? ' ' : '');

                // Estilo inicial: todas borrosas
                span.style.cssText = `
                    display: inline-block;
                    filter: blur(20px);
                    transition: filter 0.8s ease;
                    margin: 0 2px;
                `;

                el.appendChild(span);
            });

            // Forzar reflow para que los spans se rendericen
            const _ = el.offsetHeight;
        });
    });

    // Paso 2: listeners por delegación en cada heading
    headings.forEach(tag => {
        document.querySelectorAll(tag).forEach(el => {
            el.addEventListener('mouseover', (e) => {
                const span = e.target.closest('span');
                if (!span) return;

                // Todas borrosas, y solo la que tiene el mouse se enfoca
                el.querySelectorAll('span').forEach(s => {
                    s.style.filter = 'blur(20px)';
                });
                span.style.filter = 'blur(0px)';
            });

            el.addEventListener('mouseout', (e) => {
                // Solo si salimos del título por completo (no de un span a otro)
                if (!e.relatedTarget || !e.relatedTarget.closest(tag)) {
                    el.querySelectorAll('span').forEach(s => {
                        s.style.filter = 'blur(20px)';
                    });
                }
            });
        });
    });
}, 500);