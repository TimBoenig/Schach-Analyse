// Entry points of the WebAssembly build of Caissa used by the web app.
//
// The browser build has no stdin loop and no threads: the host (glue.js) hands
// the engine one UCI line at a time, and a running search gives control back to
// the JavaScript event loop every few milliseconds, so that "stop" can arrive.
// "go ... movetime N" is turned into a plain deadline here: the search runs
// until the requested depth is reached or the time is up, whichever comes
// first, and always reports its lines. (The engine's own time manager is made
// for playing games: it may answer early, and it skips the evaluation when
// only one move is legal, which an analysis cannot use.)
// The neural network is not embedded; the host copies it into the buffer
// returned by caissa_net_buffer() before calling caissa_init().

#include "frontend/UCI.hpp"
#include "backend/Evaluate.hpp"
#include "backend/PackedNeuralNetwork.hpp"

#include <emscripten.h>
#include <cstdlib>
#include <new>
#include <sstream>
#include <string>

namespace {

nn::PackedNeuralNetwork* s_network = nullptr;
UniversalChessInterface* s_uci = nullptr;

// set by the host (written straight into memory) while a search is suspended
volatile uint8_t s_stopRequested = 0;

double s_lastYield = 0.0;
constexpr double c_yieldIntervalMs = 25.0;

// end of the running search in emscripten_get_now() time, 0 = no time limit
double s_deadline = 0.0;

// Removes "movetime N" from a "go" line and returns N in milliseconds (0 = none).
double TakeMoveTime(std::string& line)
{
    std::istringstream input(line);
    std::string token;
    if (!(input >> token) || token != "go")
    {
        return 0.0;
    }

    std::string rest = token;
    double moveTime = 0.0;
    while (input >> token)
    {
        if (token == "movetime")
        {
            std::string value;
            if (input >> value)
            {
                moveTime = std::atof(value.c_str());
            }
            continue;
        }
        rest += ' ';
        rest += token;
    }

    line = rest;
    return moveTime > 0.0 ? moveTime : 0.0;
}

} // namespace

// Suspends the search (Asyncify) until the host calls wakeUp.
EM_JS(void, caissa_js_yield, (), {
    Asyncify.handleSleep(function (wakeUp) {
        Module["caissaYield"](wakeUp);
    });
});

extern "C" {

// called by Search::CheckStopCondition on the searching thread
void CaissaWasmYield()
{
    const double now = emscripten_get_now();

    if (s_deadline > 0.0 && now >= s_deadline)
    {
        s_deadline = 0.0;
        if (s_uci)
        {
            s_uci->RequestStop();
        }
        return;
    }

    if (now - s_lastYield < c_yieldIntervalMs)
    {
        return;
    }

    caissa_js_yield();
    s_lastYield = emscripten_get_now();

    if (s_stopRequested)
    {
        s_stopRequested = 0;
        if (s_uci)
        {
            s_uci->RequestStop();
        }
    }
}

EMSCRIPTEN_KEEPALIVE uint32_t caissa_net_size()
{
    return static_cast<uint32_t>(sizeof(nn::PackedNeuralNetwork));
}

// memory the host fills with the network file
EMSCRIPTEN_KEEPALIVE void* caissa_net_buffer()
{
    if (!s_network)
    {
        s_network = new (std::nothrow) nn::PackedNeuralNetwork();
    }
    return s_network;
}

EMSCRIPTEN_KEEPALIVE uint8_t* caissa_stop_flag()
{
    return const_cast<uint8_t*>(&s_stopRequested);
}

// returns 1 when the engine is ready for UCI commands
EMSCRIPTEN_KEEPALIVE int caissa_init()
{
    if (s_uci)
    {
        return 1;
    }

    if (!s_network ||
        s_network->header.magic != nn::MagicNumber ||
        s_network->header.version != nn::CurrentVersion)
    {
        return 0;
    }

    InitEngine();
    g_mainNeuralNetwork = s_network;
    s_uci = new UniversalChessInterface();
    return 1;
}

// runs one UCI line; a "go" returns when the search has printed its bestmove
EMSCRIPTEN_KEEPALIVE int caissa_command(const char* line)
{
    if (!s_uci)
    {
        return 0;
    }

    std::string command = line;
    const double moveTime = TakeMoveTime(command);

    s_stopRequested = 0;
    s_lastYield = emscripten_get_now();
    s_deadline = moveTime > 0.0 ? s_lastYield + moveTime : 0.0;

    const bool result = s_uci->ExecuteCommand(command);
    s_deadline = 0.0;
    return result ? 1 : 0;
}

} // extern "C"
