// ============================================================================
// JezzBox - Faithful web port of the original 1992 Windows JezzBall
// Game logic: original C++ (jezzball.cpp) compiled to WebAssembly
// Rendering: reproduces original Win32 GDI drawing using original bitmap assets
// ============================================================================

// Global error handler
window.addEventListener('error', (ev) => {
    console.error('Global error:', ev.error);
    const d = document.getElementById('debug');
    if (d) d.textContent += '\nERROR: ' + (ev.error ? ev.error.message : ev.message);
});

window.addEventListener('unhandledrejection', (ev) => {
    console.error('Unhandled rejection:', ev.reason);
    const d = document.getElementById('debug');
    if (d) d.textContent += '\nREJECTION: ' + (ev.reason ? ev.reason : ev);
});

// ---------- Sound (Web Audio API, generated without external files) ----------
let audioCtx = null;

function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.1) {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
}

function playBounce() {
    playTone(800, 0.05, 'square', 0.05);
}

function playDead() {
    playTone(200, 0.3, 'sawtooth', 0.1);
    playTone(150, 0.3, 'sawtooth', 0.1);
}

function playStart() {
    playTone(400, 0.1, 'square', 0.1);
    setTimeout(() => playTone(600, 0.1, 'square', 0.1), 100);
    setTimeout(() => playTone(800, 0.2, 'square', 0.1), 200);
}

// ---------- BMP Parser ----------
function parseBMP(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    if (data[0] !== 0x42 || data[1] !== 0x4D) throw new Error('Not a BMP file');

    const pixelOffset = dv.getUint32(10, true);
    const width = dv.getInt32(18, true);
    const height = dv.getInt32(22, true);
    const planes = dv.getUint16(26, true);
    const bitCount = dv.getUint16(28, true);
    const compression = dv.getUint32(30, true);

    if (planes !== 1) throw new Error('Unexpected BMP planes');
    if (compression !== 0) throw new Error('Compressed BMP not supported');

    const absHeight = Math.abs(height);
    const topDown = height < 0;
    const pixels = new Uint8ClampedArray(width * absHeight * 4);

    if (bitCount === 24) {
        const rowSize = Math.floor((width * 24 + 31) / 32) * 4;
        for (let y = 0; y < absHeight; y++) {
            const srcY = topDown ? y : absHeight - 1 - y;
            for (let x = 0; x < width; x++) {
                const srcOff = pixelOffset + srcY * rowSize + x * 3;
                const b = data[srcOff];
                const g = data[srcOff + 1];
                const r = data[srcOff + 2];
                const dstOff = (y * width + x) * 4;
                pixels[dstOff] = r;
                pixels[dstOff + 1] = g;
                pixels[dstOff + 2] = b;
                pixels[dstOff + 3] = 255;
            }
        }
    } else if (bitCount === 8) {
        const palette = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            const off = 54 + i * 4;
            palette[i] = (data[off + 2] << 16) | (data[off + 1] << 8) | data[off];
        }
        const rowSize = Math.floor((width * 8 + 31) / 32) * 4;
        for (let y = 0; y < absHeight; y++) {
            const srcY = topDown ? y : absHeight - 1 - y;
            for (let x = 0; x < width; x++) {
                const correctOff = pixelOffset + srcY * rowSize + x;
                const idx = data[correctOff];
                const color = palette[idx];
                const dstOff = (y * width + x) * 4;
                pixels[dstOff] = (color >> 16) & 0xFF;
                pixels[dstOff + 1] = (color >> 8) & 0xFF;
                pixels[dstOff + 2] = color & 0xFF;
                pixels[dstOff + 3] = 255;
            }
        }
    } else {
        throw new Error('Unsupported bit depth: ' + bitCount);
    }

    return { width, height, pixels };
}

function bmpToCanvas(arrayBuffer) {
    const { width, height, pixels } = parseBMP(arrayBuffer);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = cctx.createImageData(width, height);
    imgData.data.set(pixels);
    cctx.putImageData(imgData, 0, 0);
    return canvas;
}

// ---------- Asset loading ----------
const assets = {};

