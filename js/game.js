// JezzBall - web port of the original 1992 Windows 3.1 game logic.
// Ported from the C++ reverse-engineered source in src/jezzball.{cpp,h}

const kBoardWidth = 30;
const kBoardHeight = 22;
const kPlayableMinX = 2;
const kPlayableMaxX = kBoardWidth - 1;      // 29
const kPlayableMinY = 2;
const kPlayableMaxY = kBoardHeight - 1;     // 21
const kPlayableWidth = kPlayableMaxX - kPlayableMinX + 1;   // 28
const kPlayableHeight = kPlayableMaxY - kPlayableMinY + 1;  // 20
const kMaxBalls = 50;
const kMaxSlicers = 2;
const kSlowTickMs = 100;
const kFastTickMs = 50;
const kTargetClearPercent = 75;

const CellState = Object.freeze({ Filled: 0, Open: 1, SliceA: 2, SliceB: 3 });

function indexOf(x, y) {
    return (y - 1) * kBoardWidth + (x - 1);
}

function inside(x, y) {
    return x >= kPlayableMinX && x <= kPlayableMaxX &&
           y >= kPlayableMinY && y <= kPlayableMaxY;
}

// 32-bit unsigned LCG, matching the original C++ exactly.
function nextRandom(state) {
    return (state * 1103515245 + 12345) >>> 0;
}

function randomRange(state, low, high) {
    const span = high - low + 1;
    return low + ((nextRandom(state) >>> 8) % span);
}

function signFromRandom(state) {
    return (nextRandom(state) & 1) ? 1 : -1;
}

function newCell() {
    return { state: CellState.Open, reserved: 0, ball: 0, visited: 0 };
}

function newSlicer() {
    return { active: false, x: 0, y: 0, dx: 0, dy: 0, owner: 0,
             pendingX: 0, pendingY: 0, hasPending: false };
}

function newBall() {
    return { x: 1, y: 1, dx: 1, dy: 1, pendingX: 0, pendingY: 0,
             hasPending: false, active: false, frame: 0 };
}

class Game {
    constructor() {
        this.reset();
    }

    reset() {
        this.m_paused = false;
        this.m_gameOver = false;
        this.m_levelComplete = false;
        this.m_verticalMode = false;
        this.m_cutHadFailure = false;
        this.m_cutInProgress = false;
        this.m_level = 1;
        this.m_ballCount = 2;
        this.m_lives = this.m_ballCount;
        this.m_scoreHalfPoints = 0;
        this.m_levelBonus = 0;
        this.m_timeRemaining = this.m_ballCount * 250 + 1000;
        this.m_tickCounter = 0;
        this.m_timeAccumulatorMs = 0;
        this.m_rng = 0x13579BDF;
        this.m_slicers = [newSlicer(), newSlicer()];
        this.m_board = [];
        for (let i = 0; i < kBoardWidth * kBoardHeight; i++) {
            this.m_board.push(newCell());
        }
        this.m_balls = [];
        for (let i = 0; i < kMaxBalls; i++) {
            this.m_balls.push(newBall());
        }
        this.clearBoard();
        this.seedBalls();
        this.recomputeArea();
    }

    togglePause() {
        if (!this.m_gameOver) {
            this.m_paused = !this.m_paused;
        }
    }

    setFast(fast) {
        this.m_fast = fast;
    }

    isPaused() { return this.m_paused; }
    isFast() { return this.m_fast === true; }
    isGameOver() { return this.m_gameOver; }
    isLevelComplete() { return this.m_levelComplete; }

    tickMilliseconds() {
        return this.m_fast ? kFastTickMs : kSlowTickMs;
    }

    level() { return this.m_level; }
    ballCount() { return this.m_ballCount; }
    lives() { return this.m_lives; }
    score() { return Math.floor(this.m_scoreHalfPoints / 2); }
    levelBonus() { return this.m_levelBonus; }
    areaClearedPercent() {
        return (this.m_areaCleared * 100) / (kPlayableWidth * kPlayableHeight);
    }
    areaClearedCells() { return this.m_areaCleared; }
    timeRemaining() { return this.m_timeRemaining; }
    verticalMode() { return this.m_verticalMode; }

