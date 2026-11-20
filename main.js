// JezzBox browser shell.  The game engine is the ORIGINAL C++ JezzBall
// logic (src/jezzball.cpp) compiled to WebAssembly via Emscripten.  This file
// only provides the canvas, input, HUD and the requestAnimationFrame loop
// that drives the original game logic at its native tick rate.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const CELL = 22; // 30 x 22 board cells = 660 x 484 canvas

const hudEl = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');

let Module = null;
let started = false;
let rafId = null;
let last = performance.now();
let acc = 0;

function fmtTime(t) {
    const secs = Math.max(0, Math.ceil(Math.max(0, t) / 10));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function cellColor(state) {
    // 0 = Filled (cleared wall), 1 = Open (chamber), 2 = SliceA, 3 = SliceB
    switch (state) {
        case 0: return '#111111';
        case 1: return '#000000';
        case 2: return '#00ffff';
        case 3: return '#ffff00';
        default: return '#000000';
    }
}

function draw() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const board = Module.boardStates();
    for (let y = 1; y <= 22; y++) {
        const rowOff = (y - 1) * 30;
        for (let x = 1; x <= 30; x++) {
            const state = board[rowOff + (x - 1)];
            ctx.fillStyle = cellColor(state);
            ctx.fillRect((x - 1) * CELL, (y - 1) * CELL, CELL, CELL);
        }
    }

    // Playable chamber frame
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.strokeRect(1 * CELL, 1 * CELL, 28 * CELL, 20 * CELL);

    // Balls (drawn by the original engine)
    const balls = Module.balls();
    const count = Module.ballCount();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    for (let i = 0; i < count; i++) {
        const b = balls[i];
        if (!b.active) continue;
        const cx = (b.x - 0.5) * CELL;
        const cy = (b.y - 0.5) * CELL;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + b.dx * 5, cy + b.dy * 5);
        ctx.stroke();
    }
    ctx.shadowBlur = 0;

    updateHud();
}

function updateHud() {
    const pct = Module.areaClearedPercent().toFixed(0);
    hudEl.innerHTML = `
        <span><b>Level</b> ${Module.level()}</span>
        <span><b>Score</b> ${Module.score()}</span>
        <span><b>Lives</b> ${Module.lives()}</span>
        <span><b>Time</b> ${fmtTime(Module.timeRemaining())}</span>
        <span><b>Cleared</b> ${pct}%</span>
        <span><b>Balls</b> ${Module.ballCount()}</span>
        <span><b>${Module.isFast() ? 'FAST' : 'slow'}</b></span>
        <span>${Module.isPaused() ? 'PAUSED' : ''}</span>
    `;
}

function showOverlay(html) {
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
}
function hideOverlay() {
    overlay.classList.add('hidden');
}

function showError(msg) {
    showOverlay(`
        <div class="screen">
            <h2 style="color:#ff4444">JezzBox failed to load</h2>
            <p>${msg}</p>
            <p>Make sure you are serving over HTTP (not file://) and that<br>
            jezzbox.js and jezzbox.wasm are both available.</p>
            <button onclick="location.reload()">Reload</button>
        </div>
    `);
}

function startGame() {
    if (!Module) return;
    started = true;
    hideOverlay();
    last = performance.now();
    acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
}

function restart() {
    Module.reset();
    startGame();
}

function showGameOver() {
    showOverlay(`
        <div class="screen">
            <h2>GAME OVER</h2>
            <p>Final Score: <b>${Module.score()}</b><br>
            Level Reached: <b>${Module.level()}</b></p>
            <button onclick="location.reload()">Play Again</button>
        </div>
    `);
}

function showLevelComplete() {
    showOverlay(`
        <div class="screen">
            <h2>LEVEL ${Module.level()} COMPLETE</h2>
            <p>Bonus: <b>${Module.levelBonus()}</b><br>
            Cleared: <b>${Module.areaClearedPercent().toFixed(0)}%</b></p>
            <button onclick="advanceLevel()">Next Level</button>
        </div>
    `);
}

function advanceLevel() {
    Module.advanceToNextLevel();
    startGame();
}

function loop(now) {
    const dt = now - last;
    last = now;
    acc += dt;

    if (!Module.isPaused() && !Module.isGameOver() && !Module.isLevelComplete() && started) {
        const tickMs = Module.tickMilliseconds();
        while (acc >= tickMs) {
            acc -= tickMs;
            Module.tick(); // the ORIGINAL game logic tick
        }
    }

    draw();

    if (Module.isGameOver() && started) {
        cancelAnimationFrame(rafId);
        showGameOver();
        return;
    }
    if (Module.isLevelComplete() && started) {
        cancelAnimationFrame(rafId);
        showLevelComplete();
        return;
    }
    rafId = requestAnimationFrame(loop);
}

// ---------- Input ----------

function boardCellFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) / CELL) + 1;
    const y = Math.floor((ev.clientY - rect.top) / CELL) + 1;
    return { x, y };
}

canvas.addEventListener('click', (ev) => {
    if (!Module) return;
    if (!started) {
        startGame();
        return;
    }
    if (Module.isGameOver() || Module.isLevelComplete()) return;
    const { x, y } = boardCellFromEvent(ev);
    Module.beginCut(x, y);
});

// Overlay click also starts the game (covers canvas before play begins).
overlay.addEventListener('click', (ev) => {
    if (!Module) return;
    if (!started) {
        startGame();
        return;
    }
});

window.addEventListener('keydown', (ev) => {
    if (!Module) return;
    const key = ev.key.toLowerCase();
    if (key === 'r') {
        if (!started) { startGame(); return; }
        if (Module.isGameOver()) { restart(); return; }
    }
    if (key === 'enter' && Module.isLevelComplete()) {
        advanceLevel();
        return;
    }
    if (!started) return;
    if (key === ' ') { ev.preventDefault(); Module.togglePause(); }
    if (key === 'p') Module.togglePause();
    if (key === 'f') Module.setFast(!Module.isFast());
    if (key === 'v') Module.toggleOrientation();
});

// ---------- Bootstrap: load the WASM module (original engine) ----------

showOverlay(`
    <div class="screen">
        <h1>JezzBox</h1>
        <p>Loading original game engine&hellip;</p>
    </div>
`);

(async () => {
    try {
        Module = await JezzBoxModule({
            locateFile: (path) => path.endsWith('.wasm') ? 'jezzbox.wasm' : path
        });
        Module.reset();
        showOverlay(`
            <div class="screen">
                <h1>JezzBox</h1>
                <p>The original 1992 JezzBall engine, compiled to WebAssembly.</p>
                <p>Click the board to start a cut.<br>
                Walls grow from your click&mdash;don&rsquo;t let the balls touch the line!</p>
                <p>Press <b>V</b> toggle orientation &bull; <b>F</b> fast/slow &bull; <b>P</b> pause</p>
                <p>Click anywhere to begin</p>
            </div>
        `);
        last = performance.now();
        acc = 0;
        rafId = requestAnimationFrame(loop);
    } catch (err) {
        console.error('JezzBox load failed', err);
        showError(err && err.message ? err.message : String(err));
    }
})();