async function loadAssets() {
    const response = await fetch('assets.json');
    const bmpData = await response.json();
    const names = Object.keys(bmpData);
    for (const name of names) {
        const buf = Uint8Array.from(atob(bmpData[name]), c => c.charCodeAt(0)).buffer;
        assets[name] = bmpToCanvas(buf);
        // Yield to browser between assets to avoid script timeout watchdog
        await new Promise(r => setTimeout(r, 0));
    }
    console.log('Assets loaded:', Object.keys(assets).join(', '));
}

// ---------- Display scaling ----------
// Canvas stays at original 517x374 internally; CSS scales it up for display.
// Use integer scale factors (2x = 1034x748) to avoid subpixel artifacts.
const DISPLAY_SCALE = 2; // 2x = 1034x748 displayed

// ---------- Constants (from jezzball.h / win32.cpp) ----------
const kBoardWidth = 30;
const kBoardHeight = 22;
const kVisibleMinX = 2;
const kVisibleMaxX = 29;
const kVisibleMinY = 2;
const kVisibleMaxY = 21;
const kVisibleWidth = 28;
const kVisibleHeight = 20;
const kScreenTileW = 16;
const kScreenTileH = 12;

const CellState = { Filled: 0, Open: 1, SliceA: 2, SliceB: 3 };

const kFloorSourceX = 0;
const kFloorSourceY = 0;
const kFloorSourceW = 16;
const kFloorSourceH = 12;

const kRedHorizontalWallBodySourceX = 200;
const kBlueHorizontalWallBodySourceX = 232;
const kWallCapSourceX = 272;
const kRedWallCapSourceY = 0;
const kBlueWallCapSourceY = 12;
const kHorizontalWallSourceY = 6;
const kHorizontalWallSourceW = 16;
const kHorizontalWallSourceH = 12;
const kHorizontalWallRenderW = 16;
const kHorizontalWallRenderH = 12;
const kVerticalWallSourceX = 200;
const kVerticalWallSourceY = 0;
const kVerticalWallSourceW = 8;
const kVerticalWallSourceH = 12;
const kVerticalWallRenderW = 12;
const kVerticalWallRenderH = 12;
const kWallCapSourceW = 16;
const kWallCapSourceH = 12;

const kBallFrameCount = 22;
const kBallFrameColumns = 11;
const kBallFirstFrameX = 16;
const kBallFrameSourceW = 16;
const kBallFrameSourceH = 12;

const kLevelCompleteWidth = 206;
const kLevelCompleteHeight = 165;
const kPauseWidth = 88;
const kPauseHeight = 47;

// ---------- Game state ----------
let Module = null;
let started = false;
let rafId = null;
let last = performance.now();
let acc = 0;
let dialogOpen = null;

// Sound: track previous ball velocities for bounce detection
let prevBallVelocities = null;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const hudEl = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');

// ---------- Layout (from updateLayout) ----------
function computeLayout(clientW, clientH) {
    const boardWidth = kScreenTileW * kVisibleWidth;
    const boardHeight = kScreenTileH * kVisibleHeight;
    const originX = Math.max(0, (clientW - boardWidth) / 2);
    const originY = Math.max(0, (clientH - boardHeight) / 2);
    return {
        board: { left: originX, top: originY, right: originX + boardWidth, bottom: originY + boardHeight },
        originX, originY, boardWidth, boardHeight
    };
}

let layout = computeLayout(517, 374);

// ---------- Atlas tile drawing ----------
function drawAtlasTile(atlas, dc, dx, dy, dw, dh, sx, sy, sw, sh, transparent) {
    if (!atlas) return;
    if (transparent) {
        const temp = document.createElement('canvas');
        temp.width = sw; temp.height = sh;
        const tctx = temp.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
        const imgData = tctx.getImageData(0, 0, sw, sh);
        for (let i = 0; i < imgData.data.length; i += 4) {
            if (imgData.data[i] === 0 && imgData.data[i+1] === 0 && imgData.data[i+2] === 0) {
                imgData.data[i+3] = 0;
            }
        }
        tctx.putImageData(imgData, 0, 0);
        dc.drawImage(temp, dx, dy, dw, dh);
    } else {
        dc.drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh);
    }
}