    toggleOrientation() {
        if (!this.m_cutInProgress && !this.m_gameOver) {
            this.m_verticalMode = !this.m_verticalMode;
        }
    }

    cell(x, y) {
        return this.m_board[indexOf(x, y)];
    }

    traversable(x, y) {
        if (!inside(x, y)) return false;
        return this.cell(x, y).state === CellState.Open;
    }

    movementOpen(x, y) {
        return this.traversable(x, y) && this.cell(x, y).reserved === 0 &&
               this.findBallAt(x, y) === 0;
    }

    findBallAt(x, y) {
        if (!inside(x, y)) return 0;
        return this.cell(x, y).ball;
    }

    clearBoard() {
        for (const c of this.m_board) {
            c.state = CellState.Open;
            c.reserved = 0;
            c.ball = 0;
            c.visited = 0;
        }
        this.m_areaCleared = 0;
    }

    seedBalls() {
        for (const b of this.m_balls) {
            Object.assign(b, newBall());
        }
        for (let i = 0; i < this.m_ballCount; i++) {
            const ball = newBall();
            let placed = false;
            for (let attempt = 0; attempt < 4096 && !placed; attempt++) {
                ball.x = randomRange(this.m_rng, kPlayableMinX, kPlayableMaxX);
                ball.y = randomRange(this.m_rng, kPlayableMinY, kPlayableMaxY);
                if (this.findBallAt(ball.x, ball.y) === 0 && this.traversable(ball.x, ball.y)) {
                    placed = true;
                }
            }
            if (!placed) {
                for (let y = kPlayableMinY; y <= kPlayableMaxY && !placed; y++) {
                    for (let x = kPlayableMinX; x <= kPlayableMaxX && !placed; x++) {
                        if (this.traversable(x, y) && this.findBallAt(x, y) === 0) {
                            ball.x = x;
                            ball.y = y;
                            placed = true;
                        }
                    }
                }
            }
            ball.dx = signFromRandom(this.m_rng);
            ball.dy = signFromRandom(this.m_rng);
            ball.pendingX = 0;
            ball.pendingY = 0;
            ball.hasPending = false;
            ball.active = true;
            ball.frame = 0;
            this.m_balls[i] = ball;
            this.cell(ball.x, ball.y).ball = i + 1;
        }
    }

    beginCut(x, y) {
        if (this.m_gameOver || this.m_paused || this.m_cutInProgress || !inside(x, y)) {
            return;
        }
        if (this.cell(x, y).state !== CellState.Open || this.findBallAt(x, y) !== 0) {
            return;
        }

        this.m_slicers = [newSlicer(), newSlicer()];
        this.m_cutHadFailure = false;
        this.m_cutInProgress = true;

        if (!this.m_verticalMode) {
            this.m_slicers[0] = { active: x > kPlayableMinX, x, y, dx: -1, dy: 0, owner: 1,
                                  pendingX: x, pendingY: y, hasPending: false };
            this.m_slicers[1] = { active: x < kPlayableMaxX, x: x + 1, y, dx: 1, dy: 0, owner: 2,
                                  pendingX: x + 1, pendingY: y, hasPending: false };
        } else {
            this.m_slicers[0] = { active: y < kPlayableMaxY, x, y, dx: 0, dy: 1, owner: 1,
                                  pendingX: x, pendingY: y, hasPending: false };
            this.m_slicers[1] = { active: y > kPlayableMinY, x, y: y - 1, dx: 0, dy: -1, owner: 2,
                                  pendingX: x, pendingY: y - 1, hasPending: false };
        }

        for (const slicer of this.m_slicers) {
            if (!slicer.active) continue;
            if (!this.movementOpen(slicer.x, slicer.y)) {
                slicer.active = false;
                continue;
            }
            this.cell(slicer.x, slicer.y).state = slicer.owner === 1 ? CellState.SliceA : CellState.SliceB;
        }

        if (!this.m_slicers[0].active && !this.m_slicers[1].active) {
            this.m_cutInProgress = false;
        }
    }

