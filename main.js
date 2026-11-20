// JezzBox browser shell.  The game engine itself is the ORIGINAL C++
// (src/jezzball.cpp) compiled to WebAssembly via Emscripten.  This file only
// handles the canvas, input, HUD and the requestAnimationFrame loop that
// drives the original game logic at its native tick rate.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const CELL = 22; // 30 x 22 board cells = 660 x 484 canvas

let Module = null;
let game = null;
let started = false;
let rafId = null;
let last = performance.now();
let acc = 0;

const hudEl = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');

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

    const board = game.boardStates();
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
    ctx.strokeRect(
        1 * CELL, 1 * CELL,
        28 * CELL, 20 * CELL
    );

    // Balls (drawn by the original engine)
    const balls = game.balls();
    const count = game.ballCount();
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
    const pct = game.areaClearedPercent().toFixed(0);
    hudEl.innerHTML = `
        <span><b>Level</b> ${game.level()}</span>
        <span><b>Score</b> ${game.score()}</span>
        <span><b>Lives</b> ${game.lives()}</span>
        <span><b>Time</b> ${fmtTime(game.timeRemaining())}</span>
        <span><b>Cleared</b> ${pct}%</span>
        <span><b>Balls</b> ${game.ballCount()}</span>
        <span><b>${game.isFast() ? 'FAST' : 'slow'}</b></span>
        <span>${game.isPaused() ? 'PAUSED' : ''}</span>
    `;
}

function showOverlay(html) {
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
}
function hideOverlay() {
    overlay.classList.add('hidden');
}

function startGame() {
    started = true;
    hideOverlay();
    last = performance.now();
    acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
}

function restart() {
    game.reset();
    started = true;
    hideOverlay();
    last = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(loop);
}

function showGameOver() {
    showOverlay(`
        <div class="screen">
            <h2>GAME OVER</h2>
            <p>Final Score: <b>${game.score()}</b><br>
            Level Reached: <b>${game.level()}</b></p>
            <p>Press <b>R</b> to restart</p>
        </div>
    `);
}

function showLevelComplete() {
    showOverlay(`
        <div class="screen">
            <h2>LEVEL ${game.level()} COMPLETE</h2>
            <p>Bonus: <b>${game.levelBonus()}</b><br>
            Cleared: <b>${game.areaClearedPercent().toFixed(0)}%</b></p>
            <p>Press <b>Enter</b> for next level</p>
        </div>
    `);
}

function loop(now) {
    const dt = now - last;
    last = now;
    acc += dt;

    if (!game.isPaused() && !game.isGameOver() && !game.isLevelComplete() && started) {
        const tickMs = game.tickMilliseconds();
        while (acc >= tickMs) {
            acc -= tickMs;
            game.tick(); // the ORIGINAL game logic tick
        }
    }

    draw();

    if (game.isGameOver() && started) {
        cancelAnimationFrame(rafId);
        showGameOver();
        return;
    }
    if (game.isLevelComplete() && started) {
        cancelAnimationFrame(rafId);
        showLevelComplete();
        return;
    }
    rafId = requestAnimationFrame(loop);
}

// ---------- Input ----------

canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) / CELL) + 1;
    const y = Math.floor((ev.clientY - rect.top) / CELL) + 1;
    if (!started) {
        startGame();
        return;
    }
    if (game.isGameOver() || game.isLevelComplete()) return;
    game.beginCut(x, y);
});

window.addEventListener('keydown', (ev) => {
    const key = ev.key.toLowerCase();
    if (key === 'r' && !started) { startGame(); return; }
    if (key === 'r' && game.isGameOver()) { restart(); return; }
    if (key === 'enter' && game.isLevelComplete()) {
        game.advanceToNextLevel();
        started = true;
        hideOverlay();
        last = performance.now();
        acc = 0;
        rafId = requestAnimationFrame(loop);
        return;
    }
    if (!started) return;
    if (key === ' ') { ev.preventDefault(); game.togglePause(); }
    if (key === 'p') game.togglePause();
    if (key === 'f') game.setFast(!game.isFast());
    if (key === 'v') game.toggleOrientation();
});

// ---------- Bootstrap: load the WASM module (original engine) ----------

showOverlay(`
    <div class="screen">
        <h1>JezzBox</h1>
        <p>Loading original game engine&hellip;</p>
    </div>
`);

(async () => {
    Module = await JezzBoxModule({
        locateFile: (path) => path.endsWith('.wasm') ? 'jezzbox.wasm' : path
    });
    game = new Module.GameBridge();
    game.reset();
    showOverlay(`
        <div class="screen">
            <h1>JezzBox</h1>
            <p>The original 1992 JezzBall engine, compiled to WebAssembly.</p>
            <p>Click the board to start a cut.<br>
            Walls grow from your click&mdash;don&rsquo;t let the balls touch the line!</p>
            <p>Press <b>V</b> toggle orientation &bull; <b>F</b> fast/slow &bull; <b>P</b> pause</p>
            <p>Click anywhere to begin</p>
        </div>
    );
    last = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(loop);
})();