// ---------- Rendering ----------
function fmtTime(t) {
    const secs = Math.max(0, Math.ceil(Math.max(0, t) / 10));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + ':' + String(s).padStart(2, '0');
}

function fmtPercent(p) {
    return Math.floor(p).toString();
}

function drawTextCentered(dc, text, centerX, y) {
    dc.save();
    dc.fillStyle = '#ffffff';
    dc.font = '12px monospace';
    dc.textBaseline = 'middle';
    dc.textAlign = 'center';
    const metrics = dc.measureText(text);
    dc.fillText(text, centerX, y + metrics.actualBoundingBoxAscent / 2);
    dc.restore();
}

function draw() {
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const atlas = assets['jezzball_atlas.bmp'];

    ctx.fillStyle = '#000000';
    ctx.fillRect(layout.board.left, layout.board.top,
                 layout.board.right - layout.board.left,
                 layout.board.bottom - layout.board.top);

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.board.left, layout.board.top,
             layout.board.right - layout.board.left,
             layout.board.bottom - layout.board.top);
    ctx.clip();

    const board = Module.boardStates();

    for (let y = kVisibleMinY; y <= kVisibleMaxY; y++) {
        for (let x = kVisibleMinX; x <= kVisibleMaxX; x++) {
            const px = layout.originX + (x - kVisibleMinX) * kScreenTileW;
            const py = layout.originY + (kVisibleMaxY - y) * kScreenTileH;
            const c = board[((y - 1) * kBoardWidth + (x - 1))];

            if (c === CellState.Filled) continue;

            drawAtlasTile(atlas, ctx, px, py, kScreenTileW, kScreenTileH,
                          kFloorSourceX, kFloorSourceY, kFloorSourceW, kFloorSourceH, false);

            if (c === CellState.SliceA || c === CellState.SliceB) {
                const red = c === CellState.SliceA;
                if (!Module.verticalMode()) {
                    const sx = red ? kRedHorizontalWallBodySourceX : kBlueHorizontalWallBodySourceX;
                    const dy = py + (kScreenTileH - kHorizontalWallRenderH) / 2;
                    drawAtlasTile(atlas, ctx, px, dy,
                                  kHorizontalWallRenderW, kHorizontalWallRenderH,
                                  sx, kHorizontalWallSourceY,
                                  kHorizontalWallSourceW, kHorizontalWallSourceH, false);

                    const leftEnd = x === kVisibleMinX ||
                        board[((y - 1) * kBoardWidth + (x - 2))] !== c;
                    const rightEnd = x === kVisibleMaxX ||
                        board[((y - 1) * kBoardWidth + x)] !== c;

                    const capSourceY = red ? kRedWallCapSourceY : kBlueWallCapSourceY;
                    if (leftEnd) {
                        drawAtlasTile(atlas, ctx, px, py,
                                      kScreenTileW, kScreenTileH,
                                      kWallCapSourceX, capSourceY,
                                      kWallCapSourceW, kWallCapSourceH, false);
                    }
                    if (rightEnd) {
                        drawAtlasTile(atlas, ctx, px, py,
                                      kScreenTileW, kScreenTileH,
                                      kWallCapSourceX, capSourceY,
                                      kWallCapSourceW, kWallCapSourceH, false);
                    }
                } else {
                    const sx = red ? kVerticalWallSourceX : kVerticalWallSourceX;
                    const dx = px + (kScreenTileW - kVerticalWallRenderW) / 2;
                    drawAtlasTile(atlas, ctx, dx, py,
                                  kVerticalWallRenderW, kVerticalWallRenderH,
                                  sx, kVerticalWallSourceY,
                                  kVerticalWallSourceW, kVerticalWallSourceH, false);

                    const bottomEnd = y === kVisibleMinY ||
                        board[((y - 2) * kBoardWidth + (x - 1))] !== c;
                    const topEnd = y === kVisibleMaxY ||
                        board[(y * kBoardWidth + (x - 1))] !== c;

                    const capSourceY = red ? kRedWallCapSourceY : kBlueWallCapSourceY;
                    if (bottomEnd) {
                        drawAtlasTile(atlas, ctx, px, py,
                                      kScreenTileW, kScreenTileH,
                                      kWallCapSourceX, capSourceY,
                                      kWallCapSourceW, kWallCapSourceH, false);
                    }
                    if (topEnd) {
                        drawAtlasTile(atlas, ctx, px, py,
                                      kScreenTileW, kScreenTileH,
                                      kWallCapSourceX, capSourceY,
                                      kWallCapSourceW, kWallCapSourceH, false);
                    }
                }
            }
        }
    }

    // Slicers (wall being drawn) - white caps
    const slicers = Module.slicers();
    for (let i = 0; i < slicers.length; i++) {
        const slicer = slicers[i];
        if (!slicer.active) continue;
        const px = layout.originX + (slicer.x - kVisibleMinX) * kScreenTileW;
        const py = layout.originY + (kVisibleMaxY - slicer.y) * kScreenTileH;
        if (Module.verticalMode()) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px + (kScreenTileW - 8) / 2, py, 8, 2);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px, py + (kScreenTileH - 8) / 2, 2, 8);
        }
    }

    // Balls with animation frames
    const balls = Module.balls();
    const ballCount = Module.ballCount();
    const atlasCanvas = assets['jezzball_atlas.bmp'];
    for (let i = 0; i < ballCount; i++) {
        const b = balls[i];
        if (!b.active) continue;
        const px = layout.originX + (b.x - kVisibleMinX) * kScreenTileW;
        const py = layout.originY + (kVisibleMaxY - b.y) * kScreenTileH;
        const frameIndex = b.frame % kBallFrameCount;
        const col = frameIndex % kBallFrameColumns;
        const row = Math.floor(frameIndex / kBallFrameColumns);
        const sx = kBallFirstFrameX + col * kBallFrameSourceW;
        const sy = row * kBallFrameSourceH;
        ctx.drawImage(atlasCanvas, sx, sy, kBallFrameSourceW, kBallFrameSourceH,
                      px, py, kScreenTileW, kScreenTileH);
    }

    ctx.restore();

    // HUD
    drawHud();
}