    failSlicer(index, loseLife) {
        const slicer = this.m_slicers[index];
        if (!slicer || !slicer.active) return;

        const ownerState = index === 0 ? CellState.SliceA : CellState.SliceB;
        for (const c of this.m_board) {
            if (c.state === ownerState) {
                c.state = CellState.Open;
                c.reserved = 0;
            }
        }

        slicer.active = false;
        slicer.hasPending = false;
        slicer.pendingX = 0;
        slicer.pendingY = 0;
        this.m_cutHadFailure = true;

        if (loseLife && this.m_lives > 0) {
            this.m_lives--;
            if (this.m_lives <= 0) {
                this.m_gameOver = true;
                this.m_cutInProgress = false;
                this.m_slicers = [newSlicer(), newSlicer()];
            }
        }
    }

    advanceSlicers() {
        for (let i = 0; i < kMaxSlicers; i++) {
            const slicer = this.m_slicers[i];
            if (!slicer.active || slicer.hasPending) continue;

            const nextX = slicer.x + slicer.dx;
            const nextY = slicer.y + slicer.dy;

            if (!inside(nextX, nextY)) {
                this.completeSlicer(i);
                continue;
            }
            const next = this.cell(nextX, nextY);
            if (next.state === CellState.Filled) {
                this.completeSlicer(i);
                continue;
            }
            if (next.state !== CellState.Open || next.reserved !== 0 || next.ball !== 0) {
                continue;
            }

            slicer.pendingX = nextX - slicer.x;
            slicer.pendingY = nextY - slicer.y;
            slicer.hasPending = true;
            this.cell(nextX, nextY).state = i === 0 ? CellState.SliceA : CellState.SliceB;
            this.cell(nextX, nextY).reserved = 1;
        }
    }

    commitSlicers() {
        for (const slicer of this.m_slicers) {
            if (!slicer.active || !slicer.hasPending) continue;
            slicer.x += slicer.pendingX;
            slicer.y += slicer.pendingY;
            slicer.pendingX = 0;
            slicer.pendingY = 0;
            slicer.hasPending = false;
        }
    }

    planBalls() {
        for (let i = 0; i < this.m_ballCount; i++) {
            const ball = this.m_balls[i];
            if (!ball.active) continue;

            ball.hasPending = false;
            const x = ball.x, y = ball.y;
            let dx = ball.dx, dy = ball.dy;

            if ((x <= kPlayableMinX && dx < 0) || (x >= kPlayableMaxX && dx > 0)) dx = -dx;
            if ((y <= kPlayableMinY && dy < 0) || (y >= kPlayableMaxY && dy > 0)) dy = -dy;
            ball.dx = dx;
            ball.dy = dy;

            const diagonalOpen = this.movementOpen(x + ball.dx, y + ball.dy);
            const verticalOpen = this.movementOpen(x, y + ball.dy);
            const horizontalOpen = this.movementOpen(x + ball.dx, y);

            if (!diagonalOpen || !verticalOpen || !horizontalOpen) {
                const diagBall = this.findBallAt(x + ball.dx, y + ball.dy);
                if (diagBall > 0 && diagBall !== i + 1) {
                    this.m_balls[diagBall - 1].dx = ball.dx;
                }
                const vertBall = this.findBallAt(x, y + ball.dy);
                if (vertBall > 0 && vertBall !== i + 1) {
                    this.m_balls[vertBall - 1].dy = ball.dy;
                }
                const horizBall = this.findBallAt(x + ball.dx, y);
                if (horizBall > 0 && horizBall !== i + 1) {
                    this.m_balls[horizBall - 1].dx = ball.dx;
                    this.m_balls[horizBall - 1].dy = ball.dy;
                }

                if (!diagonalOpen && verticalOpen) {
                    ball.dx = -ball.dx;
                } else if (!verticalOpen && diagonalOpen) {
                    ball.dy = -ball.dy;
                } else {
                    ball.dx = -ball.dx;
                    ball.dy = -ball.dy;
                }
            }

            const moveX = ball.x + ball.dx;
            const moveY = ball.y + ball.dy;
            const nextDiagonalOpen = this.movementOpen(moveX, moveY);
            const nextVerticalOpen = this.movementOpen(ball.x, moveY);
            const nextHorizontalOpen = this.movementOpen(moveX, ball.y);

            if (nextDiagonalOpen && nextVerticalOpen && nextHorizontalOpen) {
                ball.pendingX = ball.dx;
                ball.pendingY = ball.dy;
                ball.hasPending = true;
                ball.frame = (ball.frame + 1) % 22;
                continue;
            }

            const choices = [[1, 1], [-1, -1], [1, -1], [-1, 1]];
            for (const choice of choices) {
                const candidateX = x + choice[0];
                const candidateY = y + choice[1];
                if (this.movementOpen(candidateX, candidateY) &&
                    this.movementOpen(candidateX, y) &&
                    this.movementOpen(x, candidateY)) {
                    ball.dx = choice[0];
                    ball.dy = choice[1];
                    ball.pendingX = ball.dx;
                    ball.pendingY = ball.dy;
                    ball.hasPending = true;
                    ball.frame = (ball.frame + 1) % 22;
                    break;
                }
            }
        }
    }

