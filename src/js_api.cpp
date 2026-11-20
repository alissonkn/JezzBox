// Emscripten/embind bridge exposing the ORIGINAL JezzBall game engine
// (src/jezzball.cpp / jezzball.h) to the browser.  The game logic itself is
// untouched original C++; only the presentation/input layer is browser-native.
//
// Uses standalone C functions (not an embind class) so there is no `this`-pointer
// wire-type conversion at the JS/C++ boundary, which avoids embind type-hierarchy
// issues in this Emscripten version.

#include <emscripten/bind.h>
#include "jezzball.h"

using namespace emscripten;

namespace {
jezzball::Game g_game;
}  // namespace

void reset() { g_game.reset(); }
void tick() { g_game.tick(); }
void togglePause() { g_game.togglePause(); }
void setFast(bool fast) { g_game.setFast(fast); }
void toggleOrientation() { g_game.toggleOrientation(); }
void beginCut(int x, int y) { g_game.beginCut(x, y); }
void advanceToNextLevel() { g_game.advanceToNextLevel(); }

bool isPaused() noexcept { return g_game.isPaused(); }
bool isFast() noexcept { return g_game.isFast(); }
bool isGameOver() noexcept { return g_game.isGameOver(); }
bool isLevelComplete() noexcept { return g_game.isLevelComplete(); }
bool verticalMode() noexcept { return g_game.verticalMode(); }

int level() noexcept { return g_game.level(); }
int ballCount() noexcept { return g_game.ballCount(); }
int lives() noexcept { return g_game.lives(); }
int score() noexcept { return g_game.score(); }
int levelBonus() noexcept { return g_game.levelBonus(); }
int areaClearedPercent() noexcept { return g_game.areaClearedPercent(); }
int areaClearedCells() noexcept { return g_game.areaClearedCells(); }
int timeRemaining() noexcept { return g_game.timeRemaining(); }
int tickMilliseconds() noexcept { return g_game.tickMilliseconds(); }

val boardStates() noexcept {
    const auto& b = g_game.board();
    val a = val::array();
    for (size_t i = 0; i < b.size(); ++i) {
        a.set(i, static_cast<int>(b[static_cast<size_t>(i)].state));
    }
    return a;
}

val balls() noexcept {
    const auto& bs = g_game.balls();
    val a = val::array();
    const int count = g_game.ballCount();
    for (int i = 0; i < count; ++i) {
        const auto& ball = bs[static_cast<size_t>(i)];
        val o = val::object();
        o.set("x", ball.x);
        o.set("y", ball.y);
        o.set("dx", ball.dx);
        o.set("dy", ball.dy);
        o.set("active", ball.active);
        o.set("frame", ball.frame);
        a.set(i, o);
    }
    return a;
}

val slicers() noexcept {
    const auto& ss = g_game.slicers();
    val a = val::array();
    for (size_t i = 0; i < ss.size(); ++i) {
        const auto& s = ss[static_cast<size_t>(i)];
        val o = val::object();
        o.set("active", s.active);
        o.set("x", s.x);
        o.set("y", s.y);
        o.set("owner", s.owner);
        a.set(i, o);
    }
    return a;
}

EMSCRIPTEN_BINDINGS(jezzbox) {
    function("reset", &reset);
    function("tick", &tick);
    function("togglePause", &togglePause);
    function("setFast", &setFast);
    function("toggleOrientation", &toggleOrientation);
    function("beginCut", &beginCut);
    function("advanceToNextLevel", &advanceToNextLevel);
    function("isPaused", &isPaused);
    function("isFast", &isFast);
    function("isGameOver", &isGameOver);
    function("isLevelComplete", &isLevelComplete);
    function("verticalMode", &verticalMode);
    function("level", &level);
    function("ballCount", &ballCount);
    function("lives", &lives);
    function("score", &score);
    function("levelBonus", &levelBonus);
    function("areaClearedPercent", &areaClearedPercent);
    function("areaClearedCells", &areaClearedCells);
    function("timeRemaining", &timeRemaining);
    function("tickMilliseconds", &tickMilliseconds);
    function("boardStates", &boardStates);
    function("balls", &balls);
    function("slicers", &slicers);
}