function drawHud() {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    drawTextCentered(ctx, 'Lives: ' + Module.lives(), 62, 10);
    drawTextCentered(ctx, 'Score: ' + Module.score(), 245, 2);
    if (Module.isLevelComplete()) {
        drawTextCentered(ctx, 'Bonus: ' + Module.levelBonus(), 245, 20);
    }
    drawTextCentered(ctx, 'Time Left: ' + Module.timeRemaining(), 415, 10);
    const areaY = layout.board.bottom + (layout.board.top - 27);
    drawTextCentered(ctx, 'Area Cleared: ' + fmtPercent(Module.areaClearedPercent()) + '%',
                     (layout.board.left + layout.board.right) / 2, areaY);

    ctx.restore();
}

// ---------- Cursor ----------
function updateCursor() {
    if (!Module || !canvas) return;
    canvas.classList.remove('cursor-horizontal', 'cursor-vertical', 'cursor-cutting');
    const slicers = Module.slicers();
    const cutting = slicers.some(s => s.active);
    if (cutting) {
        canvas.classList.add('cursor-cutting');
    } else if (Module.verticalMode()) {
        canvas.classList.add('cursor-vertical');
    } else {
        canvas.classList.add('cursor-horizontal');
    }
}

// ---------- Dialogs & Menus ----------
function showOverlay(html) {
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
    dialogOpen = true;
}
function hideOverlay() {
    overlay.classList.add('hidden');
    dialogOpen = false;
}

function showError(msg) {
    showOverlay(`
        <div class="screen">
            <h2 style="color:#ff4444">JezzBox failed to load</h2>
            <p>${msg}</p>
            <button onclick="location.reload()">Reload</button>
        </div>
    `);
}

function startGame() {
    console.log('startGame called, Module=', !!Module, 'dialogOpen=', dialogOpen, 'started=', started);
    if (!Module) return;
    started = true;
    hideOverlay();
    last = performance.now();
    acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    updateCursor();
    playStart();
    console.log('Game started, loop running');
}

function restart() {
    Module.reset();
    startGame();
}