    commitBalls() {
        for (let i = 0; i < this.m_ballCount; i++) {
            const ball = this.m_balls[i];
            if (!ball.active || !ball.hasPending) continue;

            const oldX = ball.x, oldY = ball.y;
            const dx = ball.pendingX, dy = ball.pendingY;
            const nextX = oldX + dx, nextY = oldY + dy;
            const other = this.findBallAt(nextX, nextY);

            if (other > 0 && other !== i + 1) {
                const otherBall = this.m_balls[other - 1];
                otherBall.dx = dx;
                otherBall.dy = dy;
                ball.dx = -dx;
                ball.dy = -dy;
                ball.pendingX = 0;
                ball.pendingY = 0;
                ball.hasPending = false;
                continue;
            }

            if (inside(oldX, oldY) && this.cell(oldX, oldY).ball === i + 1) {
                this.cell(oldX, oldY).ball = 0;
            }

            ball.x = nextX;
            ball.y = nextY;
            ball.pendingX = 0;
            ball.pendingY = 0;
            ball.hasPending = false;
            if (inside(ball.x, ball.y)) {
                this.cell(ball.x, ball.y).ball = i + 1;
            }

            this.resolveBallSliceCollision(i);
            if (this.m_gameOver) return;
        }
    }

    resolveBallSliceCollision(index) {
        const ball = this.m_balls[index];
        if (!ball || !ball.active) return;

        const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
        let hitA = false, hitB = false;
        for (const [ox, oy] of offsets) {
            const x = ball.x + ox, y = ball.y + oy;
            if (!inside(x, y)) continue;
            const st = this.cell(x, y).state;
            if (st === CellState.SliceA) hitA = true;
            if (st === CellState.SliceB) hitB = true;
        }

        if (hitA) this.failSlicer(0, true);
        if (hitB && !this.m_gameOver) this.failSlicer(1, true);
    }

