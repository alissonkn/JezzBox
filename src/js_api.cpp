// Emscripten/embind bridge exposing the ORIGINAL JezzBall game engine
// (src/jezzball.cpp / jezzball.h) to the browser.  The game logic itself is
// untouched original C++; only the presentation/input layer is browser-native.

#include <emscripten/bind.h>
#include "jezzball.h"

using namespace emscripten;

class GameBridge {
public:
    GameBridge() = default;

    void reset() { game.reset(); }
    void tick() { game.tick(); }
    void togglePause() { game.togglePause(); }
    void setFast(bool fast) { game.setFast(fast); }
    void toggleOrientation() { game.toggleOrientation(); }
    void beginCut(int x, int y) { game.beginCut(x, y); }
    void advanceToNextLevel() { game.advanceToNextLevel(); }

    bool isPaused() const noexcept { return game.isPaused(); }
    bool isFast() const noexcept { return game.isFast(); }
    bool isGameOver() const noexcept { return game.isGameOver(); }
    bool isLevelComplete() const noexcept { return game.isLevelComplete(); }
    bool verticalMode() const noexcept { return game.verticalMode(); }

    int level() const noexcept { return game.level(); }
    int ballCount() const noexcept { return game.ballCount(); }
    int lives() const noexcept { return game.lives(); }
    int score() const noexcept { return game.score(); }
    int levelBonus() const noexcept { return game.levelBonus(); }
    int areaClearedPercent() const noexcept { return game.areaClearedPercent(); }
    int areaClearedCells() const noexcept { return game.areaClearedCells(); }
    int timeRemaining() const noexcept { return game.timeRemaining(); }
    int tickMilliseconds() const noexcept { return game.tickMilliseconds(); }

    val boardStates() const noexcept {
        const auto& b = game.board();
        val a = val::array();
        for (size_t i = 0; i < b.size(); ++i) {
            a.set(i, static_cast<int>(b[static_cast<size_t>(i)].state));
        }
        return a;
    }

    val balls() const noexcept {
        const auto& bs = game.balls();
        val a = val::array();
        const int count = game.ballCount();
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

    val slicers() const noexcept {
        const auto& ss = game.slicers();
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

private:
    jezzball::Game game;
};

EMSCRIPTEN_BINDINGS(jezzbox) {
    class_<GameBridge>("GameBridge")
        .constructor()
        .function("reset", &GameBridge::reset)
        .function("tick", &GameBridge::tick)
        .function("togglePause", &GameBridge::togglePause)
        .function("setFast", &GameBridge::setFast)
        .function("toggleOrientation", &GameBridge::toggleOrientation)
        .function("beginCut", &GameBridge::beginCut)
        .function("advanceToNextLevel", &GameBridge::advanceToNextLevel)
        .function("isPaused", &GameBridge::isPaused)
        .function("isFast", &GameBridge::isFast)
        .function("isGameOver", &GameBridge::isGameOver)
        .function("isLevelComplete", &GameBridge::isLevelComplete)
        .function("verticalMode", &GameBridge::verticalMode)
        .function("level", &GameBridge::level)
        .function("ballCount", &GameBridge::ballCount)
        .function("lives", &GameBridge::lives)
        .function("score", &GameBridge::score)
        .function("levelBonus", &GameBridge::levelBonus)
        .function("areaClearedPercent", &GameBridge::areaClearedPercent)
        .function("areaClearedCells", &GameBridge::areaClearedCells)
        .function("timeRemaining", &GameBridge::timeRemaining)
        .function("tickMilliseconds", &GameBridge::tickMilliseconds)
        .function("boardStates", &GameBridge::boardStates)
        .function("balls", &GameBridge::balls)
        .function("slicers", &GameBridge::slicers);
}