function showGameOver() {
    const finalScore = Module.score();
    const finalLevel = Module.level();
    showOverlay(`
        <div class="screen" style="width:313px; height:141px; position:relative;">
            <div style="position:absolute; top:0; left:0; width:313px; height:138px; background:#000000; border:2px solid #c0c0c0;"></div>
            <div style="position:absolute; top:10px; left:28px; right:28px; text-align:center; color:#ffffff; font-weight:bold; text-shadow:1px 1px 2px #000000;">GAME OVER</div>
            <div style="position:absolute; top:42px; left:0; right:0; text-align:center; color:#ffffff; text-shadow:1px 1px 2px #000000;">Final Score: <b>${finalScore}</b><br>Level Reached: <b>${finalLevel}</b></div>
            <div style="position:absolute; bottom:14px; left:0; right:0; text-align:center;"><button onclick="restartGame()">Play Again</button></div>
        </div>
    `);
}

function restartGame() {
    Module.reset();
    hideOverlay();
    startGame();
}

function showLevelComplete() {
    const level = Module.level();
    const bonus = Module.levelBonus();
    showOverlay(`
        <div class="screen" style="width:${kLevelCompleteWidth}px; height:${kLevelCompleteHeight}px; position:relative;">
            <h2 style="position:absolute; top:4px; left:28px; right:28px; text-align:center; color:#ffffff; font-weight:bold; margin:0; text-shadow:1px 1px 2px #000000;">Well done!</h2>
            <div style="position:absolute; top:39px; left:27px; right:27px; border:1px solid #000000; padding:2px; background:#ffffff; color:#000000; font-family:monospace; text-align:center;">You have completed<br>Level ${level}</div>
            <div style="position:absolute; bottom:20px; left:0; right:0; text-align:center;"><button onclick="advanceLevel()">NEXT LEVEL</button></div>
        </div>
    `);
}

function advanceLevel() {
    Module.advanceToNextLevel();
    hideOverlay();
    startGame();
}

function newGame() {
    if (!Module || dialogOpen) return;
    showOverlay(`
        <div class="screen" style="width:313px; height:141px; position:relative;">
            <div style="position:absolute; top:0; left:0; width:313px; height:138px; background:#000000; border:2px solid #c0c0c0;"></div>
            <div style="position:absolute; top:8px; left:28px; right:28px; text-align:center; color:#ffffff; font-weight:bold; text-shadow:1px 1px 2px #000000;">JezzBox</div>
            <div style="position:absolute; top:48px; left:68px; right:68px; color:#000000; font-family:monospace; text-align:center;">Do you want to start a new game?</div>
            <div style="position:absolute; bottom:14px; display:flex; justify-content:center; gap:20px;"><button onclick="confirmNewGame()">Yes</button><button onclick="hideOverlay()">No</button></div>
        </div>
    `);
}

function confirmNewGame() {
    Module.reset();
    started = true;
    hideOverlay();
    last = performance.now();
    acc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    updateMenuCheckmarks();
}

function togglePause() {
    if (!Module || dialogOpen) return;
    Module.togglePause();
    updateMenuCheckmarks();
    if (Module.isPaused()) { showPaused(); } else { hideOverlay(); }
}

function showPaused() {
    showOverlay(`
        <div class="screen" style="width:${kPauseWidth}px; height:${kPauseHeight}px; position:relative; text-align:center;">
            <div style="position:absolute; top:0; left:0; width:${kPauseWidth}px; height:${kPauseHeight}px; background:#c0c0c0; border:2px solid #ffffff;"></div>
            <div style="position:absolute; top:8px; left:0; right:0; text-align:center; color:#000000; font-weight:bold;">Paused</div>
        </div>
    `);
}

function showHighScores() {
    if (!Module || dialogOpen) return;
    showOverlay(`
        <div class="screen" style="width:344px; max-width:95vw; position:relative; text-align:center;">
            <h2 style="color:#00ffff; margin:0 0 10px;">High Scores</h2>
            <div style="text-align:left; margin:0 auto; max-width:280px; font-family:monospace; color:#000000;">
                <div style="margin-bottom:8px;"><b>All Time:</b></div>
                <div id="highscores-all">(no scores saved)</div>
                <div style="margin-top:8px;"><b>Today:</b></div>
                <div id="highscores-today">(no scores saved)</div>
            </div>
            <div style="margin-top:14px;"><button onclick="hideOverlay()">OK</button><button onclick="clearHighScores()">Clear Scores</button></div>
        </div>
    `);
}