    captureOpenRegions() {
        const visited = new Uint8Array(kBoardWidth * kBoardHeight);
        let newlyFilled = 0;

        for (let y = 1; y <= kBoardHeight; y++) {
            for (let x = 1; x <= kBoardWidth; x++) {
                const start = indexOf(x, y);
                if (visited[start] !== 0 || !this.traversable(x, y)) continue;

                const queue = [{ x, y }];
                const region = [];
                let containsBall = false;
                visited[start] = 1;

                while (queue.length) {
                    const { x: cx, y: cy } = queue.shift();
                    const idx = indexOf(cx, cy);
                    region.push(idx);
                    if (this.findBallAt(cx, cy) !== 0) containsBall = true;

                    for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                        const nx = cx + ox, ny = cy + oy;
                        if (!this.traversable(nx, ny)) continue;
                        const nidx = indexOf(nx, ny);
                        if (visited[nidx] !== 0) continue;
                        visited[nidx] = 1;
                        queue.push({ x: nx, y: ny });
                    }
                }

                if (!containsBall) {
                    for (const idx of region) {
                        if (this.m_board[idx].state === CellState.Open) {
                            this.m_board[idx].state = CellState.Filled;
                            newlyFilled++;
                        }
                    }
                }
            }
        }
        return newlyFilled;
    }

    completeSlicer(index) {
        const slicer = this.m_slicers[index];
        if (!slicer || !slicer.active) return;

        const ownerState = index === 0 ? CellState.SliceA : CellState.SliceB;
        let wallCells = 0;
        for (const c of this.m_board) {
            if (c.state === ownerState) {
                c.state = CellState.Filled;
                c.reserved = 0;
                wallCells++;
            }
        }

        slicer.active = false;
        slicer.hasPending = false;
        slicer.pendingX = 0;
        slicer.pendingY = 0;

        const capturedCells = this.captureOpenRegions();
        this.addScoreForCells(wallCells + capturedCells);
        this.recomputeArea();
    }

    checkCutCompletion() {
        if (!this.m_cutInProgress) return;
        if (!this.m_slicers[0].active && !this.m_slicers[1].active) {
            this.m_cutInProgress = false;
            this.m_slicers = [newSlicer(), newSlicer()];
            this.m_cutHadFailure = false;
            this.recomputeArea();
            if (this.areaClearedPercent() >= kTargetClearPercent) {
                this.m_levelBonus = this.calculateLevelBonus();
                this.m_scoreHalfPoints += this.m_levelBonus * 2;
                this.m_levelComplete = true;
            }
        }
    }

    recomputeArea() {
        this.m_areaCleared = 0;
        for (const c of this.m_board) {
            if (c.state === CellState.Filled) this.m_areaCleared++;
        }
    }

    resetForNextLevel() {
        this.m_level++;
        this.m_ballCount = Math.min(kMaxBalls, this.m_ballCount + 1);
        this.m_lives = this.m_ballCount;
        this.m_timeRemaining = this.m_ballCount * 250 + 1000;
        this.m_cutHadFailure = false;
        this.m_cutInProgress = false;
        this.m_slicers = [newSlicer(), newSlicer()];
        this.clearBoard();
        this.seedBalls();
        this.recomputeArea();
    }

    calculateLevelBonus() {
        const percent = this.areaClearedPercent();
        let bonus = this.m_lives * 50 + Math.floor(this.m_timeRemaining / 10);
        if (percent > 80) bonus += (percent - 80) * (this.m_ballCount + 5) * 10;
        if (percent > 90) bonus += (percent - 90) * (this.m_ballCount + 5) * 20;
        return bonus;
    }

    advanceToNextLevel() {
        if (!this.m_levelComplete || this.m_gameOver) return;
        this.m_levelComplete = false;
        this.m_levelBonus = 0;
        this.resetForNextLevel();
    }

    addScoreForCells(cellCount) {
        if (cellCount <= 0) return;
        const baseHalfPoints = this.m_ballCount + 5;
        const speedMultiplier = this.m_fast ? 2 : 1;
        this.m_scoreHalfPoints += cellCount * baseHalfPoints * speedMultiplier;
    }

    updateTime() {
        if (this.m_timeRemaining > 0) this.m_timeRemaining--;
        if (this.m_timeRemaining <= 0) {
            this.m_timeRemaining = 0;
            this.m_gameOver = true;
            this.m_cutInProgress = false;
            this.m_slicers = [newSlicer(), newSlicer()];
        }
    }

    tick() {
        if (this.m_paused || this.m_gameOver || this.m_levelComplete) return;

        this.advanceSlicers();
        this.planBalls();
        this.commitSlicers();
        this.commitBalls();
        this.checkCutCompletion();

        this.m_timeAccumulatorMs += this.tickMilliseconds();
        while (this.m_timeAccumulatorMs >= 100) {
            this.m_timeAccumulatorMs -= 100;
            this.updateTime();
            if (this.m_gameOver) break;
        }

        this.m_tickCounter++;
    }

    board() { return this.m_board; }
    balls() { return this.m_balls; }
    slicers() { return this.m_slicers; }
}
