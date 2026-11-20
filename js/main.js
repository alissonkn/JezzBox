// JezzBall web front-end: rendering, input, HUD, and screens.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const CELL = 22; // canvas is 660x484 = 30x22 cells of 22px

const game = new Game();

const hudEl = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');

let started = false;
let acc = 0;
let last = performance.now();
let rafId;

function fmtTime(t) {
    const secs = Math.max(0, Math.ceil(t / 10));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function cellColor(state) {
    switch (state) {
        case CellState.Filled: return '#1a1a1a';
        case CellState.Open:   return '#000000';
        case CellState.SliceA: return '#00ffff';
        case CellState.SliceB: return '#ffff00';
        default: return '#000000';
    }
}

function draw() {
    // Background / board
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const board = game.board();
    for (let y = 1; y <= kBoardHeight; y++) {
        for (let x = 1; x <= kBoardWidth; x++) {
            const c = board[indexOf(x, y)];
            ctx.fillStyle = cellColor(c.state);
            ctx.fillRect((x - 1) * CELL, (y - 1) * CELL, CELL, CELL);
            // subtle grid line
            ctx.strokeStyle = '#0a0a0a';
            ctx.lineWidth = 1;
            ctx.strokeRect((x - 1) * CELL, (y - 1) * CELL, CELL, CELL);
        }
    }

    // Playable-area frame
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.strokeRect(
        (kPlayableMinX - 1) * CELL,
        (kPlayableMinY - 1) * CELL,
        kPlayableWidth * CELL,
        kPlayableHeight * CELL
    );

    // Balls
    const balls = game.balls();
    for (let i = 0; i < game.ballCount(); i++) {
        const b = balls[i];
        if (!b.active) continue;
        const cx = (b.x - 0.5) * CELL;
        const cy = (b.y - 0.5) * CELL;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // direction tail
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + b.dx * 5, cy + b.dy * 5);
        ctx.stroke();
    }

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

function gameOverScreen() {
    showOverlay(`
        <div class="screen">
            <h2>GAME OVER</h2>
            <p>Final Score: <b>${game.score()}</b><br>
            Level Reached: <b>${game.level()}</b></p>
            <p>Press <b>R</b> to restart</p>
        </div>
    `);
}

function levelCompleteScreen() {
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
    const tickMs = game.tickMilliseconds();
    const dt = now - last;
    last = now;
    acc += dt;
    while (acc >= tickMs) {
        acc -= tickMs;
        game.tick();
    }
    draw();

    if (game.isGameOver() && started) {
        cancelAnimationFrame(rafId);
        gameOverScreen();
        return;
    }
    if (game.isLevelComplete() && started) {
        cancelAnimationFrame(rafId);
        levelCompleteScreen();
        return;
    }
    rafId = requestAnimationFrame(loop);
}

// ---------- Input ----------

canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const x = Math.floor(mx / CELL) + 1;
    const y = Math.floor(my / CELL) + 1;

    if (!started) {
        startGame();
        return;
    }
    if (game.isGameOver() || game.isLevelComplete()) return;
    game.beginCut(x, y);
});

window.addEventListener('keydown', (ev) => {
    const key = ev.key.toLowerCase();

    if (key === 'r' && !started) {
        startGame();
        return;
    }
    if (key === 'r' && game.isGameOver()) {
        game.reset();
        started = true;
        hideOverlay();
        last = performance.now();
        acc = 0;
        rafId = requestAnimationFrame(loop);
        return;
    }
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

// Initial start screen
showOverlay(`
    <div class="screen">
        <h1>JezzBall</h1>
        <p>Click the board to start a cut.<br>
        Walls grow from your click.<br>
        Don't let the balls touch the line!</p>
        <p>Press <b>V</b> to toggle orientation • <b>F</b> fast/slow • <b>P</b> pause</p>
        <p>Click anywhere to begin</p>
    </div>
`);