function clearHighScores() { hideOverlay(); }

function showAbout() {
    if (!Module || dialogOpen) return;
    showOverlay(`
        <div class="screen" style="width:282px; max-width:95vw; position:relative; text-align:center;">
            <h2 style="color:#00ffff; margin:0 0 10px;">About JezzBox</h2>
            <div style="text-align:left; margin:0 auto; max-width:240px; font-family:monospace; color:#000000; line-height:1.6;">Jezz Ball<br>by Dima Pavlovsky<br>Produced by Marjacq Micro Ltd.<br>Copyright &copy; 1992 Microsoft Corp.<br><br>Faithful web port of the original<br>1992 Windows 3.1 JezzBall game engine<br>compiled to WebAssembly.</div>
            <div style="margin-top:14px;"><button onclick="hideOverlay()">OK</button></div>
        </div>
    `);
}

function showHelp(topic) {
    if (!Module || dialogOpen) return;
    const topics = {
        contents: { title: 'Help Contents', body: 'How To Play\r\nCommands\r\nHow To Use Help' },
        howtoplay: { title: 'How To Play', body: 'Point inside the chamber and click to build a wall.\r\nRight-click alternates horizontal and vertical walls.\r\nA wall grows until it reaches an edge or a ball.' },
        commands: { title: 'Commands', body: 'F1  Help\r\nF2  New Game\r\nF3  Pause\r\nRight mouse button  Change wall direction' },
        usehelp: { title: 'How To Use Help', body: 'Choose a topic from Help Contents.\r\nUse the scroll bar or links in a Help viewer.' }
    };
    const t = topics[topic] || topics.contents;
    showOverlay(`
        <div class="screen" style="width:260px; max-width:95vw; position:relative; text-align:center;">
            <h2 style="color:#00ffff; margin:0 0 10px;">${t.title}</h2>
            <div style="text-align:left; margin:0 auto; max-width:220px; font-family:monospace; color:#000000; white-space:pre-line;">${t.body}</div>
            <div style="margin-top:14px;"><button onclick="hideOverlay()">OK</button></div>
        </div>
    `);
}

function exitGame() {
    if (!Module || dialogOpen) return;
    if (confirm('Exit JezzBox?')) { location.reload(); }
}

function updateMenuCheckmarks() {
    if (!Module) return;
    const slowItem = document.getElementById('menu-slow');
    const fastItem = document.getElementById('menu-fast');
    if (slowItem && fastItem) {
        slowItem.textContent = Module.isFast() ? 'Slow' : 'Slow';
        fastItem.textContent = Module.isFast() ? 'Fast' : 'Fast';
    }
}

window.newGame = newGame;
window.togglePause = togglePause;
window.showHighScores = showHighScores;
window.exitGame = exitGame;
window.showAbout = showAbout;
window.showHelp = showHelp;
window.restartGame = restartGame;

function loop(now) {
    if (dialogOpen) {
        rafId = requestAnimationFrame(loop);
        return;
    }
    const dt = now - last;
    last = now;
    acc += dt;

    if (!Module.isPaused() && !Module.isGameOver() && !Module.isLevelComplete() && started) {
        const tickMs = Module.tickMilliseconds();
        while (acc >= tickMs) {
            acc -= tickMs;

            // Capture ball velocities before tick for bounce detection
            const ballsBefore = Module.balls();
            const prevVel = [];
            for (let i = 0; i < Module.ballCount(); i++) {
                const b = ballsBefore[i];
                prevVel.push({ dx: b.dx, dy: b.dy, active: b.active });
            }

            Module.tick();

            // Detect bounces: balls whose velocity direction changed
            const ballsAfter = Module.balls();
            for (let i = 0; i < Module.ballCount(); i++) {
                const b = ballsAfter[i];
                const pv = prevVel[i];
                if (pv.active && b.active) {
                    if ((b.dx !== pv.dx || b.dy !== pv.dy) && (b.dx !== 0 || b.dy !== 0)) {
                        playBounce();
                    }
                }
            }
        }
    }

    draw();
    updateCursor();

    if (Module.isGameOver() && started) {
        playDead();
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
    // Account for CSS scaling: rect is in CSS pixels, board coords are internal pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const boardX = (ev.clientX - rect.left) * scaleX - layout.originX;
    const boardY = (ev.clientY - rect.top) * scaleY - layout.originY;
    const x = kVisibleMinX + Math.floor(boardX / kScreenTileW);
    const y = kVisibleMaxY - Math.floor(boardY / kScreenTileH);
    return { x, y };
}

canvas.addEventListener('mousedown', (ev) => {
    console.log('Canvas mousedown, button=', ev.button, 'Module=', !!Module, 'dialogOpen=', dialogOpen, 'started=', started);
    if (!Module || dialogOpen) return;
    if (ev.button === 0) {
        if (!started) {
            startGame();
            return;
        }
        if (Module.isGameOver() || Module.isLevelComplete()) return;
        const { x, y } = boardCellFromEvent(ev);
        console.log('Click at board cell:', x, y);
        if (x >= 1 && x <= kBoardWidth && y >= 1 && y <= kBoardHeight) {
            Module.beginCut(x, y);
            console.log('Cut started at', x, y);
            updateCursor();
        }
    } else if (ev.button === 2) {
        ev.preventDefault();
        if (!started) return;
        if (Module.isGameOver() || Module.isLevelComplete()) return;
        Module.toggleOrientation();
    }
});

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

// Overlay click also starts the game (covers canvas before play begins)
overlay.addEventListener('click', (ev) => {
    console.log('Overlay click, started=', started, 'Module=', !!Module);
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
        if (Module.isGameOver()) { restartGame(); return; }
    }
    if (key === 'enter' && Module.isLevelComplete()) { advanceLevel(); return; }
    if (!started) return;
    if (key === ' ') { ev.preventDefault(); Module.togglePause(); }
    if (key === 'p') Module.togglePause();
    if (key === 'f') Module.setFast(!Module.isFast());
    if (key === 'v') { Module.toggleOrientation(); updateCursor(); }
});

// ---------- Bootstrap ----------
showOverlay(`
    <div class="screen">
        <h1>JezzBox</h1>
        <p>Loading original game engine&hellip;</p>
    </div>
`);

(async () => {
    try {
        console.log('Loading assets...');
        await loadAssets();
        console.log('Loading WASM module...');
        Module = await JezzBoxModule({
            locateFile: (path) => path.endsWith('.wasm') ? 'jezzbox.wasm' : path
        });
        console.log('WASM module loaded, calling reset()...');
        Module.reset();
        console.log('Game reset, level=', Module.level(), 'balls=', Module.ballCount(), 'tickMs=', Module.tickMilliseconds());
        showOverlay(`
            <div class="screen">
                <h1>JezzBox</h1>
                <p>The original 1992 JezzBall engine, compiled to WebAssembly.</p>
                <p>Click the board to start a cut.<br>Right-click to toggle wall orientation.<br>Press <b>V</b> toggle orientation &bull; <b>F</b> fast/slow &bull; <b>P</b> pause</p>
                <p>Click anywhere to begin</p>
            </div>
        `);
        last = performance.now();
        acc = 0;
        rafId = requestAnimationFrame(loop);
        console.log('Loop started');
    } catch (err) {
        console.error('JezzBox load failed', err);
        showError(err && err.message ? err.message : String(err));
    }
})();

// ---------- Menu dropdowns ----------
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.menu').forEach(menu => {
        const title = menu.querySelector('.menu-title');
        const dropdown = menu.querySelector('.menu-dropdown');
        title.addEventListener('click', () => {
            document.querySelectorAll('.menu-dropdown.shown').forEach(d => {
                if (d !== dropdown) d.classList.remove('shown');
            });
            dropdown.classList.toggle('shown');
        });
    });
    document.addEventListener('click', (ev) => {
        if (!ev.target.closest('.menu')) {
            document.querySelectorAll('.menu-dropdown.shown').forEach(d => d.classList.remove('shown'));
        }
    });
});
